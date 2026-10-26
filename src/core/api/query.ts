/*
 * 知网检索请求体构造 —— 刻意做成零依赖的纯函数。
 *
 * 抽出来的原因：这套字段名（Field / Operator / Vector / Title）和
 * 翻页令牌规则一旦写错，知网照样回 200，只是内容变成「抱歉，暂无数据」，
 * 从现象上完全看不出是参数错还是没权限。所以必须能被独立验证：
 * scripts/lab 会直接加载本文件，在浏览器里用同一份代码发请求，
 * 排查时改一次就同时改到 App 和验证工具，不会出现「工具通过、真机不过」。
 */

/** 检索字段码 → 中文标题。Title 只用于结果页回显，取值不影响命中。 */
export const FIELD_TITLES: Record<string, string> = {
  SU: '主题',
  TI: '篇名',
  KY: '关键词',
  AB: '摘要',
  AU: '作者',
  FI: '第一作者',
  AF: '机构',
  FT: '全文',
};

/** 跨库范围：知网前端固定传这一串，少了会退化成单库甚至空结果 */
export const KUAKU_CODE =
  'YSTT4HG0,LSTPFY1C,EMRPGLPA,JUP3MUPD,MPMFIG1A,WQ0UVIAA,BLZOG7CK,PWFIRAGL,NN3FJMUV,NLBO1Z6R';

/** 翻页时 QueryJson.Products 要显式列出产品码，否则第 2 页起为空 */
export const PAGED_PRODUCTS =
  'CJFQ,CAPJ,ZHYX,CJTL,CDFD,CMFD,WBFD,CPFD,IPFD,CCND,SCSF,SCHF,SCSD,SNAD,CCJD,CJFN,CCVD';

/** 排序码：知网用 FFD/PT/CF/DFR，不是 relevance 这种自然语言 */
export const SORT_CODES: Record<string, string> = {
  relevance: 'FFD',
  date: 'PT',
  cited: 'CF',
  download: 'DFR',
};

/**
 * 单库检索参数。
 *
 * 知网跨库接口只认 classid/resource，直接传 dbcode 只会得到
 * 「检索模型参数错误」。这几个值是从知网结果页的 #briefRequest 隐藏域里
 * 读出来的（结果页支持 ?dbcode=CDMD 这类参数，页面自己会渲染正确配置），
 * 取一次固定下来，之后就不再依赖页面。
 */
export interface DocScope {
  classid: string;
  resource: string;
  products: string;
  searchFrom: string;
}

export const DOC_SCOPES: Record<string, DocScope> = {
  thesis: {
    classid: 'LSTPFY1C',
    resource: 'DISSERTATION',
    products: 'CDFD,CMFD',
    searchFrom: '资源范围：学位论文',
  },
  journal: {
    classid: 'YSTT4HG0',
    resource: 'JOURNAL',
    products: 'CJFQ,CAPJ,ZHYX,CJTL',
    searchFrom: '资源范围：学术期刊',
  },
  conference: {
    classid: '1UR4K4HZ',
    resource: 'CONFERENCE',
    products: 'CPFD',
    searchFrom: '资源范围：国内会议',
  },
  newspaper: {
    classid: 'MPMFIG1A',
    resource: 'NEWSPAPER',
    products: 'CCND',
    searchFrom: '资源范围：报纸',
  },
  standard: {
    classid: 'HR1YT1Z9',
    resource: 'STANDARD',
    products: 'SCSD,SOSD',
    searchFrom: '资源范围：标准题录',
  },
};

/** 单库请求体的 productStr：知网页面固定传这一串，缺了会退回「产品视图配置不存在」 */
const SCOPED_PRODUCT_STR =
  'YSTT4HG0,LSTPFY1C,RMJLXHZ3,JQIRZIYA,EMRPGLPA,J708GVCE,JUP3MUPD,1UR4K4HZ,BPBAFJ5S,MPMFIG1A,WQ0UVIAA,NB3BWEHK,XVLO76FD,HR1YT1Z9,BLZOG7CK,PWFIRAGL,NN3FJMUV,NLBO1Z6R,';

