/**
 * 注入到 WebView 的桥接脚本。
 *
 * 为什么要这一层：
 * 1. 知网对非登录会话会 302 到滑块验证（/verify/home?captchaType=blockPuzzle），
 *    纯原生 HTTP 客户端无法通过，也没有正当理由去破解它。
 *    放在 WebView 里，验证由用户手动完成一次，之后 cookie 常驻。
 * 2. 注入脚本与 kns.cnki.net 同源，fetch 不带跨域限制、自动携带 cookie。
 * 3. WebView 里有完整的 DOMParser，知网返回的是服务端渲染的 HTML 表格，
 *    在这里解析比在 RN 里用正则硬啃可靠得多。
 *
 * 所以：WebView 是数据管道，原生 UI 是渲染层。用户永远看不到 PC 页面。
 */

export interface ExtractFieldSpec {
  /**
   * CSS 选择器，相对每一行。
   * 支持逗号分隔多个候选，用于兼容知网不同时期的结构改动。
   */
  sel: string;
  /** text（默认）| html | @href | @src | @任意属性名 | all（取全部匹配元素） */
  from?: string;
  /** 该字段缺失时的默认值 */
  fallback?: string;
}

export interface ExtractSpec {
  /** 行选择器；为空表示只取单条（详情页） */
  row?: string;
  /** 字段映射 */
  fields: Record<string, string | ExtractFieldSpec>;
  /** 从整篇文档取单值，例如总条数、页码 */
  meta?: Record<string, string | ExtractFieldSpec>;
  /** 最多返回多少行 */
  limit?: number;
}

/** 抽取结果：列表 + 元信息 */
export interface ExtractResult<T = Record<string, string>> {
  rows: T[];
  meta: Record<string, string>;
}

/**
 * 桥接脚本。运行在知网页面上下文，暴露 window.__CNKI__。
 *
 * 注意：这是模板字符串，内部不能出现反引号或 ${，否则会被 TS 提前求值。
 * 因此脚本内部一律使用 ES5 风格的字符串拼接。
 */
