import React, { useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  BookMarked,
  Clock3,
  History,
  Settings2,
  Sparkles,
} from 'lucide-react-native';
import { useStatusBarStyle } from '@/shared/hooks/useStatusBarStyle';
import { useResponsive } from '@/shared/hooks/useResponsive';
import { SearchBar } from '@/features/search/components/SearchBar';
import { SessionBadge } from '@/shared/components/SessionBadge';
import { searchHistory, useCollection } from '@/core/storage/store';
import { SEARCH_FIELDS , SearchField } from '@/core/types/cnki';

import { TabNav } from '@/app/navigation/types';
import { colors, fontSize, radius, shadow, spacing } from '@/shared/theme/theme';

export function HomeScreen() {
  const nav = useNavigation<TabNav>();
  const insets = useSafeAreaInsets();
  const [keyword, setKeyword] = useState('');
  const [field, setField] = useState<SearchField>('SU');
  const recent = useCollection(searchHistory);
  const r = useResponsive();
  useStatusBarStyle(true);

  const fieldLabel = useMemo(
    () => SEARCH_FIELDS.find((f) => f.key === field)?.label ?? '主题',
    [field],
  );

  const runSearch = (kw?: string, f?: SearchField) => {
    const q = (kw ?? keyword).trim();
    if (!q) return;
    searchHistory.add(q);
    nav.navigate('SearchResult', { keyword: q, field: f ?? field });
  };

  return (
    <View style={styles.root}>
      {/* 顶部：品牌区 + 检索框，蓝色底一直铺到状态栏 */}
      <View style={[styles.hero, { paddingTop: insets.top + spacing.lg }]}>
        {/*
         * 平板横屏时把品牌挪到左、检索挪到右：一屏一行就把「这是什么」
         * 和「能干什么」讲完，不用先滚一段空白再看到输入框。
         */}
        <View
          style={[
            styles.heroInner,
            { maxWidth: r.pageMax, paddingHorizontal: r.gutter },
            r.wide && styles.heroInnerWide,
          ]}
        >
          <View style={r.wide ? styles.brandCol : undefined}>
            <Text style={[styles.brand, r.wide && styles.brandWide]}>闪阅CNKI</Text>
            <Text style={[styles.slogan, r.wide && { marginBottom: 0 }]}>
              以机构身份检索学术文献
            </Text>
          </View>

          <View style={r.wide ? styles.searchCol : undefined}>
            <SearchBar
              value={keyword}
              onChangeText={setKeyword}
              onSubmit={() => runSearch()}
              placeholder={`在${fieldLabel}中检索…`}
              style={styles.searchBar}
            />

            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.fieldRow}
            >
              {SEARCH_FIELDS.map((f) => {
                const active = f.key === field;
                return (
                  <Pressable
                    key={f.key}
                    onPress={() => setField(f.key)}
                    style={[styles.fieldChip, active && styles.fieldChipActive]}
                  >
                    <Text style={[styles.fieldText, active && styles.fieldTextActive]}>
                      {f.label}
                    </Text>
                  </Pressable>
                );
              })}
            </ScrollView>
          </View>
        </View>
      </View>

      <ScrollView
        contentContainerStyle={{ paddingBottom: spacing.xxxl }}
        showsVerticalScrollIndicator={false}
      >
        <View style={{ width: '100%', maxWidth: r.pageMax, alignSelf: 'center' }}>
          <View style={{ height: spacing.lg }} />
          <SessionBadge />

        {/* 最近检索 */}
        {recent.length > 0 && (
          <View style={styles.section}>
            <View style={styles.sectionHeader}>
              <History size={15} color={colors.textSecondary} strokeWidth={2.2} />
              <Text style={styles.sectionTitle}>最近检索</Text>
              <View style={{ flex: 1 }} />
              <Pressable onPress={() => searchHistory.clear()} hitSlop={8}>
                <Text style={styles.clear}>清空</Text>
              </Pressable>
            </View>
            <View style={styles.chipWrap}>
              {recent.slice(0, 8).map((kw) => (
                <Pressable
                  key={kw}
                  onPress={() => runSearch(kw)}
                  style={({ pressed }) => [styles.recentChip, pressed && { opacity: 0.7 }]}
                >
                  <Clock3 size={12} color={colors.textTertiary} strokeWidth={2} />
                  <Text style={styles.recentText} numberOfLines={1}>
                    {kw}
                  </Text>
                </Pressable>
              ))}
            </View>
          </View>
        )}

        {/* 快捷入口 */}
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <Sparkles size={15} color={colors.textSecondary} strokeWidth={2.2} />
            <Text style={styles.sectionTitle}>快捷入口</Text>
          </View>

          <View style={styles.quickRow}>
            <QuickCard
              icon={<Settings2 size={20} color={colors.primary} strokeWidth={2} />}
              title="会话设置"
              desc="登录与诊断"
              onPress={() => nav.navigate('Settings')}
            />
            <QuickCard
              icon={<BookMarked size={20} color={colors.typeThesis} strokeWidth={2} />}
              title="我的收藏"
              desc="已保存文献"
              onPress={() => nav.navigate('Mine')}
            />
            <QuickCard
              icon={<Clock3 size={20} color={colors.typeConference} strokeWidth={2} />}
              title="浏览历史"
              desc="最近看过"
              onPress={() => nav.navigate('Mine')}
            />
          </View>
        </View>

        <View style={styles.tipBox}>
          <Text style={styles.tipTitle}>关于 IP 登录</Text>
          <Text style={styles.tipBody}>
            知网手机版没有 IP 登录入口，只有电脑版才有。本应用以桌面标识连接知网服务端获取数据，
            但界面全部原生渲染，因此在校园网下既能通过 IP 授权访问机构资源，又不会遇到电脑版页面
            在手机上无法阅读的问题。
          </Text>
        </View>
        </View>
      </ScrollView>
    </View>
  );
}