export interface QueryParams {
  keyword: string;
  /** 字段码，如 SU / TI / AU */
  field?: string;
  page?: number;
  pageSize?: number;
  sort?: string;
  /** 单库限定；不传表示跨库（总库） */
  scope?: DocScope;
  /** 期刊级别代码（北大核心 / CSSCI / CSCD …），见 JOURNAL_LEVELS */
  levels?: string[];
}

/**
 * 「来源类别」筛选：勾了核心期刊以后，结果里只剩这些库收录的期刊。
 *
 * 代码是知网结果页左侧勾选框的 value，接口认它、不认中文名。
 * 一次勾多个是「或」的关系（CSSCI + 北大核心 = 两类并集）。
 */
export const JOURNAL_LEVELS: { code: string; label: string }[] = [
  { code: 'P01', label: '北大核心' },
  { code: 'P0209', label: 'CSSCI' },
  { code: 'P0210', label: 'CSCD' },
  { code: 'P13', label: 'AMI' },
  { code: 'P0202', label: 'EI' },
  { code: 'P0201', label: 'SCI' },
];

/** 跨库请求里的来源类别分组（大写字段名那套） */
function levelGroup(codes: string[]) {
  return {
    Key: 'SCDBGroup',
    Title: '',
    Logic: 0,
    Items: [],
    ChildItems: [
      {
        Key: 'LYBSM',
        Title: '',
        Logic: 0,
        Items: codes.map((code) => ({
          Key: code,
          Title: '',
          Logic: 1,
          Field: 'LYBSM',
          Operator: 'DEFAULT',
          Value: code,
          Value2: '',
          options: {},
          Name: 'LYBSM',
          ExtendType: 0,
        })),
        ChildItems: [],
      },
    ],
  };
}

/** 单库请求里的同一分组（小写字段名那套） */
function levelGroupScoped(codes: string[]) {
  return {
    key: 'SCDBGroup',
    title: '',
    logic: 'AND',
    items: [],
    childItems: [
      {
        key: 'LYBSM',
        title: '',
        logic: 'AND',
        items: codes.map((code) => ({
          key: code,
          title: '',
          logic: 'AND',
          field: 'LYBSM',
          operator: 'DEFAULT',
          value: code,
          value2: '',
          options: {},
          name: 'LYBSM',
          extendType: 0,
        })),
        childItems: [],
      },
    ],
  };
}

export function fieldTitle(field?: string): string {
  return FIELD_TITLES[field || 'SU'] || '主题';
}

/*
 * 检索页地址。
 *
 * 会话没过滑块时，知网的检索接口只回 403，拿不到结果；此时唯一
 * 合法且有效的做法是把用户送到这个页面，由他本人拖动滑块完成验证。
 * 验证通过后同一会话就能正常检索，不需要重复验证。
 */
export function buildSearchPageUrl(keyword: string, field?: string): string {
  return (
    'https://kns.cnki.net/kns8s/defaultresult/index?kw=' +
    encodeURIComponent(keyword) +
    '&korder=' +
    encodeURIComponent(field || 'SU')
  );
}

/**
 * 单库请求的 QueryJson。
 *
 * 字段名特意用页面原样的小写（resource/classid/qnode），和跨库那份大写
 * 结构不共用：知网两边各有一套解析器，混用会回「产品视图配置不存在」。
 */
