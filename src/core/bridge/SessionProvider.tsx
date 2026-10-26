import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  ActivityIndicator,
  Linking,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { WebView, WebViewMessageEvent } from 'react-native-webview';
import { AlertTriangle, ExternalLink, RotateCw } from 'lucide-react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  BRIDGE_SCRIPT,
  buildCookieCall,
  buildDumpCall,
  buildExecCall,
  buildExtractCall,
  buildProbeCall,
  ExtractSpec,
} from '@/core/bridge/script';
import { colors, fontSize, radius, spacing } from '@/shared/theme/theme';
import { SessionState } from '@/core/types/cnki';

/**
 * react-native-webview 的 props 类型在 React 19 + RN 0.88 下会退化为 never
 * （泛型推断失败），导致整个组件无法传参。这里把组件类型放宽为 any，
 * 运行时行为完全不受影响，只是放弃了对这一层 prop 的静态校验。
 */
const WebViewAny = WebView as unknown as React.ComponentType<any>;

/**
 * 桌面 Chrome UA —— 这是整个方案成立的前提。
 * 知网手机版（m.cnki.net）没有 IP 登录入口，只有 PC 站有。
 * 我们用桌面标识访问 PC 站拿数据，界面则完全由原生渲染，
 * 不会把 PC 版式塞进手机屏幕（那样在手机上根本没法读）。
 */
export const DESKTOP_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

/** 宿主页：与检索 / 详情接口同源，注入的 fetch 才不受 CORS 限制 */
export const HOST_URL = 'https://kns.cnki.net/kns8s/defaultresult/index';

/**
 * 知网首页。IP 授权生效后，这里页头的「IP 登录」入口会变成机构名称，
 * 是整站里最容易判断授权状态的一页，所以登录回来先去这里看一眼。
 */
export const HOME_URL = 'https://www.cnki.net/';

/** 登录 / 机构入口：知网 PC 登录页，IP 登录按钮在这里 */
export const LOGIN_URL = 'https://login.cnki.net/login/?platform=kns';

/**
 * 知网登录页不会因为「出口 IP 在学校网段」就自动完成机构登录，
 * 必须点一次页面上的「IP 登录」按钮（#Button2 / .toiplogin），
 * 才会由 etlogin.js 写入 Ecp_LoginStuts。
 *
 * 让用户在一个缩小到 720px 宽的桌面页里找这个按钮是不现实的，
 * 所以这里直接注入点击，把这一步变成原生的「一键登录」。
 */
const AUTO_IP_LOGIN_JS = `(function(){
  try {
    var b = document.getElementById('Button2') || document.querySelector('.toiplogin');
    if (!b) return 'no-button';
    b.click();
    return 'clicked';
  } catch (e) { return 'err'; }
})(); true;`;

/**
 * 点完 IP 登录后：滑块页要留给用户自己拖，不能把他从验证页带走；
 * 其它情况回首页看机构名（那里页头会由「IP 登录」变成机构名称）。
 */
const GO_HOME_UNLESS_VERIFY_JS = `(function(){
  try {
    var u = String(location.href || '');
    if (u.indexOf('/verify/home') >= 0 || u.indexOf('captchaType=') >= 0) return 'stay';
    location.href = ${JSON.stringify(HOME_URL)};
    return 'go';
  } catch (e) { return 'err'; }
})(); true;`;

