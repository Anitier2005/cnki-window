import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { CompositeNavigationProp } from '@react-navigation/native';
import type { BottomTabNavigationProp } from '@react-navigation/bottom-tabs';
import { CnkiDoc, Journal, SearchField } from '@/core/types/cnki';

export type RootStackParamList = {
  Tabs: undefined;
  SearchResult: {
    keyword: string;
    field: SearchField;
    /** 从历史进入时直接带出结果 */
    autoRun?: boolean;
    /** 进入后直接展开筛选面板（高级检索入口） */
    openFilter?: boolean;
  };
  Detail: { doc: CnkiDoc };
  /** 应用内阅读：HTML 阅读 / 原版阅读 / 知网原页 */
  Reader: {
    url: string;
    title?: string;
    /**
     * 来源页（文献详情页）。
     * 知网 bar 网关会校验 Referer，直接打开阅读地址会被判「来源应用不正确」，
     * 所以先落到详情页，再点页面上真正的入口。
     */
    via?: string;
    /** 要点的入口文案，如 HTML阅读 / 原版阅读 */
    label?: string;
  };
  /** 应用内 PDF 阅读（下载下来的全文，不再依赖系统阅读器） */
  PdfReader: {
    /** 本地文件地址，file:// 开头 */
    uri: string;
    title?: string;
  };
  JournalDetail: { journal: Journal };
  Settings: undefined;
};

export type TabParamList = {
  Home: undefined;
  Mine: undefined;
};

export type RootNav = NativeStackNavigationProp<RootStackParamList>;

/** Tab 页面里需要同时具备 stack 的跳转能力 */
export type TabNav = CompositeNavigationProp<
  BottomTabNavigationProp<TabParamList>,
  NativeStackNavigationProp<RootStackParamList>
>;
