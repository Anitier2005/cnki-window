/**
 * 设计系统 —— 单一数据源
 *
 * 配色来源于知网品牌色（深蓝 + 印章红），但整体调性向「学术阅读器」靠拢：
 * 低饱和、大留白、信息密度可控。目标是在手机上把 PC 端那种一屏两百字的
 * 检索结果，重排成可以单手拇指滚动阅读的形态。
 */

export const colors = {
  /** 品牌主色：知网蓝 */
  primary: '#1B4B8F',
  primaryDark: '#123A6E',
  primaryLight: '#E8EFF9',
  /** 强调色：印章红，用于「有权限」「核心期刊」这类强提示 */
  accent: '#C8102E',
  accentLight: '#FDECEF',

  bg: '#F4F6FA',
  surface: '#FFFFFF',
  surfaceAlt: '#FAFBFD',

  text: '#161A22',
  textSecondary: '#59616F',
  textTertiary: '#98A0AE',
  textInverse: '#FFFFFF',

  border: '#E4E8EF',
  borderStrong: '#D2D8E2',

  success: '#1F8A5B',
  successLight: '#E7F6EF',
  warning: '#B7791F',
  warningLight: '#FDF6E7',
  danger: '#C8102E',
  dangerLight: '#FDECEF',

  /** 文献类型标签色 */
  typeJournal: '#1B4B8F',
  typeThesis: '#6B4AA8',
  typeConference: '#1F7A8A',
  typeNewspaper: '#A65A1F',
  typePatent: '#1F8A5B',
  typeStandard: '#5A6272',
} as const;

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  xxl: 28,
  xxxl: 40,
} as const;

export const radius = {
  sm: 8,
  md: 12,
  lg: 16,
  xl: 22,
  pill: 999,
} as const;

export const fontSize = {
  caption: 11,
  small: 12,
  body: 14,
  bodyLg: 15,
  title: 17,
  titleLg: 20,
  display: 26,
} as const;

export const lineHeight = {
  tight: 1.35,
  normal: 1.55,
  relaxed: 1.8,
} as const;

/**
 * 阴影 —— iOS 用 shadow*，Android 用 elevation。
 * 两套都给，RN 会自动忽略不适用的一组。
 */
export const shadow = {
  card: {
    shadowColor: '#0E1B33',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 10,
    elevation: 2,
  },
  float: {
    shadowColor: '#0E1B33',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.12,
    shadowRadius: 18,
    elevation: 6,
  },
} as const;

/** 文献类型 → 展示元数据 */
export const docTypeMeta: Record<
  string,
  { label: string; color: string; bg: string }
> = {
  journal: { label: '期刊', color: colors.typeJournal, bg: '#E8EFF9' },
  thesis: { label: '学位', color: colors.typeThesis, bg: '#F0EAFB' },
  conference: { label: '会议', color: colors.typeConference, bg: '#E6F4F6' },
  newspaper: { label: '报纸', color: colors.typeNewspaper, bg: '#FAF0E6' },
  patent: { label: '专利', color: colors.typePatent, bg: '#E7F6EF' },
  standard: { label: '标准', color: colors.typeStandard, bg: '#EEF0F4' },
  other: { label: '文献', color: colors.textSecondary, bg: '#EEF0F4' },
};