/** 取 URL 的主机名，用于判断 WebView 当前停在哪个站点 */
function hostOf(url: string): string {
  const m = url.match(/^https?:\/\/([^/?#]+)/i);
  return m ? m[1].toLowerCase() : '';
}

/**
 * 验证页自检：没有题图、弹出「未注册服务」说明这张挑战票是过期的，
 * 用户再怎么拖也不会通过。这种情况要明确告诉他重新获取，
 * 而不是让他对着一个死掉的滑块较劲。
 */
const VERIFY_HEALTH_JS = `(function(){
  try {
    setTimeout(function(){
      var txt = (document.body && document.body.innerText) || '';
      var dead = /未注册服务|服务未注册|验证已过期/.test(txt);
      var box = document.querySelector('.verifybox');
      if (!box) dead = true;
      try {
        window.ReactNativeWebView.postMessage(JSON.stringify({ id: '__verify__', dead: dead, len: txt.length }));
      } catch (e) {}
    }, 1600);
  } catch (e) {}
})(); true;`;

export interface BridgeRequest {
  url: string;
  method?: 'GET' | 'POST';
  headers?: Record<string, string>;
  body?: string;
  /** 在 WebView 内按选择器抽取 */
  spec?: ExtractSpec;
  /** 需要原始 HTML（用于兜底解析） */
  wantRaw?: boolean;
  wantText?: boolean;
  /** 需要整页链接列表（详情页上按文案找阅读 / 附件入口） */
  wantLinks?: boolean;
  timeout?: number;
}

export interface BridgeResponse {
  status: number;
  url: string;
  blocked: boolean;
  /**
   * 知网的「软拒绝」：HTTP 200，但响应是固定 74 字节的空壳
   * `<p class="no-content">抱歉，暂无数据</p>`。
   * 会话没过人机验证时就会这样，必须和「关键词真的没命中」分开处理，
   * 否则用户只会看到「暂无数据」，不知道要去完成验证。
   */
  softBlocked?: boolean;
  /** 知网后端故障（no-content 空壳里带「系统异常」），等一会儿重试通常就好 */
  serverError?: boolean;
  data?: unknown;
  /** 被风控拦截时知网给出的滑块验证地址 */
  challengeUrl?: string;
  /** 从整篇文档抽取的元信息：总条数、页码等 */
  meta?: Record<string, string>;
  raw?: string;
  text?: string;
  /** 页面上的全部链接（文案 + 绝对地址），用于按按钮文案找入口 */
  links?: { t: string; h: string }[];
  /** document.cookie 快照，原生层下载全文时带着它 */
  cookie?: string;
  /**
   * fetch 因跨域被拦（目标域和当前页不同）。
   * 不是网络故障：把 WebView 导航过去能拿到同一份 HTML，改走导航抓取即可。
   */
  crossOrigin?: boolean;
}

interface SessionContextValue {
  ready: boolean;
  session: SessionState;
  request: <T = unknown>(req: BridgeRequest) => Promise<BridgeResponse & { data?: T }>;
  /** 导航到某页面并抽取（跨子域资源用，绕开 CORS） */
  navigate: <T = unknown>(url: string, spec: ExtractSpec | null, timeout?: number) => Promise<T>;
  probe: (opts?: { silent?: boolean }) => Promise<SessionState>;
  /** 取当前会话的 JS 可见 cookie，原生层下载全文时要带着它 */
  getCookies: () => Promise<{ cookie: string; url: string }>;
  /** 导出当前页面的诊断快照（机构名识别不出来时，拿它反推真实结构） */
  dump: () => Promise<string>;
  /**
   * 打开知网登录 / 验证页。
   * keepOpen 用于「我就是想看看这页」的场景（设置页的入口）：
   * 否则页面一识别到机构名就会自动收起，按钮看起来像没反应。
   */
  openLogin: (url?: string, opts?: { keepOpen?: boolean }) => void;
  closeLogin: () => void;
  loginVisible: boolean;
  blocked: boolean;
}

const SessionContext = createContext<SessionContextValue | null>(null);

interface PendingEntry {
  resolve: (value: any) => void;
  reject: (err: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

interface NavTask {
  url: string;
  spec: ExtractSpec | null;
  requestId: string;
  wantRaw: boolean;
  wantLinks: boolean;
}

export function SessionProvider({ children }: { children: React.ReactNode }) {
  const [ready, setReady] = useState(false);
  const [session, setSession] = useState<SessionState>({ status: 'unknown' });
  const [loginVisible, setLoginVisible] = useState(false);
  /** handleLoadEnd 是稳定引用，读不到最新的 loginVisible，用 ref 桥一下 */
  const loginVisibleRef = useRef(false);
  const [blocked, setBlocked] = useState(false);
  /** 当前这张滑块题已经失效（没有题图 / 未注册服务），拖了也不会过 */
  const [verifyDead, setVerifyDead] = useState(false);
  const [booting, setBooting] = useState(true);
  /** WebView 主文档加载失败时的现场，用于在登录面板上给出可读的提示 */
  const [loadError, setLoadError] = useState<{ url: string; description: string } | null>(null);
  const readyRef = useRef(false);
  const readyWaiters = useRef<(() => void)[]>([]);
  /**
   * 桥接脚本是否在当前文档上存活。
   *
   * 这是之前反复「IP 登录成功却检测不到机构名」的真正原因：注入进去的
   * window.__CNKI__ 属于当前文档，WebView 一导航（去 login.cnki.net 续期、
   * 被踢到 verify 页、回宿主页）就随之消失，而代码从没补注入过。
   * 消失之后 buildProbeCall 算出来是 `undefined && ...; true;`，
   * 既不报错也不回调，调用方只能干等到 15 秒超时 —— 表现就是「什么都没发生」。
   */
  const bridgeOn = useRef(false);
  const bridgeWaiters = useRef<(() => void)[]>([]);

  const markReady = useCallback(() => {
    if (readyRef.current) return;
    readyRef.current = true;
    setReady(true);
    readyWaiters.current.forEach((fn) => fn());
    readyWaiters.current = [];
  }, []);

  /** 收到 ping：桥接活过来了，唤醒所有等它的人 */
  const noteBridge = useCallback(() => {
    bridgeOn.current = true;
    bridgeWaiters.current.forEach((fn) => fn());
    bridgeWaiters.current = [];
  }, []);

  /**
   * 桥接脚本注入完成前发请求会静默失败，所以先等它就绪。
   * 注意这里不能只看 readyRef：它是「首次启动完成」的一次性锁存，
   * 换页之后仍然是 true，但当时文档里的桥接其实早就没了。
   */
  const waitReady = useCallback((timeout = 8000) => {
    if (readyRef.current && bridgeOn.current) return Promise.resolve();
    return new Promise<void>((resolve) => {
      let done = false;
      const fire = () => {
        if (done) return;
        done = true;
        resolve();
      };
      readyWaiters.current.push(fire);
      bridgeWaiters.current.push(fire);
      setTimeout(fire, timeout);
    });
  }, []);

  const insets = useSafeAreaInsets();
  const webRef = useRef<any>(null);

  /**
   * 确保当前文档里有桥接脚本，没有就补注入。
   *
   * injectedJavaScript 只在文档创建时注入一次，而 App 会主动导航好几次
   * （宿主页 → login.cnki.net 续期 → 回宿主页），每次导航都会把
   * window.__CNKI__ 抹掉。所以「发请求前先确认桥接还在」不能省。
   *
   * 返回 false 表示连补注入都没回音，这时宁可报一个明确的错，
   * 也不要让调用方在超时里干等 —— 用户看到的会是「搜不了」而不是原因。
   */
  const ensureBridge = useCallback((timeout = 4000): Promise<boolean> => {
    if (bridgeOn.current) return Promise.resolve(true);
    return new Promise<boolean>((resolve) => {
      let settled = false;
      let waiter: () => void = () => {};
      const finish = (ok: boolean) => {
        if (settled) return;
        settled = true;
        /* 超时的等待者要摘掉，否则一次失败就在队列里留一条，越攒越多 */
        const i = bridgeWaiters.current.indexOf(waiter);
        if (i >= 0) bridgeWaiters.current.splice(i, 1);
        resolve(ok);
      };
      waiter = () => finish(true);
      bridgeWaiters.current.push(waiter);
      webRef.current?.injectJavaScript(BRIDGE_SCRIPT);
      /* 注入是异步落到页面里的；换页那一刻有可能落在即将被替换的旧文档上，
         再补一次比猜时机可靠。重复注入在脚本内部是幂等的。 */
      setTimeout(() => {
        if (!settled) webRef.current?.injectJavaScript(BRIDGE_SCRIPT);
      }, 700);
      setTimeout(() => finish(false), timeout);
    });
  }, []);

  /** WebView 当前所在地址，用于判断是否已经停在验证页上 */
  const currentUrl = useRef('');
  const pending = useRef(new Map<string, PendingEntry>());
  const navTask = useRef<NavTask | null>(null);
  /**
   * 导航抓取的抽取结果先压在这里，等 WebView 回到宿主页再回给调用方。
   * 否则调用方会在「页面还停在 www.cnki.net」的瞬间发起下一个 fetch，
   * 又撞一次跨域 —— 表现就是详情页能看、紧接着的请求偶尔失败。
   */
  const navReturn = useRef<{ id: string; payload: any } | null>(null);
  /**
   * 「完成」按钮按下后，要等到知网页面真正加载完才能探测。
   * 之前是在发起导航的同一帧就调 probe()，那时 document 还是登录页，
   * 于是永远读不到机构名 —— 这就是 IP 登录成功了却提示没权限的原因。
   */
  const probePending = useRef(false);
  /** 已经导航到登录页、等它加载完就注入「IP 登录」点击 */
  const ipLoginPending = useRef(false);
  /** 用户只是想「看看登录页」时，别因为识别到机构名就自动收起面板 */
  const keepOpenRef = useRef(false);
  /** probe 定义在后面，页面加载回调需要靠它拿到最新引用 */
  const probeRef = useRef<((opts?: { silent?: boolean }) => Promise<SessionState>) | null>(null);
  /** 防重入：面板开着时会轮询探测，别让多个 probe 在队列里堆起来 */
  const probingRef = useRef(false);
  const sessionRef = useRef<SessionState>({ status: 'unknown' });
  const seq = useRef(0);
  const chain = useRef<Promise<unknown>>(Promise.resolve());
  /* 首次启动最多显示 8 秒连接提示，避免加载失败时一直遮着界面 */
  useEffect(() => {
    const t = setTimeout(() => setBooting(false), 8000);
    return () => clearTimeout(t);
  }, []);

  useEffect(() => {
    if (ready) setBooting(false);
  }, [ready]);

  useEffect(() => {
    loginVisibleRef.current = loginVisible;
  }, [loginVisible]);

  /* ------------------------------------------------------------------ */
  /* 串行任务队列：同一时刻只让一个任务占用 WebView，导航不会互相打断     */
  /* ------------------------------------------------------------------ */
  const enqueue = useCallback(<T,>(task: () => Promise<T>): Promise<T> => {
    const next = chain.current.then(task, task);
    chain.current = next.catch(() => undefined);
    return next as Promise<T>;
  }, []);

  /* 发一条指令并等待对应 id 的回包 */
  const callBridge = useCallback(
    async (build: (id: string) => string, timeout = 20000): Promise<any> => {
      /*
       * 先确认桥接还在。少了这一步，导航之后所有调用都会算成
       * `undefined && ...` —— 不报错、不回调，只能等超时。
       */
      const alive = await ensureBridge();
      if (!alive) {
        throw new Error('页面脚本未能注入，请点重试');
      }
      const id = `req_${Date.now()}_${seq.current++}`;
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          pending.current.delete(id);
          reject(new Error('请求超时，请确认设备处于校园网内'));
        }, timeout);
        pending.current.set(id, { resolve, reject, timer });
        webRef.current?.injectJavaScript(build(id));
      });
    },
    [ensureBridge],
  );

  /* ------------------------------------------------------------------ */
  /* 回包处理                                                            */
  /* ------------------------------------------------------------------ */
  const handleMessage = useCallback((event: WebViewMessageEvent) => {
    let msg: any;
    try {
      msg = JSON.parse(event.nativeEvent.data);
    } catch {
      return; // 站点自身的 postMessage，忽略
    }
    if (!msg || !msg.id) return;

    if (msg.id === '__ping__') {
      noteBridge();
      markReady();
      return;
    }

    if (msg.id === '__verify__') {
      setVerifyDead(!!msg.dead);
      return;
    }

    const entry = pending.current.get(msg.id);
    if (!entry) return;

    if (!msg.ok) {
      pending.current.delete(msg.id);
      clearTimeout(entry.timer);
      const err = new Error(msg.error || '知网返回异常') as Error & { crossOrigin?: boolean };
      err.crossOrigin = !!msg.crossOrigin;
      entry.reject(err);
      return;
    }

    /*
     * 导航抓取的回包：先缓存，等 WebView 回到宿主页再 resolve。
     * 计时器放宽到 8 秒（回程导航 + 页面加载），仍超时就明确报错。
     */
    const ret = navReturn.current;
    if (ret && ret.id === msg.id) {
      ret.payload = {
        status: msg.status ?? 200,
        url: msg.url ?? '',
        blocked: !!msg.blocked,
        challengeUrl: msg.challengeUrl || undefined,
        data: msg.data,
        meta: msg.meta,
        raw: msg.raw,
        links: Array.isArray(msg.links) ? msg.links : undefined,
      };
      clearTimeout(entry.timer);
      entry.timer = setTimeout(() => {
        pending.current.delete(msg.id);
        entry.reject(new Error('返回检索页超时，请重试'));
      }, 8000);
      return;
    }

    pending.current.delete(msg.id);
    clearTimeout(entry.timer);

    entry.resolve({
      status: msg.status ?? 200,
      url: msg.url ?? '',
      blocked: !!msg.blocked,
      /* 这两个标记必须回传：漏掉的话 searchDocs 里的「空壳响应」
         和「后端故障」分支永远不成立，用户只会看到「没有找到相关文献」。 */
      softBlocked: !!msg.softBlocked,
      serverError: !!msg.serverError,
      challengeUrl: msg.challengeUrl || undefined,
      data: msg.data,
      meta: msg.meta,
      raw: msg.raw,
      text: msg.text,
      links: Array.isArray(msg.links) ? msg.links : undefined,
      /* 探测回包自己的字段。少传这一组，probe() 就永远读到空 orgName，
         结果是「IP 登录明明成功、界面却一直说未识别」。 */
      orgName: msg.orgName,
      orgSource: msg.orgSource,
      orgNameInHead: msg.orgNameInHead,
      login: msg.login,
      headText: msg.headText,
      host: msg.host,
      /* 原生下载要借 WebView 的会话，这行漏了就会一直报「会话已失效」 */
      cookie: msg.cookie,
    });
  }, [markReady, noteBridge]);

  /* ------------------------------------------------------------------ */
  /* 页面加载完成：优先消费导航任务，否则判断是否被验证页拦住             */
  /* ------------------------------------------------------------------ */
  /* ------------------------------------------------------------------ */
  /* 主文档加载失败：Android 会渲染一张英文报错页，对用户毫无信息量，      */
  /* 这里接管，给出中文原因和两个可操作的出口                              */
  /* ------------------------------------------------------------------ */
  const handleWebError = useCallback((e: any) => {
    const url = e?.nativeEvent?.url || '';
    const description = e?.nativeEvent?.description || '';
    if (url) currentUrl.current = url;
    setLoadError({ url, description });
  }, []);

  const reloadWeb = useCallback(() => {
    setLoadError(null);
    webRef.current?.reload();
  }, []);

  const handleLoadEnd = useCallback((e: { nativeEvent: { url: string } }) => {
    const url = e.nativeEvent.url || '';
    if (url) currentUrl.current = url;
    const isVerify = /\/verify\/home|captchaType=/.test(url);
    setBlocked(isVerify);
    setLoadError(null);

    if (isVerify) {
      /*
       * 验证页加载完自检这张题是不是还活着。
       *
       * 顺带说明一句历史：这里曾经加过「触摸转鼠标」的补丁，理由是以为
       * 桌面 UA 下验证码只认鼠标。逆向过一遍 SDK 的绑定之后发现不对——
       * 它 touchstart / touchmove / touchend 和 mouse 那套都绑了，手指本来
       * 就能拖动（只是拖错位置会静默弹回，看着像没反应）。补丁已删除。
       */
      setVerifyDead(false);
      setTimeout(() => {
        if (webRef.current) webRef.current.injectJavaScript(VERIFY_HEALTH_JS);
      }, 300);
    }

    /*
     * 文档换了，上一份桥接已经随旧文档销毁。这里必须先补回来，
     * 后面所有 injectJavaScript（抽详情、探测、回宿主页）才有落脚点。
     * 补注入是幂等的：脚本内部检测到本页已有桥接时只回一次心跳。
     */
    bridgeOn.current = false;
    void ensureBridge();

    const task = navTask.current;
    if (task) {
      navTask.current = null;
      /*
       * 导航过去撞上滑块页：抽取只会得到一张验证页。直接回一个 blocked，
       * 让 UI 把验证入口摆出来；页面就停在这儿不动 —— 滑块绑定当前会话，
       * 再导航一次会换一张新题，用户刚拖的进度就白费了。
       */
      if (isVerify) {
        const entry = pending.current.get(task.requestId);
        if (entry) {
          pending.current.delete(task.requestId);
          clearTimeout(entry.timer);
          entry.resolve({ status: 200, url, blocked: true, challengeUrl: url });
        }
        return;
      }
      navReturn.current = { id: task.requestId, payload: null };
      webRef.current?.injectJavaScript(
        buildExtractCall(task.requestId, task.spec, task.wantRaw, task.wantLinks),
      );
      // 抓完回到宿主页，恢复同源上下文供后续 fetch 使用
      setTimeout(() => {
        webRef.current?.injectJavaScript(
          `location.href = ${JSON.stringify(HOST_URL)}; true;`,
        );
      }, 200);
      return;
    }

    /*
     * 回程落回宿主页：把导航抓取缓存的结果交出去。
     * 抽取回包偶尔比页面加载慢一拍，这里补几次检查再交。
     */
    const ret = navReturn.current;
    if (ret && /^kns\.cnki\.net$/i.test(hostOf(url))) {
      const flush = (tries: number) => {
        const cur = navReturn.current;
        if (!cur || cur.id !== ret.id) return;
        if (!cur.payload) {
          if (tries > 0) setTimeout(() => flush(tries - 1), 300);
          return;
        }
        navReturn.current = null;
        const entry = pending.current.get(cur.id);
        if (!entry) return;
        pending.current.delete(cur.id);
        clearTimeout(entry.timer);
        entry.resolve(cur.payload);
      };
      flush(6);
    }

    if (isVerify) {
      setSession((s) => ({
        ...s,
        status: 'anonymous',
        error: '需要完成安全验证',
        checkedAt: Date.now(),
      }));
      return;
    }

    /*
     * 落到登录页：注入一次「IP 登录」点击。
     * 这一步不做的话，WebView 里永远不会有 Ecp_LoginStuts，
     * 探测只能得出「未识别到机构名称」—— 这就是之前一直不行的原因。
     */
    if (ipLoginPending.current && /^login\.cnki\.net$/i.test(hostOf(url))) {
      ipLoginPending.current = false;
      setTimeout(() => {
        webRef.current?.injectJavaScript(AUTO_IP_LOGIN_JS);
        /* 登录是异步 XHR，点完要等 cookie 落地再回首页；
           万一它把用户送到了滑块页，就停在那儿别动。 */
        setTimeout(() => {
          webRef.current?.injectJavaScript(GO_HOME_UNLESS_VERIFY_JS);
        }, 2600);
      }, 1200);
      return;
    }

    /*
     * 「完成」后落到了知网页面：等到渲染稳定再探测。
     * 知网是 SPA，loadEnd 触发时页头还没画出来，立刻读一定是空的。
     *
     * 登录页上的自动机构登录是异步 XHR，第一次探测有可能赶在 cookie
     * 写入之前 —— 那样会给出一次假的「未授权」。所以没拿到就再等一轮。
     */
    if (probePending.current && /(^|\.)cnki\.net$/.test(hostOf(url))) {
      probePending.current = false;

      const runProbe = (attempt: number) => {
        setTimeout(() => {
          const p = probeRef.current?.();
          if (!p) return;
          p.catch(() => undefined).then((s) => {
            if (attempt === 0 && s && s.status === 'anonymous' && s.reason !== 'blocked') {
              runProbe(1);
              return;
            }
            /* 探测完回宿主页：request() 的 fetch 依赖这个同源上下文 */
            if (!currentUrl.current.startsWith('https://kns.cnki.net')) {
              webRef.current?.injectJavaScript(
                `location.href = ${JSON.stringify(HOST_URL)}; true;`,
              );
            }
          });
        }, attempt === 0 ? 1200 : 1800);
      };

      runProbe(0);
      return;
    }

    /*
     * 面板还开着的时候，用户可能已经在里面点了「IP 登录」并被知网跳回首页。
     * 这里静默识别一次，面板顶部就能立刻显示「已识别到 XX 大学」，
     * 不必等用户自己点完成。
     */
    if (loginVisibleRef.current && /(^|\.)cnki\.net$/i.test(hostOf(url))) {
      setTimeout(() => {
        const p = probeRef.current?.({ silent: true });
        p?.catch(() => undefined);
      }, 1800);
    }
  }, [ensureBridge]);

  /* ------------------------------------------------------------------ */
  /* 会话探测                                                            */
  /*                                                                     */
  /* 判定依据只有一条硬信号：页头是否出现了机构名称。                     */
  /* 找不到机构名时不再笼统地报「未检测到」，而是把页面上的实际证据       */
  /* （是否还在显示「IP 登录」入口、页面停在哪）翻译成一句人话，          */
  /* 让用户能区分「真没授权」和「授权了但没认出来」。                     */
  /* ------------------------------------------------------------------ */
  const probe = useCallback(async (opts?: { silent?: boolean }): Promise<SessionState> => {
    const silent = !!opts?.silent;
    /* 面板里是 2.6 秒一轮的轮询，探测本身在找不到机构名时还会等 900ms 重试，
       不拦一下就会把串行队列堆满。 */
    if (probingRef.current) return sessionRef.current;
    probingRef.current = true;
    if (!silent) setSession((s) => ({ ...s, status: 'checking' }));
    try {
      await waitReady();
      const res = await enqueue(() => callBridge((id) => buildProbeCall(id), 15000));

      const orgName = String(res?.orgName || '').trim();
      const headText = String(res?.headText || '').trim();
      const pageUrl = String(res?.url || '');
      const host = String(res?.host || hostOf(pageUrl));
      const onCnki = /(^|\.)cnki\.net$/i.test(host);

      let status: SessionState['status'] = 'anonymous';
      let error: string | undefined;
      let reason: SessionState['reason'];
      let shownOrg = '';
      let orgSource: SessionState['orgSource'];

      /* 知网登录态 cookie。它在 etlogin.js 里由 JS 读写，所以 WebView 里
         document.cookie 一定拿得到，不受页面版式影响。
         vj.UserType !== 'jf' 就是机构/IP 登录，ShowName 即机构名；
         vj.UserType === 'jf' 且 BUserType === 'bk' 表示个人账号带机构权限。 */
      const login = (res?.login || {}) as {
        present?: boolean;
        isUnit?: boolean;
        userType?: string;
        bUserType?: string;
        userName?: string;
        showName?: string;
        bShowName?: string;
        orgName?: string;
        parseError?: boolean;
      };
      const cookieOrg = String(login.orgName || '').trim();

      if (login.present && !login.parseError) {
        orgSource = 'cookie';
        if (login.userType && login.userType !== 'jf') {
          /* 机构 IP 登录：知网直接把机构名放在 ShowName 里 */
          status = 'ip';
          shownOrg = cookieOrg || String(login.showName || '').trim();
        } else if (login.isUnit) {
          /* 个人账号 + 机构权限 */
          status = 'ip';
          shownOrg = cookieOrg || String(login.bShowName || '').trim();
        } else {
          /* 纯个人账号：登录了，但没有机构那层权限 */
          status = 'account';
          shownOrg = String(login.showName || login.userName || '').trim();
          error = '当前是个人账号登录，没有机构权限；退出后改用「IP 登录」才能下载全文';
          reason = 'personal-only';
        }
      } else {
        /* cookie 读不到时退回 DOM 证据 —— 属于兜底，不是首选路径。 */
        const orgStrong = !!orgName && !!res?.orgNameInHead;
        const orgWeak =
          !!orgName && !res?.orgNameInHead && !res?.hasGuest && !res?.hasIpEntry;
        shownOrg = orgStrong || orgWeak ? orgName : '';

        if (shownOrg) {
          status = 'ip';
          orgSource = res?.orgSource === 'sel' ? 'sel' : 'text';
        } else if (res?.hasLogout) {
          status = 'account';
        } else if (res?.blocked) {
          error = '需要先完成一次安全验证（滑块），这一步与 IP 登录无关';
          reason = 'blocked';
        } else if (!onCnki) {
          error = '页面没有停在知网，请在登录面板里重新打开知网';
          reason = 'offsite';
        } else if (res?.hasIpEntry) {
          /* 知网还挂着「IP 登录」入口，说明服务端没把这个出口 IP 认成授权 IP。
             校园网没走对线路、连的是访客 Wi-Fi、或者学校今年没续订，都会这样。 */
          error = '知网页面仍显示「IP 登录」入口，这个网络地址未被机构授权';
          reason = 'ip-entry';
        } else if (res?.hasGuest) {
          /* 页头是「个人登录 / 注册」的游客形态：IP 授权成功后这里会被机构名取代。
             走到这里基本可以确定是出口 IP 不在学校订购范围内。 */
          error = '知网把你当成了访客（页头仍是「个人登录」），这个网络未被机构授权';
          reason = 'guest';
        } else {
          error = '页面已加载，但页头没有出现机构名称';
          reason = 'no-org';
        }
      }

      const next: SessionState = {
        status,
        orgName: shownOrg || undefined,
        hasFullText: status === 'ip',
        checkedAt: Date.now(),
        error,
        reason,
        orgSource,
        evidence: headText.slice(0, 160) || undefined,
        pageUrl: pageUrl || undefined,
      };
      const granted = status === 'ip' || status === 'account';

      /* 静默探测只负责「发现」授权，不负责「撤销」：
         面板开着时用户可能只是路过登录页，那一刻读不到机构名，
         照单全收就会把已经生效的授权状态打回未授权。 */
      if (silent && !granted) return next;

      setBlocked(!!res?.blocked);
      setSession(next);

      /*
       * 拿到权限就自己收起面板回主界面。
       * 「识别到机构」本身就是完成信号，不该再让用户在知网页面里
       * 找我们那个「完成」按钮 —— 那一步正是之前卡住的地方。
       */
      if (granted && loginVisibleRef.current && !keepOpenRef.current) {
        setLoginVisible(false);
        setTimeout(() => {
          webRef.current?.injectJavaScript(
            `location.href = ${JSON.stringify(HOST_URL)}; true;`,
          );
        }, 600);
      }

      return next;
    } catch (err: any) {
      const next: SessionState = {
        status: 'anonymous',
        checkedAt: Date.now(),
        error: err?.message || '探测失败',
        pageUrl: currentUrl.current || undefined,
      };
      if (silent) return next;
      setSession(next);
      return next;
    } finally {
      probingRef.current = false;
    }
  }, [callBridge, enqueue, waitReady]);

  useEffect(() => {
    probeRef.current = probe;
  }, [probe]);

  useEffect(() => {
    sessionRef.current = session;
  }, [session]);

  /**
   * 先过一遍知网的登录页，再探测。
   *
   * 这一步是整个登录态的关键：机构授权（IP 登录）的凭据 `Ecp_LoginStuts`
   * 是 login.cnki.net 写入的，Domain 挂在 cnki.net 上。
   * 如果 WebView 从没打开过这一页，就算人在校园网里、知网服务端已经认可
   * 这个出口 IP，WebView 里也压根没有这个 cookie —— 探测只能得出
   * 「未检测到机构权限」。用户看到的「IP 登录成功了却检测不出来」就是这个。
   *
   * 反过来，只要打开这一页并点一次「IP 登录」，知网就会按出口 IP
   * 完成机构登录并写入 cookie。按钮由 AUTO_IP_LOGIN_JS 自动点，
   * 用户全程不用操作，所以启动时静默走一趟即可。
   */
  const probeViaLogin = useCallback(() => {
    probePending.current = true;
    ipLoginPending.current = true;
    webRef.current?.injectJavaScript(`location.href = ${JSON.stringify(LOGIN_URL)}; true;`);
  }, []);

  /* ------------------------------------------------------------------ */
  /* 面板打开时轮询                                                       */
  /*                                                                     */
  /* 知网的 IP 登录有时是局部刷新，不触发主文档 onLoadEnd；光靠页面加载事件 */
  /* 会漏掉「授权刚刚生效」的那一瞬间，用户就只能傻等或者手动点完成。       */
  /* 轮询到机构名的同时，probe 内部会自动收起面板并回到主界面。            */
  /* ------------------------------------------------------------------ */
  useEffect(() => {
    if (!loginVisible) return;
    const timer = setInterval(() => {
      const p = probeRef.current?.({ silent: true });
      p?.catch(() => undefined);
    }, 2600);
    return () => clearInterval(timer);
  }, [loginVisible]);

  /* ------------------------------------------------------------------ */
  /* 诊断快照：识别不出机构名时，把页面现场导出成一段可复制的文本        */
  /* ------------------------------------------------------------------ */
  const dump = useCallback(async (): Promise<string> => {
    await waitReady();
    const res: any = await enqueue(() => callBridge((id) => buildDumpCall(id), 15000));
    const candidates: string[] = Array.isArray(res?.candidates) ? res.candidates : [];
    return [
      `时间：${new Date().toLocaleString('zh-CN')}`,
      `地址：${res?.url || '-'}`,
      `主机：${res?.host || '-'}`,
      `标题：${res?.title || '-'}`,
      `识别到的机构：${res?.orgName || '(空)'}`,
      `iframe：${(res?.iframes || []).join(' | ') || '(无)'}`,
      `Cookie：${(res?.cookieKeys || []).join(', ') || '(无)'}`,
      `页头文本：${res?.headText || '(空)'}`,
      '机构名候选（文本 @top,left <标签.class>）：',
      ...(candidates.length ? candidates.map((c) => `  ${c}`) : ['  (没有文本匹配机构后缀)']),
    ].join('\n');
  }, [callBridge, enqueue, waitReady]);

  const getCookies = useCallback(async (): Promise<{ cookie: string; url: string }> => {
    await waitReady();
    return enqueue(async () => {
      const res: any = await callBridge((id) => buildCookieCall(id), 8000);
      return { cookie: String(res?.cookie || ''), url: String(res?.url || '') };
    });
  }, [callBridge, enqueue, waitReady]);

  /* ------------------------------------------------------------------ */
  /* 启动自检：先过一遍知网登录页，再判断权限                            */
  /*                                                                     */
  /* 顺序不能反。直接探检索页只能读到「有没有登录 cookie」，而这台设备     */
  /* 可能从没访问过 login.cnki.net，登录态根本没被写进来。                */
  /* 先走一趟登录页（知网会按出口 IP 自动完成机构登录），再探就是准的。   */
  /* WebView 在屏幕外，这一跳用户看不见，代价只是启动多一两秒。           */
  /* ------------------------------------------------------------------ */
  useEffect(() => {
    if (!ready) return;
    const t = setTimeout(() => {
      probeViaLogin();
    }, 800);

    /*
     * 兜底：登录页打不开（没网、被劫持）时 handleLoadEnd 不会回调，
     * probePending 会一直挂着，WebView 就停在 login.cnki.net 了。
     * 那样后面 request() 的 fetch 会跨域失败，用户看到的是「搜不了」。
     * 超过这个时间还没探测，就强制回宿主页，宁可判成未授权也别把功能卡死。
     */
    const guard = setTimeout(() => {
      if (!probePending.current) return;
      probePending.current = false;
      ipLoginPending.current = false;
      webRef.current?.injectJavaScript(`location.href = ${JSON.stringify(HOST_URL)}; true;`);
    }, 14000);

    return () => {
      clearTimeout(t);
      clearTimeout(guard);
    };
  }, [ready, probeViaLogin]);

  /* ------------------------------------------------------------------ */
  /* 对外请求                                                            */
  /* ------------------------------------------------------------------ */
  /**
   * 在队列内部执行一次「导航 → 抽取 → 回宿主页」。
   * 跨子域时 fetch 拿不到页面（CORS），但导航过去本身没有这个限制，
   * 所以这条路径是详情页、附件页的兜底通道。
   */
  const navigateInQueue = useCallback(
    (
      url: string,
      spec: ExtractSpec | null,
      opts: { wantRaw?: boolean; wantLinks?: boolean; timeout?: number } = {},
    ): Promise<BridgeResponse> =>
      new Promise<BridgeResponse>((resolve, reject) => {
        const id = `nav_${Date.now()}_${seq.current++}`;
        const timer = setTimeout(() => {
          pending.current.delete(id);
          navTask.current = null;
          reject(new Error('页面加载超时'));
        }, opts.timeout ?? 30000);

        pending.current.set(id, { resolve: resolve as (v: any) => void, reject, timer });
        navTask.current = {
          url,
          spec,
          requestId: id,
          wantRaw: !!opts.wantRaw,
          wantLinks: !!opts.wantLinks,
        };
        webRef.current?.injectJavaScript(`location.href = ${JSON.stringify(url)}; true;`);
      }),
    [],
  );

  const request = useCallback(
    async <T,>(req: BridgeRequest): Promise<BridgeResponse & { data?: T }> => {
      await waitReady();
      return enqueue(async () => {
        let res: BridgeResponse & { data?: T };
        try {
          res = await callBridge(
            (id) =>
              buildExecCall({
                id,
                url: req.url,
                method: req.method || 'GET',
                headers: req.headers,
                body: req.body,
                spec: req.spec,
                wantRaw: req.wantRaw,
                wantText: req.wantText,
                wantLinks: req.wantLinks,
              }),
            req.timeout ?? 25000,
          );
        } catch (err: any) {
          /*
           * 详情页链接可能落在 www.cnki.net，而隐藏 WebView 停在 kns.cnki.net。
           * 这种 fetch 一定被浏览器按 CORS 拦掉（界面上就是 Failed to fetch），
           * 但页面本身打得开 —— 改走导航抓取，拿到的 HTML 一模一样。
           * 只对 GET 且需要解析的请求降级：POST 检索接口不存在这个场景。
           */
          if (
            err?.crossOrigin &&
            (req.method ?? 'GET') === 'GET' &&
            (req.spec || req.wantLinks)
          ) {
            res = (await navigateInQueue(req.url, req.spec ?? null, {
              wantRaw: !!req.wantRaw,
              wantLinks: !!req.wantLinks,
              timeout: req.timeout ?? 30000,
            })) as BridgeResponse & { data?: T };
          } else {
            throw err;
          }
        }

        if (res.blocked) {
          setBlocked(true);
          setSession((s) => ({
            ...s,
            status: 'anonymous',
            error: '安全验证已过期，请重新登录',
            checkedAt: Date.now(),
          }));
        }
        return res as BridgeResponse & { data?: T };
      });
    },
    [callBridge, enqueue, navigateInQueue, waitReady],
  );

  /* 导航式抓取：跨子域时改用真实导航，避免 CORS */
  const navigate = useCallback(
    async <T,>(url: string, spec: ExtractSpec | null, timeout = 30000): Promise<T> => {
      await waitReady();
      const res = await enqueue(() => navigateInQueue(url, spec, { timeout }));
      return res as unknown as T;
    },
    [enqueue, navigateInQueue, waitReady],
  );

  const openLogin = useCallback(
    (url?: string, opts?: { keepOpen?: boolean }) => {
      keepOpenRef.current = !!opts?.keepOpen;
      setLoginVisible(true);
      setLoadError(null);
      /* 之前在验证页上时不要跳走：滑块挑战是绑定当前会话的，
         重新导航会换一张新题，用户刚拖好的进度就白费了。 */
      const staying = !url && blocked && /\/verify\/home/.test(currentUrl.current);
      if (staying) {
        /*
         * 停在原来那张题上：补一次自检即可。
         * 这里绝不能重置「失效」标记 —— 一重置，用户就再也看不到
         * 「重新获取」，只能对着一个死掉的滑块反复试。
         */
        setTimeout(() => {
          webRef.current?.injectJavaScript(VERIFY_HEALTH_JS);
        }, 300);
        return;
      }
      setVerifyDead(false);
      const target = url || LOGIN_URL;
      /* 目标就是登录页时，加载完自动点「IP 登录」，用户只需要看结果 */
      if (target === LOGIN_URL) {
        probePending.current = true;
        ipLoginPending.current = true;
      }
      setTimeout(() => {
        webRef.current?.injectJavaScript(`location.href = ${JSON.stringify(target)}; true;`);
      }, 260);
    },
    [blocked],
  );

  /**
   * 换一张验证题。
   *
   * 滑块票是绑会话的，过期以后那张页面就成了死页面：没有题图、只显示
   * 「未注册服务」，用户怎么拖都不会过。这时候唯一的出路是回检索页
   * 重新发一次请求，让知网给一张新题 —— 而不是让他对着旧页面反复试。
   */
  const refreshVerify = useCallback(() => {
    setVerifyDead(false);
    setBlocked(false);
    setLoginVisible(false);
    keepOpenRef.current = false;
    probePending.current = false;
    setTimeout(() => {
      webRef.current?.injectJavaScript(`location.href = ${JSON.stringify(HOST_URL)}; true;`);
    }, 260);
  }, []);

  const closeLogin = useCallback(() => {
    setLoginVisible(false);
    keepOpenRef.current = false;

    /* 先去知网首页：IP 授权后那里的页头会由「IP 登录」变成机构名称，
       是全站最容易判断授权状态的一页。加载完成后由 handleLoadEnd 触发探测。 */
    probePending.current = true;
    setTimeout(() => {
      webRef.current?.injectJavaScript(`location.href = ${JSON.stringify(HOME_URL)}; true;`);
    }, 260);

    /* 兜底：网络卡住时 loadEnd 可能迟迟不来，不能让用户一直卡在「检测中」。 */
    setTimeout(() => {
      if (!probePending.current) return;
      probePending.current = false;
      const p = probeRef.current?.();
      if (!p) return;
      p.catch(() => undefined).then(() => {
        webRef.current?.injectJavaScript(`location.href = ${JSON.stringify(HOST_URL)}; true;`);
      });
    }, 9000);
  }, []);

  const value = useMemo<SessionContextValue>(
    () => ({
      ready,
      session,
      request,
      navigate,
      probe,
      getCookies,
      dump,
      openLogin,
      closeLogin,
      loginVisible,
      blocked,
    }),
    [
      ready,
      session,
      request,
      navigate,
      probe,
      getCookies,
      dump,
      openLogin,
      closeLogin,
      loginVisible,
      blocked,
    ],
  );

  /**
   * 唯一 WebView 实例。
   * 隐藏时移出屏幕而不是 display:none —— 后者会让部分内核暂停脚本执行，
   * 导致 cookie 写不进去、懒加载不触发。
   */
  const layerStyle = loginVisible
    ? [styles.layer, styles.layerVisible]
    : [styles.layer, styles.layerHidden];

  return (
    <SessionContext.Provider value={value}>
      <View style={styles.root}>
        {children}

        <View pointerEvents={loginVisible ? 'auto' : 'none'} style={layerStyle}>
          {loginVisible && (
            <View style={[styles.loginBar, { paddingTop: insets.top + spacing.sm }]}>
              <View style={{ flex: 1 }}>
                <Text style={styles.loginTitle}>
                  {blocked ? '安全验证' : '机构 / IP 登录'}
                </Text>
                <Text style={styles.loginHint} numberOfLines={2}>
                  {verifyDead
                    ? '这张验证题已经失效（知网没返回题图），点「重新获取」再试'
                    : session.status === 'ip' && session.orgName
                    ? `已识别到机构：${session.orgName}。点右上角「完成」返回`
                    : session.status === 'checking'
                    ? '正在核对机构权限…'
                    : blocked
                    ? '按住底部箭头，把方块拖到图片缺口处；没对上会自动弹回，重试即可'
                    : '正在自动完成 IP 登录，识别到学校名后会自动返回'}
                </Text>
              </View>
              {verifyDead && (
                <Pressable onPress={refreshVerify} style={styles.loginRetry} hitSlop={8}>
                  <RotateCw size={12} color={colors.primary} strokeWidth={2.6} />
                  <Text style={styles.loginRetryText}>重新获取</Text>
                </Pressable>
              )}
              <Pressable onPress={closeLogin} style={styles.loginDone} hitSlop={8}>
                <Text style={styles.loginDoneText}>完成</Text>
              </Pressable>
            </View>
          )}

          <WebViewAny
            ref={webRef}
            source={{ uri: HOST_URL }}
            userAgent={DESKTOP_UA}
            injectedJavaScript={BRIDGE_SCRIPT}
            onMessage={handleMessage}
            onLoadEnd={handleLoadEnd}
            sharedCookiesEnabled
            thirdPartyCookiesEnabled
            domStorageEnabled
            javaScriptEnabled
            cacheEnabled
            setBuiltInZoomControls
            setDisplayZoomControls={false}
            mixedContentMode="always"
            originWhitelist={['*']}
            onError={handleWebError}
            style={styles.web}
          />

          {loadError && loginVisible && (
            <View style={styles.errBox}>
              <AlertTriangle size={22} color={colors.warning} strokeWidth={2.2} />
              <Text style={styles.errTitle}>知网页面没能加载</Text>
              <Text style={styles.errDesc}>{loadError.description || '未知错误'}</Text>
              {!!loadError.url && (
                <Text style={styles.errUrl} numberOfLines={2}>
                  {loadError.url}
                </Text>
              )}
              <View style={styles.errActions}>
                <Pressable style={styles.errGhost} onPress={reloadWeb}>
                  <RotateCw size={13} color={colors.primary} strokeWidth={2.6} />
                  <Text style={styles.errGhostText}>重试</Text>
                </Pressable>
                <Pressable
                  style={styles.errPrimary}
                  onPress={() => Linking.openURL(loadError.url || LOGIN_URL)}
                >
                  <ExternalLink size={13} color={colors.textInverse} strokeWidth={2.6} />
                  <Text style={styles.errPrimaryText}>用浏览器打开</Text>
                </Pressable>
              </View>
            </View>
          )}
        </View>

        {booting && (
          <View pointerEvents="none" style={styles.bootOverlay}>
            <ActivityIndicator color={colors.primary} />
            <Text style={styles.bootText}>正在建立知网会话…</Text>
          </View>
        )}
      </View>
    </SessionContext.Provider>
  );
}

export function useSession(): SessionContextValue {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error('useSession 必须在 SessionProvider 内使用');
  return ctx;
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  layer: {
    position: 'absolute',
    backgroundColor: colors.surface,
    overflow: 'hidden',
  },
  layerHidden: {
    left: -3000,
    top: 0,
    width: 400,
    height: 800,
    opacity: 0,
  },
  layerVisible: {
    left: 0,
    top: 0,
    width: '100%',
    height: '100%',
    opacity: 1,
  },
  web: { flex: 1 },
  loginBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.md,
    backgroundColor: colors.surface,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  loginTitle: {
    fontSize: fontSize.title,
    fontWeight: '700',
    color: colors.text,
  },
  loginHint: {
    fontSize: fontSize.small,
    color: colors.textTertiary,
    marginTop: 2,
  },
  loginDone: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    backgroundColor: colors.primary,
    borderRadius: radius.pill,
  },
  loginDoneText: {
    color: colors.textInverse,
    fontSize: fontSize.body,
    fontWeight: '600',
  },
  loginRetry: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: spacing.md,
    paddingVertical: 6,
    borderRadius: radius.pill,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  loginRetryText: {
    fontSize: fontSize.small,
    fontWeight: '600',
    color: colors.primary,
  },
  bootOverlay: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.bg,
    gap: spacing.md,
  },
  bootText: {
    fontSize: fontSize.body,
    color: colors.textSecondary,
  },
  errBox: {
    position: 'absolute',
    left: spacing.lg,
    right: spacing.lg,
    top: '30%',
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    padding: spacing.lg,
    gap: spacing.xs,
    alignItems: 'center',
  },
  errTitle: {
    fontSize: fontSize.bodyLg,
    fontWeight: '700',
    color: colors.text,
    marginTop: spacing.xs,
  },
  errDesc: {
    fontSize: fontSize.body,
    color: colors.danger,
    textAlign: 'center',
  },
  errUrl: {
    fontSize: fontSize.caption,
    color: colors.textTertiary,
    textAlign: 'center',
  },
  errActions: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginTop: spacing.md,
  },
  errGhost: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    borderRadius: radius.pill,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  errGhostText: {
    fontSize: fontSize.body,
    fontWeight: '600',
    color: colors.primary,
  },
  errPrimary: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    borderRadius: radius.pill,
    backgroundColor: colors.primary,
  },
  errPrimaryText: {
    fontSize: fontSize.body,
    fontWeight: '600',
    color: colors.textInverse,
  },
});
