import { ExtractSpec } from '@/core/bridge/script';
import { BridgeRequest, BridgeResponse } from '@/core/bridge/SessionProvider';
import {
  CnkiDoc,
  DocDetail,
  DocType,
  SearchParams,
  SearchResult,
} from '@/core/types/cnki';
import { buildSearchBody, DOC_SCOPES } from '@/core/api/query';

/* 请求体构造在 ./query —— 刻意零依赖，好让 scripts/lab 的验证工具
   加载同一份代码，避免「工具能搜、真机不能搜」这种两面不一致。 */

/** 知网 KNS8 检索接口 */
const GRID_URL = 'https://kns.cnki.net/kns8s/brief/grid';
/** 检索结果页（用于兜底与跳转） */
export const RESULT_PAGE = 'https://kns.cnki.net/kns8s/defaultresult/index';

const PAGE_SIZE = 20;

export type CnkiErrorCode = 'BLOCKED' | 'NETWORK' | 'PARSE' | 'UNKNOWN';

export class CnkiError extends Error {
  code: CnkiErrorCode;
  /** 被风控拦截时，知网给出的滑块验证地址，可直接拿去打开 */
  challengeUrl?: string;
  constructor(code: CnkiErrorCode, message: string, challengeUrl?: string) {
    super(message);
    this.name = 'CnkiError';
    this.code = code;
    this.challengeUrl = challengeUrl;
  }
}

/** 请求执行器，由 SessionProvider 注入，避免 API 层耦合 React */
export type Requester = <T = unknown>(
  req: BridgeRequest,
) => Promise<BridgeResponse & { data?: T }>;

/* ------------------------------------------------------------------ */
/* 检索结果抽取规则                                                     */
/*                                                                     */
/* 知网改版频繁，所以每个字段都给多个候选选择器（CSS 逗号 = 或语义）。   */
/* 真机上一旦发现某字段为空，改这里即可，不用动 UI。                     */
/* ------------------------------------------------------------------ */
export const SEARCH_SPEC: ExtractSpec = {
  row: '.result-table-list tbody tr, table.result-table-list tbody tr, .result-table tbody tr',
  fields: {
    title: { sel: 'td.name a, td.title a, a.fz14' },
    href: { sel: 'td.name a, td.title a, a.fz14', from: '@href' },
    author: { sel: 'td.author, td.au, .author' },
    /* 期刊是 td.source，学位论文的「学位授予单位」在 td.unit，标准在 td.unit */
    source: { sel: 'td.source, td.unit, .source' },
    date: { sel: 'td.date, .date' },
    cited: { sel: 'td.quote, td.cited, .quote' },
    download: { sel: 'td.download, .download' },
    /* 「数据库」列：期刊 / 硕士 / 博士 / 会议 / 报纸 / 标准。
       这是页面上唯一能区分文献类型的地方，缺了会把学位论文当成期刊。 */
    tag: { sel: 'td.data, td.name .tags, td.name .label', from: 'text' },
    dbcode: { sel: 'td.name a, a.fz14', from: '@data-dbcode' },
    filename: { sel: 'td.name a, a.fz14', from: '@data-filename' },
  },
  meta: {
    total: '#hidTotalCount, .pagerTitleCell em, .total-count, #totalCount',
    // 第 2 页起必须回传这个隐藏域，否则知网当成新检索、直接返回空
    turnpage: { sel: '#hidTurnPage', from: '@value' },
  },
};

/** 详情页抽取规则 */
export const DETAIL_SPEC: ExtractSpec = {
  fields: {
    title: 'h1, .wx-tit h1, .doc-title h1',
    authors: '.author .cont, #authorpart a, .author a, .author',
    source: '.top-tip a, .top-tip, .doc-top .source',
    abstractCn: '#ChDivSummary, .abstract-text, .abstract',
    abstractEn: '.abstract-en, #EnChDivSummary',
    keywordsCn: { sel: '.keywords a, p.keywords a, .keyword a', from: 'all' },
    doi: '.doi, p.doi, .top-tip .doi',
    funds: { sel: '.funds a, .fund a, #fund a', from: 'all' },
    album: '.album, .subject',
    clc: '.clc, .classcode',
    /* 下载入口和详情在同一张页面上，一次请求全部拿走，省一个往返。
       选择器放得比较宽：知网不同库（期刊/学位/会议）的下载按钮 id 不一致。 */
    pdf: {
      sel: '#pdfDown, a[href*="pdfdown"], a[href*="download"], .btn-pdf a, a[href*=".pdf"]',
      from: '@href',
    },
    caj: { sel: '#cajDown, a[href*="caj"], .btn-caj a', from: '@href' },
    /* 只认明确标注过的阅读按钮。早期这里还有 `a[href*="read"]` 兜底，
       结果学位论文页面上没有 HTML 阅读时，它把别的链接抓进来，
       打开后落到「知网研学」推广页——比没有入口更糟。 */
    read: { sel: '#readOnline, .btn-read a, a.yb-read', from: '@href' },
  },
  meta: {
    refCount: '#reference_count, .ref-count',
    citeCount: '#cited_count, .cite-count',
  },
};

