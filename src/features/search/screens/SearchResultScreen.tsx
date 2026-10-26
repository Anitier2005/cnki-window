import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useStatusBarStyle } from '@/shared/hooks/useStatusBarStyle';
import { ArrowLeft, ChevronDown } from 'lucide-react-native';
import { DocCard } from '@/shared/components/DocCard';
import { SearchBar } from '@/features/search/components/SearchBar';
import { EmptyState } from '@/shared/components/EmptyState';
import { FilterSheet, FilterState } from '@/features/search/components/FilterSheet';
import { useSession } from '@/core/bridge/SessionProvider';
import { useResponsive } from '@/shared/hooks/useResponsive';
import { searchDocs, CnkiError } from '@/core/api/cnki';
import { buildSearchPageUrl, DOC_SCOPES, JOURNAL_LEVELS } from '@/core/api/query';
import { bookmarks, searchHistory } from '@/core/storage/store';
import { CnkiDoc, DocType, SearchField } from '@/core/types/cnki';
import { RootStackParamList, RootNav } from '@/app/navigation/types';
import { colors, fontSize, spacing } from '@/shared/theme/theme';

type Route = RouteProp<RootStackParamList, 'SearchResult'>;

/** 结果页文案里用的类型名，和筛选面板保持一致 */
const DOC_TYPE_LABEL: Record<DocType, string> = {
  journal: '期刊',
  thesis: '学位论文',
  conference: '会议',
  newspaper: '报纸',
  patent: '专利',
  standard: '标准',
  other: '其他',
};

const SORTS: { key: FilterState['sort']; label: string }[] = [
  { key: 'relevance', label: '相关度' },
  { key: 'date', label: '发表时间' },
  { key: 'cited', label: '被引' },
  { key: 'download', label: '下载' },
];