export const BRIDGE_SCRIPT = String.raw`
(function () {
  /*
   * __CNKI_BRIDGE_READY__ 挂在 window 上，页面一导航就没了，
   * 所以换页后重走一遍是正常且必需的。
   *
   * 但同一个页面里被「补注入」时不能再定义第二次：__CNKI__ 里的 pending
   * 表是闭包变量，重新定义等于把正在等回包的请求全部丢弃，
   * 调用方只能干等到超时（症状就是「什么都没发生」）。
   * 这种情况只补一次心跳，让宿主知道桥接还活着。
   */
  if (window.__CNKI_BRIDGE_READY__) {
    try { window.__CNKI__.ping(); } catch (e) {}
    return;
  }
  window.__CNKI_BRIDGE_READY__ = true;

  function post(payload) {
    try {
      window.ReactNativeWebView.postMessage(JSON.stringify(payload));
    } catch (e) {}
  }

  function abs(url) {
    try { return new URL(url, location.href).href; } catch (e) { return url || ''; }
  }

  function squash(s) {
    return (s || '').replace(/\s+/g, ' ').trim();
  }

  /* 整页链接（文案 + 绝对地址）。详情页的「HTML阅读 / 原版阅读 / 附件」
     没有稳定选择器，只能把链接带回去按文案挑。 */
  function collectLinks(doc) {
    var anchors = doc.querySelectorAll('a[href]');
    var ls = [];
    for (var i = 0; i < anchors.length && ls.length < 300; i++) {
      var h = anchors[i].getAttribute('href') || '';
      if (!h || h.charAt(0) === '#') continue;
      ls.push({ t: squash(anchors[i].textContent || '').slice(0, 40), h: abs(h) });
    }
    return ls;
  }

  /* ---------------- 安全验证拦截判定 ---------------- */
  function looksBlocked(url, text) {
    if (url && /\/verify\/home|captchaType=|blockPuzzle/i.test(url)) return true;
    if (!text || text.length > 60000) return false;
    if (/id="captcha"|class="[^"]*verify|captcha-container/i.test(text)) return true;
    if (/请按住滑块|拖动滑块|安全验证/.test(text)) return true;
    /*
     * 检索接口现在会回 403 + JSON，而不是跳转：
     *   {"code":-403,"message":"https://kns.cnki.net/verify/home?captchaType=blockPuzzle&..."}
     * 这种响应体天然不会命中上面任何一条，之前就被当成「正常响应但 0 条」
     * 一路吞掉，用户只看到一句「暂无数据」，连验证入口都拿不到。
     */
    if (/verify\/home/i.test(text) && /"code"\s*:\s*-?\d{3}/.test(text)) return true;
    if (/captchaType=blockPuzzle/i.test(text)) return true;
    return false;
  }

  /*
   * 知网的「软拒绝」。
   *
   * 实测：当会话没过人机验证时，检索接口 /kns8s/brief/grid 依然回 200，
   * 但内容是固定 74 字节的空壳：
   *   <div id="briefBox"><p class="no-content" value="">抱歉，暂无数据，请稍后重试。</p></div>
   *
   * 它和「这个关键词真的没有结果」在文案上完全一样，只能靠长度和结构区分：
   * 真实的结果渲染会带上分页栏、总条数隐藏域，不可能只有 74 字节。
   * 代价是极少数真的空结果会被误报，所以文案里写成「可能」，并给出下一步。
   */
  function looksSoftBlocked(text) {
    if (!text || text.length > 400) return false;
    if (!/no-content/.test(text)) return false;
    if (/#hidTotalCount|result-table-list|pagerTitleCell|<tr/i.test(text)) return false;
    return true;
  }

  /*
   * 知网后端偶发故障也会回同一套 no-content 空壳，但文案里带着
   * 「数据服务获取数据异常 / feign 服务间调用异常 / code:500」。
   * 这种等几秒重试一次通常就好了，和「会话没过人机验证」是两回事；
   * 混为一谈会把用户送去拖一个根本没用的滑块。
   */
  function looksServerError(text) {
    if (!text) return false;
    if (!/no-content/i.test(text)) return false;
    return /系统异常|服务间调用异常|feign|数据服务获取数据异常|code\s*[:：]\s*500/i.test(text);
  }

  /* ---------------- 通用取值 ---------------- */
  function readValue(el, mode) {
    if (!el) return '';
    if (mode === 'html') return el.innerHTML || '';
    if (mode === 'outerHtml') return el.outerHTML || '';
    if (mode && mode.charAt(0) === '@') {
      var attr = mode.slice(1);
      var v = el.getAttribute(attr) || '';
      if (attr === 'href' || attr === 'src' || attr === 'action') return abs(v);
      return v;
    }
    // 表单元素的「值」在 value 上，textContent 是空的。
    // 知网把总条数放在 <input id="hidTotalCount" value="...">，必须这样取。
    var tag = el.tagName || '';
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') {
      return el.value || '';
    }
    return squash(el.textContent);
  }

  /* ---------------- 表格 / 列表抽取 ---------------- */
  function pickOne(scope, f) {
    var sel = typeof f === 'string' ? f : f.sel;
    var mode = typeof f === 'string' ? 'text' : (f.from || 'text');
    var fb = typeof f === 'string' ? '' : (f.fallback || '');
    if (!sel) return fb;

    // all：取所有匹配元素并拼接。关键词、基金这类字段在页面上是多个 <a>，
    // 用 querySelector 只会拿到第一个，必须用 querySelectorAll。
    if (mode === 'all') {
      var els = scope.querySelectorAll(sel);
      var arr = [];
      for (var i = 0; i < els.length; i++) {
        var t = squash(els[i].textContent);
        if (t) arr.push(t);
      }
      return arr.length ? arr.join(';') : fb;
    }

    var el = scope.querySelector(sel);
    return el ? readValue(el, mode) : fb;
  }

  function extractMeta(doc, meta) {
    var out = {};
    if (!meta) return out;
    Object.keys(meta).forEach(function (key) {
      out[key] = pickOne(doc, meta[key]);
    });
    return out;
  }

  function extractFromDoc(doc, spec) {
    spec = spec || {};
    var fields = spec.fields || {};

    if (!spec.row) {
      // 单条模式：直接从整篇文档取值（详情页）
      var one = {};
      Object.keys(fields).forEach(function (key) {
        one[key] = pickOne(doc, fields[key]);
      });
      return one;
    }

    var rows = doc.querySelectorAll(spec.row);
    var limit = spec.limit || 100;
    var out = [];
    for (var i = 0; i < rows.length && i < limit; i++) {
      var row = rows[i];
      var item = {};
      Object.keys(fields).forEach(function (key) {
        var f = fields[key];
        var sel = typeof f === 'string' ? f : f.sel;
        var mode = typeof f === 'string' ? 'text' : (f.from || 'text');
        var fb = typeof f === 'string' ? '' : (f.fallback || '');
        if (!sel) { item[key] = readValue(row, mode); return; }
        var el = row.querySelector(sel);
        item[key] = el ? readValue(el, mode) : fb;
      });
      out.push(item);
    }
    return out;
  }

  /* ---------------- 机构名探测 ---------------- */
  /*
   * 知网没有稳定的 class，按 .org-name / #orgName 这类「凭印象猜」的选择器
   * 去找，实际一个都命不中，于是 IP 登录明明生效了也判定成未授权。
   *
   * 所以不猜结构，改为按「文本形态」找：机构名的后缀特征极强
   * （大学 / 学院 / 图书馆 / 研究院…），再配合位置和噪声词过滤就足够准。
   *
   * 两轮扫描：先只看首屏页头（最准），找不到再放宽到全文。
   * 知网不同页面放机构名的位置并不统一，只认页头会漏掉一部分。
   */
  var ORG_SUFFIX = /(大学|学院|图书馆|研究院|研究所|科学院|职业技术学院|高等专科学校|学校|医院|出版社|党校)$/;
  var ORG_NOISE = /个人|我的|知网|CNKI|国家|工具|首页|登录|注册|会员|购物车|帮助|客服|English|Copyright|版权|网站|地图|导航|关于|联系|友情|链接/;
  var ORG_TAGS = 'a, span, font, b, strong, em, i, label, li, td, p, h1, h2, h3, h4, div';

  /** maxTop < 0 表示不限位置 */
  function scanOrg(maxTop, collect) {
    var els = document.querySelectorAll(ORG_TAGS);
    var cap = els.length > 12000 ? 12000 : els.length;
    var out = [];
    for (var i = 0; i < cap; i++) {
      var el = els[i];
      /* 子元素很多的容器是正文块，跳过；但必须允许 1~2 个 ——
         知网的机构名常写成 <a>校名<i class="icon"></i></a>，
         一律「只取叶子」会把这种最常见的形式漏掉。 */
      if (el.childElementCount > 2) continue;
      var t = squash(el.textContent);
      /* 知网常写成「欢迎您，XX大学」「当前机构：XX大学」，
         前缀会同时破坏长度判断和后缀正则，先剥掉。 */
      t = t.replace(/^(欢迎您?[，,：:！!\s]+|您好[，,：:！!\s]+|当前机构[：:\s]+|机构[：:\s]+)/, '');
      if (t.length < 4 || t.length > 30) continue;
      if (!ORG_SUFFIX.test(t)) continue;
      if (!collect && ORG_NOISE.test(t)) continue;
      var r = el.getBoundingClientRect();
      if (r.width <= 0 || r.height <= 0) continue; /* 隐藏元素不算 */
      if (collect) {
        /* 诊断模式：把候选连同位置、标签、class 一起带出去，
           万一还是认不出来，这些信息足以反推真实结构。 */
        var cls = typeof el.className === 'string' ? el.className.replace(/\s+/g, '.') : '';
        out.push(t + ' @' + Math.round(r.top) + ',' + Math.round(r.left) + ' <' + el.tagName + (cls ? '.' + cls : '') + '>');
        if (out.length >= 20) break;
        continue;
      }
      if (maxTop >= 0 && (r.top < 0 || r.top > maxTop)) continue;
      return t;
    }
    return collect ? out : '';
  }

  function findOrgName() {
    /* 知网自己的登录组件（login.cnki.net/tlogin/scripts/loginState.js）
       就是把机构名写进这两个 class 的，属于结构性事实，不是猜的：
         $(".ecp_header_unitName").text(bkUserName)
         $(".ecp_unitAccountName").text(bkUserName)
       未登录时它俩会被 hide() 掉且没有文本，所以「有文本」才有意义。 */
    var ORG_SELECTORS = ['.ecp_header_unitName', '.ecp_unitAccountName'];
    for (var s = 0; s < ORG_SELECTORS.length; s++) {
      var el = document.querySelector(ORG_SELECTORS[s]);
      if (!el) continue;
      var t = squash(el.textContent);
      if (t && t.length >= 2 && t.length <= 40) return { name: t, inHead: true, from: 'sel' };
    }

    /* 兜底：结构变了也不至于完全失明。
       首屏命中 = 强证据，肯定是页头的机构标识；
       只在正文命中 = 弱证据，可能只是文章里提到的学校名，
       需要配合「页头还有没有登录入口」再确认一次。 */
    var head = scanOrg(400, false);
    if (head) return { name: head, inHead: true, from: 'text' };
    return { name: scanOrg(-1, false), inHead: false, from: 'text' };
  }

  /* ---------------- 登录状态（确定性判定） ---------------- */
  /*
   * 之前一直靠扫页面文本猜「机构名」，而机构的登录状态其实是一个
   * JS 可读的 cookie：Ecp_LoginStuts，内容就是知网自己的登录态 JSON。
   *
   * 知网 etlogin.js 里的判定逻辑（照抄，不做发挥）：
   *   if (!vj)                          → 未登录
   *   else if (vj.UserType === "jf")    → 个人账号
   *        ├ vj.BUserType === "bk"      → 个人 + 机构（机构名 BShowName）
   *        └ 否则                        → 纯个人
   *   else                              → 机构/IP 登录（机构名 ShowName）
   *
   * 这条路不依赖页面渲染，知网换版式也不会失效，比文本扫描可靠得多。
   */
  function readCookie(name) {
    try {
      var m = (document.cookie || '').match(
        new RegExp('(?:^|;\\s*)' + name + '=([^;]*)')
      );
      return m ? m[1] : '';
    } catch (e) {
      return '';
    }
  }

  function readLoginState() {
    var raw = readCookie('Ecp_LoginStuts');
    if (!raw) return { present: false, isUnit: false, orgName: '' };

    var vj = null;
    try {
      vj = JSON.parse(decodeURIComponent(raw));
    } catch (e) {
      try { vj = JSON.parse(raw); } catch (e2) { vj = null; }
    }
    if (!vj || typeof vj !== 'object') {
      return { present: true, isUnit: false, orgName: '', parseError: true, raw: String(raw).slice(0, 160) };
    }

    var isPersonal = vj.UserType === 'jf';
    var withUnit = isPersonal && vj.BUserType === 'bk';
    return {
      present: true,
      userType: vj.UserType || '',
      bUserType: vj.BUserType || '',
      userName: vj.UserName || '',
      showName: vj.ShowName || '',
      bShowName: vj.BShowName || '',
      isUnit: !isPersonal || withUnit,
      orgName: !isPersonal ? vj.ShowName || '' : withUnit ? vj.BShowName || '' : ''
    };
  }

  /* ---------------- 核心请求 ---------------- */
  async function doFetch(req) {
    var res = await fetch(req.url, {
      method: req.method || 'GET',
      headers: req.headers || {},
      body: req.body || undefined,
      credentials: 'include',
      redirect: 'follow',
      cache: 'no-store'
    });

    var finalUrl = res.url || req.url;
    var text = '';
    try { text = await res.text(); } catch (e) { text = ''; }

    var blocked = looksBlocked(finalUrl, text);

    /* 被风控拦下时，知网会把滑块验证地址塞在响应里（可能是跳转后的 URL，
       也可能是 403 JSON 的 message 字段）。取出来交给原生层，用户点一下
       就能直接落到验证页，不用自己在页面里找。 */
    var challengeUrl = '';
    if (blocked) {
      if (text && text.length < 30000) {
        /* 不用正则直接写 URL 前缀：注入脚本是 raw 字符串，反斜杠容易被转义吃掉，
           改成 indexOf 定位，行为一致但不会写错。 */
        var at = text.indexOf('verify/home');
        if (at > -1) {
          var start = text.lastIndexOf('https://', at);
          if (start > -1) {
            /* JSON 里 & 可能被写成 \u0026，先把转义还原再找结束符，
               否则会在第一个 \u0026 处把地址截断。 */
            var rest = text
              .slice(start)
              .replace(/\\u0026/gi, '&')
              .replace(/\\\//g, '/')
              .replace(/&amp;/g, '&');
            var end = rest.search(/["'\s]/);
            challengeUrl = end > -1 ? rest.slice(0, end) : rest;
          }
        }
      }
      if (!challengeUrl && /\/verify\/home/.test(finalUrl)) challengeUrl = finalUrl;
    }

    /* 解析表格要用正文，所以这里必须无条件保留 text。
       之前按 wantRaw 才留，结果所有带 spec 的请求都拿不到正文，
       DOMParser 解析空串 → 列表恒为 0 条，检索页永远显示「没有找到相关文献」。 */
    var serverError = !blocked && looksServerError(text);

    return {
      status: res.status,
      url: finalUrl,
      blocked: blocked,
      softBlocked: !blocked && !serverError && looksSoftBlocked(text),
      serverError: serverError,
      challengeUrl: challengeUrl,
      text: text,
      contentType: (res.headers && res.headers.get && res.headers.get('content-type')) || ''
    };
  }

  /* ---------------- 对外接口 ---------------- */
  window.__CNKI__ = {
    /**
     * 执行一次请求，可选地按 spec 抽取结构化数据。
     * req: { id, url, method?, headers?, body?, spec?, wantRaw? }
     */
    exec: async function (req) {
      var id = req.id;
      try {
        var resp = await doFetch(req);
        var payload = {
          id: id,
          ok: true,
          status: resp.status,
          url: resp.url,
          blocked: resp.blocked,
          /* 200 但内容是空壳 —— 知网用这种方式拒绝未通过验证的会话。
             必须和「真的没有结果」区分开，否则用户只会看到一句
             「暂无数据」，完全不知道下一步该做什么。 */
          softBlocked: resp.softBlocked,
          serverError: resp.serverError,
          challengeUrl: resp.challengeUrl
        };

        if (!resp.blocked && (req.spec || req.wantLinks)) {
          var doc = new DOMParser().parseFromString(resp.text, 'text/html');
          if (req.spec) {
            payload.data = extractFromDoc(doc, req.spec);
            payload.meta = extractMeta(doc, req.spec.meta);
          }
          /*
           * 详情页上的「HTML阅读 / 原版阅读 / 附件」没有稳定的 id 或 class，
           * 只能按按钮文案认。CSS 选择器选不了文本，所以把整页链接带回去，
           * 由 RN 侧按文案挑 —— 知网改版时只需要改文案匹配。
           */
          if (req.wantLinks) {
            payload.links = collectLinks(doc);
          }
        }
        if (req.wantRaw) payload.raw = resp.text;
        if (req.wantText) payload.text = squash(docText(resp.text));

        post(payload);
      } catch (err) {
        /* 带上「当前页域名 → 目标域名」，跨域和断网在界面上都是 Failed to fetch，
           没有这两个域名就没法判断到底是哪一种。 */
        var targetHost = '';
        try {
          targetHost = String(req.url).split('//')[1].split('/')[0];
        } catch (e) {}
        /*
         * 跨子域（kns.cnki.net → www.cnki.net）的 fetch 会被浏览器按 CORS 拦掉，
         * 这不是网络故障，换个办法就能拿到同一份 HTML：把 WebView 真的导航过去，
         * 再对文档做抽取。这里只负责把「目标域和当前域不同」这个事实报上去，
         * 由原生层决定要不要改走导航。
         */
        var crossOrigin = false;
        try { crossOrigin = new URL(req.url).host !== location.host; } catch (e2) {}
        post({
          id: id,
          ok: false,
          crossOrigin: crossOrigin,
          error:
            String((err && err.message) || err) +
            ' [' + location.host + ' -> ' + targetHost + ']'
        });
      }
    },

    /** 对当前已加载的页面做抽取（导航式抓取的第二步） */
    extractCurrent: function (id, spec, wantRaw, wantLinks) {
      try {
        var html = '';
        try { html = document.documentElement.outerHTML || ''; } catch (e) {}
        var payload = {
          id: id,
          ok: true,
          url: location.href,
          blocked: looksBlocked(location.href, html.slice(0, 60000))
        };
        if (spec) {
          payload.data = extractFromDoc(document, spec);
          payload.meta = extractMeta(document, spec.meta);
        }
        if (wantRaw) payload.raw = html;
        if (wantLinks) payload.links = collectLinks(document);
        post(payload);
      } catch (err) {
        post({ id: id, ok: false, error: String((err && err.message) || err) });
      }
    },

    /**
     * 对一段 HTML 字符串做抽取，不依赖当前文档。
     *
     * 给调试工具用：服务器抓回来的响应可以直接解析，不必先塞进页面。
     * 走的是和 extractCurrent 完全相同的抽取函数，所以这里的结果
     * 就是真机上会得到的结果。
     */
    parseHtml: function (id, html, spec) {
      try {
        var doc = new DOMParser().parseFromString(String(html || ''), 'text/html');
        post({
          id: id,
          ok: true,
          data: spec ? extractFromDoc(doc, spec) : null,
          meta: spec ? extractMeta(doc, spec.meta) : null,
          softBlocked: looksSoftBlocked(String(html || ''))
        });
      } catch (err) {
        post({ id: id, ok: false, error: String((err && err.message) || err) });
      }
    },

    /** 探测当前会话：机构名、是否已登录、页面地址 */
    probe: function (id) {
      function snapshot() {
        var head = '';
        try {
          head = squash((document.body && document.body.innerText) || '').slice(0, 1200);
        } catch (e) {}
        var html = '';
        try { html = document.documentElement.outerHTML.slice(0, 20000); } catch (e) {}

        /* 先看 cookie：这是知网自己认定的登录态，比页面文本可靠。
           只有 cookie 判断不出时，才退回扫描 DOM。 */
        var login = { present: false, isUnit: false, orgName: '' };
        try { login = readLoginState(); } catch (e) {}

        var org = { name: '', inHead: false, from: '' };
        if (login.orgName) {
          org = { name: login.orgName, inHead: true, from: 'cookie' };
        } else {
          try { org = findOrgName(); } catch (e) {}
        }

        return {
          id: id,
          ok: true,
          url: location.href,
          host: location.host,
          title: document.title,
          blocked: looksBlocked(location.href, html),
          orgName: org.name,
          /* 机构名的来源：cookie = 知网登录态里直接读到的，最可信；
             sel = 页头固定 class 命中；text = 文本兜底扫描。 */
          orgSource: org.from || '',
          /* true 表示机构名出现在首屏页头，证据强度高；
             false 表示只有正文里命中，需要原生侧再交叉验证 */
          orgNameInHead: !!org.inHead,
          /* 知网登录态原样带出去，判定依据可追溯 */
          login: login,
          /* 页头文本：探测失败时拿它给用户看，就能分辨是「真的没授权」
             还是「授权了但没认出来」，不用再靠猜。 */
          headText: head,
          /* 页面上还留着「IP 登录」入口 = 服务端认为这个 IP 没授权。
             授权成功后知网的这一行会变成机构名本身。 */
          hasIpEntry: /IP\s*登录|机构登录|机构\s*\/\s*IP\s*登录/.test(head),
          /* 页头还是「个人登录 / 注册」的游客形态，说明这个网络同样没被认成机构。
             IP 授权后这一整块会被机构名和「退出」替换掉。 */
          hasGuest: /个人登录|个人注册/.test(head),
          hasLogout: /退出/.test(head)
        };
      }

      var first = snapshot();
      if (first.orgName) { post(first); return; }

      /* 知网页头的机构标识由异步接口渲染，页面 loadEnd 之后可能还要一会儿才出现。
         第一次没读到就再等一轮，避免把「晚到」误判成「没有授权」。 */
      setTimeout(function () {
        var second = snapshot();
        post(second.orgName ? second : first);
      }, 900);
    },

    /**
     * 诊断快照：机构名认不出来时，把现场信息原样带出去。
     *
     * 这些字段（含所有「像机构名」的候选文本、位置、标签、class）足以反推
     * 知网真实的页面结构，比让用户描述「页面上写了什么」靠谱得多。
     */
    dump: function (id) {
      var head = '';
      try {
        head = squash((document.body && document.body.innerText) || '').slice(0, 500);
      } catch (e) {}
      var iframes = [];
      try {
        var frs = document.querySelectorAll('iframe');
        for (var i = 0; i < frs.length && i < 6; i++) iframes.push(frs[i].src || '(no src)');
      } catch (e) {}
      var cookieKeys = [];
      try {
        var cs = (document.cookie || '').split(';');
        for (var j = 0; j < cs.length; j++) {
          var k = cs[j].split('=')[0].replace(/^\s+|\s+$/g, '');
          if (k) cookieKeys.push(k);
        }
      } catch (e) {}

      post({
        id: id,
        ok: true,
        url: location.href,
        host: location.host,
        title: document.title,
        headText: head,
        orgName: (function () {
          try { return findOrgName().name; } catch (e) { return ''; }
        })(),
        /* 登录态原样带出：这个字段能直接说明「知网认为谁在访问」，
           不用再看页面长什么样。 */
        login: (function () {
          try { return readLoginState(); } catch (e) { return { present: false, isUnit: false, orgName: '', error: String(e) }; }
        })(),
        candidates: scanOrg(-1, true),
        iframes: iframes,
        cookieKeys: cookieKeys
      });
    },

    /**
     * 当前文档 JS 可见的 cookie。
     *
     * 下载全文的接口挂在 kns.cnki.net / bar.cnki.net 上，要求带着
     * 机构登录态 cookie 并带上文章页 Referer，否则回「来源应用不正确」。
     * 原生层自己发请求没有会话，只能从这里借。
     */
    cookies: function (id) {
      try {
        post({ id: id, ok: true, url: location.href, cookie: document.cookie || '' });
      } catch (err) {
        post({ id: id, ok: false, error: String((err && err.message) || err) });
      }
    },

    /** 页面就绪信号，RN 侧用来同步导航状态 */
    ping: function () {
      post({ id: '__ping__', ok: true, url: location.href, ready: true });
    }
  };

  function docText(html) {
    try {
      var d = new DOMParser().parseFromString(html, 'text/html');
      return d.body ? d.body.textContent || '' : '';
    } catch (e) { return ''; }
  }

  window.__CNKI__.ping();
})();
true;
`;

/** 调用注入脚本执行请求 */
export function buildExecCall(payload: unknown): string {
  return `window.__CNKI__ && window.__CNKI__.exec(${JSON.stringify(payload)}); true;`;
}

/** 调用注入脚本探测会话 */
export function buildProbeCall(id: string): string {
  return `window.__CNKI__ && window.__CNKI__.probe(${JSON.stringify(id)}); true;`;
}

/** 取当前页面 JS 可见的 cookie（下载全文时带上） */
export function buildCookieCall(id: string): string {
  return `window.__CNKI__ && window.__CNKI__.cookies(${JSON.stringify(id)}); true;`;
}

/** 调用注入脚本导出诊断快照 */
export function buildDumpCall(id: string): string {
  return `window.__CNKI__ && window.__CNKI__.dump(${JSON.stringify(id)}); true;`;
}

/** 对当前页面做抽取 */
export function buildExtractCall(
  id: string,
  spec: ExtractSpec | null,
  wantRaw = false,
  wantLinks = false,
): string {
  return `window.__CNKI__ && window.__CNKI__.extractCurrent(${JSON.stringify(id)}, ${JSON.stringify(
    spec,
  )}, ${wantRaw}, ${wantLinks}); true;`;
}