/* ------------------------------------------------------------------ */
/* 工具函数                                                            */
/* ------------------------------------------------------------------ */
function toNumber(v?: string): number | undefined {
  if (!v) return undefined;
  const n = parseInt(v.replace(/[^\d]/g, ''), 10);
  return Number.isFinite(n) ? n : undefined;
}

function splitList(v?: string): string[] {
  if (!v) return [];
  return v
    .split(/[;；,，、]/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * 依据「数据库」列（期刊 / 硕士 / 博士 / 会议 / 报纸 / 标准）推断文献类型。
 *
 * 早期的写法只看 dbcode 和「学位/博士」这类词，而列表页的 dbcode 属性
 * 经常是空的，结果所有条目都被兜底成期刊——学位论文显示成期刊、
 * 按类型筛选也永远筛不到。现在以标签文案为主。
 */
function inferType(dbcode?: string, tag?: string): DocType {
  const d = (dbcode || '').toUpperCase();
  const t = (tag || '').trim();
  if (/CDMD|CMFD|CDFD/.test(d) || /博士|硕士|学位/.test(t)) return 'thesis';
  if (/CPFD|CPVD|IPFD/.test(d) || /会议/.test(t)) return 'conference';
  if (/CCND/.test(d) || /报纸/.test(t)) return 'newspaper';
  if (/SIPD/.test(d) || /专利/.test(t)) return 'patent';
  if (/SCSD|SNAD/.test(d) || /标准/.test(t)) return 'standard';
  if (/CJFD|CJFQ|CJFN|CAPJ|CJTL/.test(d) || /期刊/.test(t)) return 'journal';
  if (/图书/.test(t)) return 'other';
  return 'journal';
}

/** 把相对链接补成绝对链接 */
function absUrl(href: string): string {
  if (!href) return '';
  if (/^https?:/i.test(href)) return href;
  if (href.startsWith('//')) return `https:${href}`;
  return `https://kns.cnki.net${href.startsWith('/') ? '' : '/'}${href}`;
}

function docIdFromHref(href: string, fallback: string): string {
  const m = href.match(/[?&]v=([^&]+)/);
  if (m) return m[1];
  return fallback;
}

export async function searchDocs(
  request: Requester,
  params: SearchParams,
): Promise<SearchResult> {
  if (!params.keyword.trim()) {
    return { docs: [], total: 0, page: 1, totalPages: 0 };
  }

  /*
   * 类型筛选分两条路：
   *   只勾一个类型  → 直接在该库里检索，条数准、翻页也准；
   *   勾多个/勾了专利 → 跨库检索后在客户端挑（专利库参数拿不到，只能这样）。
   * 后者只过滤第一页会出现「勾了学位论文一片空白」的假象，
   * 所以带筛选时自动往后多翻几页，凑够一批命中再返回。
   *
   * 来源类别（CSSCI / 北大核心）走的是知网自己的检索条件，服务端就筛好了，
   * 不需要在这里再翻页凑数。
   */
  const scope =
    params.types && params.types.length === 1 ? DOC_SCOPES[params.types[0]] : undefined;
  const levels = params.levels && params.levels.length ? params.levels : undefined;
  const clientFiltered =
    !scope && ((params.types && params.types.length > 0) || !!params.yearRange);
  const MAX_SCAN = clientFiltered ? 6 : params.yearRange ? 3 : 1;
  const ENOUGH = 10;

  const send = (page: number, turnpage?: string) =>
    request<any>({
      url: GRID_URL,
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
        // 必须声明是 AJAX 请求，知网才会返回表格片段；
        // 未通过风控时它会用 403 JSON 回一个滑块地址，由桥接层识别。
        'X-Requested-With': 'XMLHttpRequest',
      },
      body: buildSearchBody({ ...params, page, scope, levels }, turnpage),
      spec: SEARCH_SPEC,
      timeout: 30000,
    });

  let docs: CnkiDoc[] = [];
  let total = 0;
  let totalPages = 1;
  let page = params.page ?? 1;
  let turnpage = params.turnpage;
  let scanned = 0;

  while (scanned < MAX_SCAN) {
    let res: BridgeResponse & { data?: any };
    try {
      res = await send(page, turnpage);
      /* 知网后端偶发 500 空壳（「数据服务获取数据异常」），重试一次通常就恢复。
         不重试的话用户会把它当成「关键词没有结果」，怎么换词都搜不出来。 */
      if (res.serverError) {
        await new Promise((r) => setTimeout(r, 1200));
        res = await send(page, turnpage);
      }
    } catch (err: any) {
      if (scanned > 0) break; // 已经拿到一些结果就先给用户，别整体报错
      throw new CnkiError('NETWORK', err?.message || '检索请求失败');
    }

    if (res.blocked) {
      if (scanned > 0) break;
      throw new CnkiError(
        'BLOCKED',
        '需要先完成一次安全验证（滑块），与 IP 登录无关',
        res.challengeUrl,
      );
    }

    if (res.serverError) {
      if (scanned > 0) break;
      throw new CnkiError('NETWORK', '知网数据服务暂时异常，请稍后重试');
    }

    /* 200 + 74 字节空壳 = 会话被知网软拒绝。
       这个分支必须排在解析之前，否则会被当成「关键词没有结果」，
       用户看到的就是一句没有信息量的「暂无数据」。 */
    const rows: any[] = Array.isArray(res.data) ? res.data : [];
    if (res.softBlocked && rows.length === 0) {
      if (scanned > 0) break;
      throw new CnkiError(
        'BLOCKED',
        '知网拒绝了这次检索（只返回一个空壳响应），需要先在知网页面完成一次人机验证',
        /* 软拒绝拿不到知网给的验证地址，就直接指向检索页：
           它会 302 到滑块页，用户在上面拖一下就能继续。 */
        `${RESULT_PAGE}?kw=${encodeURIComponent(params.keyword)}&korder=${params.field || 'SU'}`,
      );
    }

    total = toNumber(res.meta?.total) ?? rows.length;
    totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
    turnpage = res.meta?.turnpage || turnpage;
    scanned++;

    const pageDocs = rows
      .map((r, i) => {
        const href = absUrl(r.href || '');
        const title = (r.title || '').trim();
        if (!title) return null;
        return {
          id: docIdFromHref(href, `p${page}_${i}_${title.slice(0, 12)}`),
          title,
          authors: splitList(r.author),
          source: (r.source || '').trim(),
          date: (r.date || '').trim(),
          /* 单库检索时类型已经由库决定，比猜标签可靠（标准库的条目根本没有类型列） */
          type: scope && params.types ? params.types[0] : inferType(r.dbcode, r.tag),
          cited: toNumber(r.cited),
          downloads: toNumber(r.download),
          href,
          dbcode: r.dbcode || undefined,
          filename: r.filename || undefined,
        } as CnkiDoc;
      })
      .filter((d): d is CnkiDoc => d !== null)
      .filter((d) => {
        /* 单库检索的结果不用再挑类型；多类型时只能客户端挑 */
        if (!scope && params.types && params.types.length > 0) {
          if (!params.types.includes(d.type)) return false;
        }
        if (params.yearRange) {
          const [from, to] = params.yearRange;
          const y = (d.date || '').slice(0, 4);
          if (/^\d{4}$/.test(y) && (y < from || y > to)) return false;
        }
        return true;
      });

    docs = docs.concat(pageDocs);

    if (!clientFiltered) break;
    if (docs.length >= ENOUGH) break;
    if (page >= totalPages) break;

    page++;
    await new Promise((r) => setTimeout(r, 260)); // 别把知网惹毛
  }

  return {
    docs,
    total,
    /* 返回实际扫到的那一页，界面的「加载更多」要接着这里往后翻 */
    page,
    totalPages,
    turnpage,
  };
}

/* ------------------------------------------------------------------ */
/* 详情                                                                */
/* ------------------------------------------------------------------ */
export async function getDocDetail(
  request: Requester,
  doc: CnkiDoc,
): Promise<DocDetail> {
  if (!doc.href) throw new CnkiError('PARSE', '缺少文献链接');

  const res = await request<any>({
    url: doc.href,
    spec: DETAIL_SPEC,
    wantLinks: true,
    timeout: 30000,
  });

  if (res.blocked) {
    throw new CnkiError('BLOCKED', '需要完成安全验证后才能查看详情');
  }

  const d = (res.data || {}) as Record<string, string>;
  const raw = res.raw || '';
  const links: { t: string; h: string }[] = Array.isArray(res.links) ? res.links : [];

  /*
   * 四个全文入口在页面上是同一套 bar.cnki.net 地址，只能靠按钮文案区分：
   *   HTML阅读 / 原版阅读 / PDF下载 / CAJ下载
   * 所以不按 href 猜，直接按文案取第一条命中的链接。
   * 文案匹配不放首尾锚点：按钮里常夹图标 span 或「（网络首发）」这类后缀。
   */
  const byText = (re: RegExp) => {
    const hit = links.find((l) => re.test(l.t.trim()) && !!l.h);
    return hit ? hit.h : '';
  };

  // 文案优先。选择器只做兜底：`a[href*="download"]` 这种宽匹配可能命中附件或另一种格式。
  const readUrl = byText(/HTML\s*阅读/i) || d.read || '';
  const ybUrl = byText(/原版阅读/);
  const pdfUrl = byText(/PDF\s*下载/i) || d.pdf || '';
  const cajUrl = byText(/CAJ\s*下载/i) || d.caj || '';

  // 下载按钮有时是异步渲染的，抽不到就用页面里的下载链接兜底
  let pdfFallback = pdfUrl;
  if (!pdfFallback && raw) {
    const m = raw.match(/href="([^"]*download[^"]*\.ashx[^"]*)"/i);
    if (m) pdfFallback = absUrl(m[1]);
  }

  /* 附件只在部分文献上出现（补充材料、数据集、图表），
     且同样走 bar 网关。按文案挑，取不到就当没有。 */
  const seen = new Set<string>();
  const attachments = links
    .filter(
      (l) =>
        /附件|补充材料|支撑材料|附录/i.test(l.t) &&
        !/^javascript:/i.test(l.h) &&
        /download|attach|bar\.cnki|\.(pdf|docx?|xlsx?|pptx?|zip|rar)(?:$|[?#])/i.test(l.h),
    )
    .filter((l) => (seen.has(l.h) ? false : (seen.add(l.h), true)))
    .map((l) => ({ name: l.t.trim() || '附件', url: l.h }));

  return {
    ...doc,
    abstractCn: d.abstractCn || doc.abstract,
    abstractEn: d.abstractEn || undefined,
    keywordsCn: splitList(d.keywordsCn),
    authors: splitList(d.authors).length ? splitList(d.authors) : doc.authors,
    source: d.source || doc.source,
    doi: d.doi || undefined,
    funds: splitList(d.funds),
    refCount: toNumber(res.meta?.refCount),
    citeCount: toNumber(res.meta?.citeCount),
    readUrl: readUrl ? absUrl(readUrl) : undefined,
    ybUrl: ybUrl ? absUrl(ybUrl) : undefined,
    pdfUrl: pdfFallback ? absUrl(pdfFallback) : undefined,
    cajUrl: cajUrl ? absUrl(cajUrl) : undefined,
    attachments: attachments.length ? attachments : undefined,
  };
}

/* ------------------------------------------------------------------ */
/* 权限自检                                                            */
/*                                                                     */
/* 用一个必定需要权限的入口探测：能正常返回检索结果就说明会话可用。      */
/* ------------------------------------------------------------------ */
export async function checkAccess(request: Requester): Promise<{
  ok: boolean;
  blocked: boolean;
  message: string;
  detail?: string;
}> {
  try {
    const res = await request<any>({
      url: GRID_URL,
      method: 'POST',
      headers: {
        // 不要加 X-Requested-With：知网见到它会直接返回 403 JSON 风控包，
        // 去掉后才是可解析的 HTML 片段（#briefBox 里的 result-table-list）。
        'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
      },
      body: buildSearchBody({ keyword: '人工智能', page: 1 }),
      spec: SEARCH_SPEC,
      timeout: 20000,
    });

    if (res.blocked) {
      return { ok: false, blocked: true, message: '被风控拦截，需要先完成滑块验证（与 IP 登录无关）' };
    }
    if (res.softBlocked) {
      return {
        ok: false,
        blocked: true,
        message: '知网拦截了检索请求（只回了一个空壳响应），需要先在知网页面完成一次人机验证',
      };
    }
    const rows = Array.isArray(res.data) ? res.data : [];
    if (rows.length === 0) {
      return { ok: false, blocked: false, message: '接口未返回结果，可能结构已变更' };
    }
    return { ok: true, blocked: false, message: `检索接口正常，返回 ${rows.length} 条` };
  } catch (err: any) {
    return { ok: false, blocked: false, message: err?.message || '探测失败' };
  }
}
