import { useWindowDimensions } from 'react-native';

/**
 * 平板适配的统一口径。
 *
 * 手机竖屏最宽也就 430dp，所有页面按「一列、满宽」排就是对的；
 * 但同一套样式铺到 800~1200dp 的平板上，卡片会被拉成一整行，
 * 一行二三十个字，眼动距离长得离谱，反而比手机更难读。
 *
 * 所以宽屏要做的不是放大，而是「限宽 + 分栏」：
 * 列表最多三列，正文限定行宽，表单页居中留白。
 *
 * 断点按 Android 官方的窗口尺寸分类取整数：
 *   compact  < 600dp   手机竖屏、分屏小窗
 *   medium   600~999dp 小平板竖屏、手机横屏、折叠屏展开
 *   expanded >= 1000dp 10 寸平板横屏
 */
export type WindowSize = 'compact' | 'medium' | 'expanded';

export interface Responsive {
  width: number;
  height: number;
  size: WindowSize;
  /** 宽屏：至少能并排两栏 */
  wide: boolean;
  /** 超大屏：结果列表可以排三列 */
  expanded: boolean;
  /** 列表 / 表单页的最大宽度，超出后居中 */
  pageMax: number;
  /** 正文阅读的最大行宽，超过这个宽度眼睛会来回扫 */
  readMax: number;
  /** 检索结果的列数 */
  columns: number;
  /** 页面左右留白 */
  gutter: number;
  /** 是否横屏 */
  landscape: boolean;
}

export function useResponsive(): Responsive {
  const { width, height } = useWindowDimensions();

  const size: WindowSize = width >= 1000 ? 'expanded' : width >= 600 ? 'medium' : 'compact';
  const wide = size !== 'compact';
  const expanded = size === 'expanded';

  return {
    width,
    height,
    size,
    wide,
    expanded,
    /* 手机上不限制（本来也到不了上限），平板上靠这个把内容收到中间 */
    pageMax: size === 'compact' ? width : expanded ? 1120 : 760,
    readMax: size === 'compact' ? width : expanded ? 820 : 680,
    columns: expanded ? 3 : wide ? 2 : 1,
    gutter: expanded ? 28 : wide ? 20 : 16,
    landscape: width > height,
  };
}
