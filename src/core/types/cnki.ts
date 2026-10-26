/** 知网文献类型 */
export type DocType =
  | 'journal'
  | 'thesis'
  | 'conference'
  | 'newspaper'
  | 'patent'
  | 'standard'
  | 'other';

/** 检索结果中的一条文献记录 */
export interface CnkiDoc {
  /** 稳定标识，用作列表 key 与收藏主键 */
  id: string;
  title: string;
  authors: string[];
  /** 期刊名 / 学位授予单位 / 会议名 / 报纸名 */
  source: string;
  /** 展示用日期字符串 */
  date: string;
  type: DocType;
  cited?: number;
  downloads?: number;
  /** 详情页相对或绝对链接 */
  href: string;
  /** 数据库代码，如 CJFD / CDMD */
  dbcode?: string;
  /** 知网文件名，如 CNKI:SUN:JSJY.0.2024-01-001，用于下载与引用 */
  filename?: string;
  abstract?: string;
  keywords?: string[];
  /** 卷期、页码等 */
  issue?: string;
  /** 是否有全文下载权限（由会话环境推断） */
  accessible?: boolean;
}

/** 一次检索请求的参数 */
export interface SearchParams {
  keyword: string;
  /** 检索字段：SU 主题 / TI 篇名 / KY 关键词 / AB 摘要 / AU 作者 / FI 第一作者 / AF 机构 */
  field?: SearchField;
  page?: number;
  pageSize?: number;
  /** 排序：相关度 / 发表时间 / 被引 / 下载 */
  sort?: 'relevance' | 'date' | 'cited' | 'download';
  /** 文献类型过滤，空数组表示全部 */
  types?: DocType[];
  /** 来源类别（期刊级别）代码，如 P0209 = CSSCI，见 api/query.ts 的 JOURNAL_LEVELS */
  levels?: string[];
  /** 时间范围，如 ['2020', '2026'] */
  yearRange?: [string, string];
  /** 翻页令牌：第 1 页响应里的 hidTurnPage，第 2 页起必须原样带回 */
  turnpage?: string;
}

export type SearchField =
  | 'SU'
  | 'TI'
  | 'KY'
  | 'AB'
  | 'AU'
  | 'FI'
  | 'AF'
  | 'FT';

export const SEARCH_FIELDS: { key: SearchField; label: string }[] = [
  { key: 'SU', label: '主题' },
  { key: 'TI', label: '篇名' },
  { key: 'KY', label: '关键词' },
  { key: 'AB', label: '摘要' },
  { key: 'AU', label: '作者' },
  { key: 'FI', label: '第一作者' },
  { key: 'AF', label: '机构' },
  { key: 'FT', label: '全文' },
];

/** 检索结果分页 */
export interface SearchResult {
  docs: CnkiDoc[];
  total: number;
  page: number;
  totalPages: number;
  /** 下一页要用的令牌 */
  turnpage?: string;
}

/** 文献详情 */
export interface DocDetail extends CnkiDoc {
  /** 中文摘要 */
  abstractCn?: string;
  /** 英文摘要 */
  abstractEn?: string;
  keywordsCn?: string[];
  keywordsEn?: string[];
  /** 基金资助 */
  funds?: string[];
  /** 专辑/专题 */
  albums?: string[];
  /** DOI */
  doi?: string;
  /** 分类号 */
  clc?: string;
  /** 参考文献条数 */
  refCount?: number;
  /** 引证文献条数 */
  citeCount?: number;
  /** 在线阅读地址（知网 HTML 阅读，正文按段落渲染，手机上最好读） */
  readUrl?: string;
  /** 原版阅读地址（保留 PDF 版式） */
  ybUrl?: string;
  /** PDF 下载地址 */
  pdfUrl?: string;
  /** CAJ 下载地址 */
  cajUrl?: string;
  /** 附件 / 补充材料 */
  attachments?: { name: string; url: string }[];
}

/** 登录 / 权限会话状态 */
export interface SessionState {
  /** unknown 表示还没探测过 */
  status: 'unknown' | 'checking' | 'anonymous' | 'ip' | 'account';
  /** 机构名称，IP 登录成功后由页面上的机构标识解析而来 */
  orgName?: string;
  /** 是否具备全文下载权限 */
  hasFullText?: boolean;
  /** 最近一次探测时间 */
  checkedAt?: number;
  /** 探测失败原因 */
  error?: string;
  /**
   * 失败原因的机器可读版本。
   * `no-org` 表示「页面正常但没找到机构名」，是唯一值得换个页面再试一次的情况；
   * 其余几种（滑块 / 明确显示未授权）都是确定结论，再探也没用。
   */
  reason?: 'blocked' | 'offsite' | 'ip-entry' | 'guest' | 'no-org' | 'personal-only';
  /**
   * 机构名是从哪读到的。
   * cookie 表示直接解析了知网自己的登录态 Ecp_LoginStuts（最可信）；
   * sel 是页头固定 class；text 是文本兜底扫描（最弱）。
   */
  orgSource?: 'cookie' | 'sel' | 'text';
  /**
   * 探测时抓到的页面证据（页头文本片段）。
   * 用来区分「这个网络确实没被机构授权」和「授权了但解析规则没认出机构名」，
   * 设置页会把它显示出来，方便反馈校准。
   */
  evidence?: string;
  /** 探测时页面实际停在的地址 */
  pageUrl?: string;
}

/** 期刊导航条目 */
export interface Journal {
  id: string;
  name: string;
  /** 主办单位 */
  sponsor?: string;
  /**  ISSN / CN */
  issn?: string;
  cn?: string;
  /** 核心期刊标识：北大核心 / CSSCI / CSCD 等 */
  coreTypes?: string[];
  /** 影响因子 */
  impactFactor?: string;
  /** 收录数据库 */
  databases?: string[];
  href?: string;
}

/** 本地收藏条目 */
export interface Bookmark extends CnkiDoc {
  savedAt: number;
  note?: string;
}

/** 浏览历史条目 */
export interface HistoryItem extends CnkiDoc {
  viewedAt: number;
}