function buildScopedQueryJson(params: QueryParams, forNextPage: boolean) {
  const field = params.field || 'SU';
  const scope = params.scope!;
  const levels = params.levels && params.levels.length ? params.levels : null;
  return {
    resource: scope.resource,
    classid: scope.classid,
    exScope: '1',
    view: null,
    searchType: 2,
    searchFrom: forNextPage ? 4 : 1,
    select: null,
    aggr: null,
    rlang: 'Chinese',
    pageNum: null,
    pageSize: null,
    sort: null,
    sortType: null,
    fx: null,
    simpTrad: '0',
    expands: {},
    kuaKuCode: '',
    qnode: {
      qgroup: [
        {
          key: 'Subject',
          title: '',
          logic: 'AND',
          items: [
            {
              logic: 'AND',
              operator: 'TOPRANK',
              field,
              value: params.keyword,
              value2: null,
              options: null,
              title: fieldTitle(field),
            },
          ],
          childItems: [],
        },
        ...(levels ? [levelGroupScoped(levels)] : []),
      ],
    },
    Products: scope.products,
  };
}

export function buildQueryJson(params: QueryParams, forNextPage: boolean) {
  if (params.scope) return buildScopedQueryJson(params, forNextPage);
  const field = params.field || 'SU';
  const levels = params.levels && params.levels.length ? params.levels : null;
  return {
    Platform: '',
    Resource: 'CROSSDB',
    Classid: 'WD0FTY92',
    Products: forNextPage ? PAGED_PRODUCTS : '',
    QNode: {
      QGroup: [
        {
          Key: 'Subject',
          Title: '',
          Logic: 0,
          Items: [
            {
              Field: field,
              Value: params.keyword,
              Operator: 'TOPRANK',
              Logic: 0,
              Vector: '',
              Title: fieldTitle(field),
            },
          ],
          ChildItems: [],
        },
        ...(levels ? [levelGroup(levels)] : []),
      ],
    },
    ExScope: 1,
    SimpTrad: '0',
    SearchType: 2,
    Rlang: 'CHINESE',
    KuaKuCode: KUAKU_CODE,
    Expands: {},
    View: 'changeDBCh',
    /* 带来源类别筛选时知网页面用 2 标记「结果集已收窄」，翻页仍用 4 */
    SearchFrom: forNextPage ? 4 : levels ? 2 : 1,
  };
}

export function buildSearchBody(params: QueryParams, turnpage?: string): string {
  const page = params.page ?? 1;
  const isFirst = page <= 1;
  const sortCode = SORT_CODES[params.sort || 'relevance'] || 'FFD';

  /* 第 1 页按「发表时间」排序时，知网要求 sortField 传空串（等价于站点默认） */
  const sortField = isFirst ? (params.sort === 'date' ? '' : sortCode) : sortCode;
  const sortType = sortField ? 'desc' : '';

  const json = buildQueryJson(params, !isFirst);
  const aside = isFirst ? `(${fieldTitle(params.field)}：${params.keyword})` : '';

  const pairs: [string, string][] = [
    ['boolSearch', isFirst ? 'true' : 'false'],
    ['QueryJson', JSON.stringify(json)],
    ['pageNum', String(page)],
    ['pageSize', String(params.pageSize ?? 20)],
    ['sortField', sortField],
    ['sortType', sortType],
    ['dstyle', 'listmode'],
    ['productStr', params.scope ? SCOPED_PRODUCT_STR : ''],
    ['aside', aside],
    ['searchFrom', params.scope ? params.scope.searchFrom : '资源范围：总库'],
    ['subject', ''],
    ['language', ''],
    ['uniplatform', ''],
  ];

  /* 单库检索要多带这三个：接口靠它们挑解析器，缺了就是「参数错误」 */
  if (params.scope) {
    pairs.push(['classid', params.scope.classid]);
    pairs.push(['resource', params.scope.resource]);
    pairs.push(['kuakuCode', '']);
  }

  if (isFirst) {
    pairs.push(['CurPage', '1']);
  } else {
    // 翻页必须带上第 1 页响应里的令牌，否则知网会当成一次新检索
    pairs.push(['boolSortSearch', 'false']);
    pairs.push(['turnpage', turnpage || '']);
  }

  return pairs.map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join('&');
}