export function SearchResultScreen() {
  const route = useRoute<Route>();
  const nav = useNavigation<RootNav>();
  const insets = useSafeAreaInsets();
  const { request, openLogin, loginVisible } = useSession();
  const r = useResponsive();
  useStatusBarStyle(false);

  const [keyword, setKeyword] = useState(route.params.keyword);
  const [query, setQuery] = useState(route.params.keyword);
  const field: SearchField = route.params.field;
  const [filter, setFilter] = useState<FilterState>({
    sort: 'relevance',
    types: [],
    levels: [],
    yearRange: undefined,
  });
  const [filterOpen, setFilterOpen] = useState(!!route.params.openFilter);

  const [docs, setDocs] = useState<CnkiDoc[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);

  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<CnkiError | null>(null);

  /** 防止旧请求覆盖新结果 */
  const reqSeq = useRef(0);
  /** 知网的翻页令牌：第 1 页给，第 2 页起必须原样带回 */
  const turnpageRef = useRef<string | undefined>(undefined);

  const fetchPage = useCallback(
    async (targetPage: number, mode: 'replace' | 'append') => {
      const seq = ++reqSeq.current;
      if (mode === 'replace') setLoading(true);
      else setLoadingMore(true);
      setError(null);

      try {
        const res = await searchDocs(request, {
          keyword: query,
          field,
          page: targetPage,
          sort: filter.sort,
          types: filter.types,
          levels: filter.levels,
          yearRange: filter.yearRange,
          turnpage: mode === 'append' ? turnpageRef.current : undefined,
        });

        if (seq !== reqSeq.current) return; // 已被更新的请求取代

        turnpageRef.current = res.turnpage;
        setDocs((prev) => (mode === 'append' ? [...prev, ...res.docs] : res.docs));
        setTotal(res.total);
        setPage(res.page);
        setTotalPages(res.totalPages);
      } catch (err: any) {
        if (seq !== reqSeq.current) return;
        setError(err instanceof CnkiError ? err : new CnkiError('UNKNOWN', err?.message || '检索失败'));
        if (mode === 'replace') setDocs([]);
      } finally {
        if (seq === reqSeq.current) {
          setLoading(false);
          setLoadingMore(false);
          setRefreshing(false);
        }
      }
    },
    [request, query, field, filter],
  );

  /* 查询或筛选变化 → 回到第一页 */
  useEffect(() => {
    if (!query.trim()) return;
    turnpageRef.current = undefined;
    setPage(1);
    fetchPage(1, 'replace');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, filter.sort, filter.types.join(','), filter.levels.join(','), filter.yearRange?.join('-')]);

  const submit = () => {
    const q = keyword.trim();
    if (!q) return;
    searchHistory.add(q);
    setQuery(q);
  };

  const loadMore = () => {
    if (loading || loadingMore || page >= totalPages || error) return;
    fetchPage(page + 1, 'append');
  };

  const refresh = () => {
    setRefreshing(true);
    fetchPage(1, 'replace');
  };

  const savedIds = useRef(new Set<string>());
  const [, force] = useState(0);
  useEffect(() => {
    bookmarks.load().then(() => {
      savedIds.current = new Set(bookmarks.get().map((b) => b.id));
      force((n) => n + 1);
    });
  }, []);

  const toggleBookmark = (doc: CnkiDoc) => {
    if (savedIds.current.has(doc.id)) {
      bookmarks.remove((b) => b.id === doc.id);
      savedIds.current.delete(doc.id);
    } else {
      bookmarks.add({ ...doc, savedAt: Date.now() });
      savedIds.current.add(doc.id);
    }
    force((n) => n + 1);
  };

  /* 能否检索只取决于风控验证是否通过，跟 IP 登录无关：
     没登录只是拿不到全文，检索结果该出的还得照出。 */
  const blocked = error?.code === 'BLOCKED';

  const filtering = filter.types.length > 0 || !!filter.yearRange || filter.levels.length > 0;
  /* 这些条件是客户端自己挑的（多类型 / 年份），服务端不知道，回显时要说明白 */
  const clientFiltered = filter.types.length > 1 || !!filter.yearRange;
  /*
   * 只勾一种类型时走的是单库检索，文案要说清「已限定在该库」。
   * 判断必须看有没有单库参数——没有参数的类型（比如专利）其实是
   * 在总库里本地筛，说「已限定在该库」就是骗人。
   */
  const scopedType =
    filter.types.length === 1 && DOC_SCOPES[filter.types[0]]
      ? DOC_TYPE_LABEL[filter.types[0]]
      : undefined;
  /* 来源类别是知网自己的检索条件，勾了就一定生效，这里只负责回显 */
  const levelText = filter.levels
    .map((code) => JOURNAL_LEVELS.find((l) => l.code === code)?.label)
    .filter(Boolean)
    .join(' / ');

  /*
   * 用户从验证面板回来就自动重试，别让他再手动点一次「重试」。
   * 面板关闭 = 他刚拖完滑块，此刻会话已经被知网标记为已验证。
   */
  const wasLoginOpen = useRef(false);
  useEffect(() => {
    if (wasLoginOpen.current && !loginVisible && blocked) {
      fetchPage(1, 'replace');
    }
    wasLoginOpen.current = loginVisible;
  }, [loginVisible, blocked, fetchPage]);

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <View style={{ width: '100%', maxWidth: r.pageMax, alignSelf: 'center' }}>
        <View style={[styles.header, { paddingHorizontal: r.gutter }]}>
          <Pressable onPress={() => nav.goBack()} hitSlop={10} style={styles.back}>
            <ArrowLeft size={21} color={colors.text} strokeWidth={2.2} />
          </Pressable>
          <SearchBar
            value={keyword}
            onChangeText={setKeyword}
            onSubmit={submit}
            placeholder="检索主题、篇名、作者…"
            style={{ flex: 1 }}
          />
        </View>

        {/* 排序与筛选 */}
        <View style={[styles.toolbar, { paddingHorizontal: r.gutter }]}>
          <View style={styles.sortRow}>
            {SORTS.map((s) => {
              const active = filter.sort === s.key;
              return (
                <Pressable
                  key={s.key}
                  onPress={() => setFilter((f) => ({ ...f, sort: s.key }))}
                  style={styles.sortItem}
                >
                  <Text style={[styles.sortText, active && styles.sortTextActive]}>
                    {s.label}
                  </Text>
                  {active && <View style={styles.sortDot} />}
                </Pressable>
              );
            })}
          </View>

          <Pressable onPress={() => setFilterOpen(true)} style={styles.filterBtn} hitSlop={8}>
            <Text style={styles.filterText}>筛选</Text>
            <ChevronDown size={13} color={colors.textSecondary} strokeWidth={2.4} />
          </Pressable>
        </View>

        {total > 0 && (
          <Text style={[styles.totalLine, { paddingHorizontal: r.gutter }]}>
            共 <Text style={styles.totalNum}>{total.toLocaleString()}</Text> 条结果
            {docs.length > 0 && ` · 已加载 ${docs.length}`}
            {scopedType ? ` · 仅${scopedType}` : clientFiltered ? ' · 已按所选条件筛选' : ''}
            {levelText ? ` · ${levelText}` : ''}
          </Text>
        )}
      </View>

      <View style={{ flex: 1, width: '100%', maxWidth: r.pageMax, alignSelf: 'center' }}>
        <FlatList
          key={`cols-${r.columns}`}
          data={docs}
          numColumns={r.columns}
          keyExtractor={(item) => item.id}
          renderItem={({ item }) => (
            <DocCard
              doc={item}
              keyword={query}
              grid={r.columns > 1}
              bookmarked={savedIds.current.has(item.id)}
              onPress={() => nav.navigate('Detail', { doc: item })}
              onToggleBookmark={() => toggleBookmark(item)}
            />
          )}
          columnWrapperStyle={
            r.columns > 1 ? { gap: spacing.md, paddingHorizontal: spacing.lg } : undefined
          }
          contentContainerStyle={{ paddingTop: spacing.sm, paddingBottom: spacing.xxxl }}
          showsVerticalScrollIndicator={false}
          onEndReached={loadMore}
          onEndReachedThreshold={0.4}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={colors.primary} />
          }
        ListEmptyComponent={
          loading ? (
            <View style={styles.center}>
              <ActivityIndicator color={colors.primary} />
              <Text style={styles.loadingText}>正在检索知网…</Text>
            </View>
          ) : error ? (
            <EmptyState
              kind={blocked ? 'blocked' : 'offline'}
              title={blocked ? '知网要求先过一次滑块验证' : '检索失败'}
              description={
                blocked
                  ? '点下面按钮，在弹出的页面里按住底部箭头，把方块拖到图片缺口处。没对上会自动弹回，多试几次；过了之后点右上角「完成」会自动重新检索。这一步和 IP 登录无关。'
                  : error.message
              }
              actionLabel={blocked ? '去拖动滑块' : '重试'}
              onAction={() =>
                blocked
                  ? openLogin(error?.challengeUrl || buildSearchPageUrl(query, field), {
                      /* 验证要等用户自己拖完，期间别自动收面板 */
                      keepOpen: true,
                    })
                  : fetchPage(1, 'replace')
              }
            />
          ) : query ? (
            <EmptyState
              title={scopedType ? `这个库里没找到` : '没有找到相关文献'}
              description={
                scopedType
                  ? `已限定在「${scopedType}」库内检索，换个关键词试试，或取消类型筛选回到总库。`
                  : levelText
                    ? `已限定来源类别为 ${levelText}，这个范围里没有匹配结果。可以少勾几个类别，或换个关键词。`
                    : filtering
                      ? '勾选了多种类型时只能在总库结果里挑，前几页没有命中。可以只勾一种类型（会直接进该库检索），或换个关键词。'
                      : '换个关键词，或调整筛选条件再试一次'
              }
            />
          ) : (
            <EmptyState
              title="输入关键词开始检索"
              description="支持主题、篇名、关键词、作者、机构等字段"
            />
          )
        }
        ListFooterComponent={
          loadingMore ? (
            <View style={styles.footer}>
              <ActivityIndicator size="small" color={colors.primary} />
            </View>
          ) : page < totalPages && docs.length > 0 ? (
            <Pressable onPress={loadMore} style={styles.footerBtn}>
              <Text style={styles.footerBtnText}>加载更多</Text>
            </Pressable>
          ) : docs.length > 0 ? (
            <Text style={styles.footerEnd}>已到最后一页</Text>
          ) : undefined
        }
        />
      </View>

      <FilterSheet
        visible={filterOpen}
        value={filter}
        onClose={() => setFilterOpen(false)}
        onApply={(v) => {
          setFilter(v);
          setFilterOpen(false);
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
    paddingBottom: spacing.md,
  },
  back: { padding: 4 },
  toolbar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.sm,
  },
  sortRow: { flexDirection: 'row', gap: spacing.lg, flex: 1 },
  sortItem: { alignItems: 'center' },
  sortText: { fontSize: fontSize.small, color: colors.textTertiary },
  sortTextActive: { color: colors.primary, fontWeight: '700' },
  sortDot: {
    width: 4,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.primary,
    marginTop: 3,
  },
  filterBtn: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  filterText: { fontSize: fontSize.small, color: colors.textSecondary },
  totalLine: {
    fontSize: fontSize.caption,
    color: colors.textTertiary,
    paddingHorizontal: spacing.lg,
    marginBottom: spacing.sm,
  },
  totalNum: { color: colors.primary, fontWeight: '700' },
  center: { alignItems: 'center', paddingVertical: spacing.xxxl, gap: spacing.md },
  loadingText: { fontSize: fontSize.small, color: colors.textTertiary },
  footer: { paddingVertical: spacing.xl, alignItems: 'center' },
  footerBtn: {
    alignSelf: 'center',
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.sm,
    marginVertical: spacing.lg,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  footerBtnText: { fontSize: fontSize.small, color: colors.primary, fontWeight: '600' },
  footerEnd: {
    textAlign: 'center',
    fontSize: fontSize.caption,
    color: colors.textTertiary,
    paddingVertical: spacing.xl,
  },
});