function QuickCard({
  icon,
  title,
  desc,
  onPress,
}: {
  icon: React.ReactNode;
  title: string;
  desc: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.quickCard, pressed && { opacity: 0.75 }]}
    >
      <View style={styles.quickIcon}>{icon}</View>
      <Text style={styles.quickTitle}>{title}</Text>
      <Text style={styles.quickDesc}>{desc}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  hero: {
    backgroundColor: colors.primary,
    paddingBottom: spacing.lg,
    borderBottomLeftRadius: radius.xl,
    borderBottomRightRadius: radius.xl,
  },
  /* 蓝色底铺满整宽，内容收在 pageMax 里居中 */
  heroInner: { width: '100%', alignSelf: 'center' },
  heroInnerWide: { flexDirection: 'row', alignItems: 'center', gap: spacing.xxxl },
  brandCol: { width: 268 },
  brandWide: { fontSize: 32 },
  searchCol: { flex: 1 },
  brand: {
    fontSize: fontSize.display,
    fontWeight: '800',
    color: colors.textInverse,
    letterSpacing: 0.5,
  },
  slogan: {
    fontSize: fontSize.small,
    color: 'rgba(255,255,255,0.72)',
    marginTop: 2,
    marginBottom: spacing.lg,
  },
  searchBar: { marginBottom: spacing.md },
  fieldRow: { gap: spacing.sm, paddingRight: spacing.lg },
  fieldChip: {
    paddingHorizontal: spacing.md,
    paddingVertical: 5,
    borderRadius: radius.pill,
    backgroundColor: 'rgba(255,255,255,0.14)',
  },
  fieldChipActive: { backgroundColor: colors.textInverse },
  fieldText: { fontSize: fontSize.small, color: 'rgba(255,255,255,0.85)' },
  fieldTextActive: { color: colors.primary, fontWeight: '700' },

  section: { marginTop: spacing.xl, paddingHorizontal: spacing.lg },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: spacing.md,
  },
  sectionTitle: { fontSize: fontSize.body, fontWeight: '700', color: colors.text },
  clear: { fontSize: fontSize.small, color: colors.textTertiary },

  chipWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  recentChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: spacing.md,
    paddingVertical: 7,
    backgroundColor: colors.surface,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.border,
    maxWidth: '100%',
  },
  recentText: { fontSize: fontSize.small, color: colors.textSecondary, maxWidth: 200 },

  quickRow: { flexDirection: 'row', gap: spacing.md },
  quickCard: {
    flex: 1,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    padding: spacing.md,
    ...shadow.card,
  },
  quickIcon: {
    width: 34,
    height: 34,
    borderRadius: 10,
    backgroundColor: colors.primaryLight,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.sm,
  },
  quickTitle: { fontSize: fontSize.small, fontWeight: '700', color: colors.text },
  quickDesc: { fontSize: fontSize.caption, color: colors.textTertiary, marginTop: 2 },

  tipBox: {
    marginTop: spacing.xxl,
    marginHorizontal: spacing.lg,
    padding: spacing.lg,
    backgroundColor: colors.surfaceAlt,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  tipTitle: {
    fontSize: fontSize.small,
    fontWeight: '700',
    color: colors.textSecondary,
    marginBottom: 6,
  },
  tipBody: {
    fontSize: fontSize.caption,
    lineHeight: 19,
    color: colors.textTertiary,
  },
});
