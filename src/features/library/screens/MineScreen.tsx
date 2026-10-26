import React, { useMemo, useState } from 'react';
import {
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useStatusBarStyle } from '@/shared/hooks/useStatusBarStyle';
import { useResponsive } from '@/shared/hooks/useResponsive';
import { Settings as SettingsIcon, BookMarked, History } from 'lucide-react-native';
import { DocCard } from '@/shared/components/DocCard';
import { EmptyState } from '@/shared/components/EmptyState';
import { bookmarks, history, useCollection } from '@/core/storage/store';
import { TabNav } from '@/app/navigation/types';
import { colors, fontSize, radius, spacing } from '@/shared/theme/theme';

type Segment = 'bookmark' | 'history';

export function MineScreen() {
  const nav = useNavigation<TabNav>();
  const insets = useSafeAreaInsets();
  const r = useResponsive();
  useStatusBarStyle(false);
  const [segment, setSegment] = useState<Segment>('bookmark');

  const saved = useCollection(bookmarks);
  const viewed = useCollection(history);

  const list = segment === 'bookmark' ? saved : viewed;

  const data = useMemo(
    () =>
      [...list].sort((a: any, b: any) => {
        const ta = a.savedAt ?? a.viewedAt ?? 0;
        const tb = b.savedAt ?? b.viewedAt ?? 0;
        return tb - ta;
      }),
    [list],
  );

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <View style={{ width: '100%', maxWidth: r.pageMax, alignSelf: 'center' }}>
        <View style={styles.header}>
          <Text style={styles.title}>我的</Text>
          <Pressable onPress={() => nav.navigate('Settings')} hitSlop={10}>
            <SettingsIcon size={21} color={colors.textSecondary} strokeWidth={2} />
          </Pressable>
        </View>

        <View style={styles.statsRow}>
          <View style={styles.statBox}>
            <Text style={styles.statNum}>{saved.length}</Text>
            <Text style={styles.statLabel}>收藏</Text>
          </View>
          <View style={styles.divider} />
          <View style={styles.statBox}>
            <Text style={styles.statNum}>{viewed.length}</Text>
            <Text style={styles.statLabel}>浏览记录</Text>
          </View>
        </View>

        <View style={styles.segment}>
          <SegBtn
            active={segment === 'bookmark'}
            onPress={() => setSegment('bookmark')}
            icon={<BookMarked size={14} color={segment === 'bookmark' ? colors.primary : colors.textTertiary} strokeWidth={2.2} />}
            label="收藏"
          />
          <SegBtn
            active={segment === 'history'}
            onPress={() => setSegment('history')}
            icon={<History size={14} color={segment === 'history' ? colors.primary : colors.textTertiary} strokeWidth={2.2} />}
            label="浏览历史"
          />
        </View>
      </View>

      <View style={{ flex: 1, width: '100%', maxWidth: r.pageMax, alignSelf: 'center' }}>
        <FlatList
        key={`cols-${r.columns}`}
        data={data}
        numColumns={r.columns}
        columnWrapperStyle={
          r.columns > 1 ? { gap: spacing.md, paddingHorizontal: spacing.lg } : undefined
        }
        keyExtractor={(item: any) => `${item.id}-${item.savedAt ?? item.viewedAt}`}
        renderItem={({ item }: any) => (
          <DocCard
            doc={item}
            grid={r.columns > 1}
            onPress={() => nav.navigate('Detail', { doc: item })}
            onToggleBookmark={
              segment === 'bookmark'
                ? () => bookmarks.remove((b) => b.id === item.id)
                : () => {
                    if (bookmarks.has((b) => b.id === item.id)) {
                      bookmarks.remove((b) => b.id === item.id);
                    } else {
                      bookmarks.add({ ...item, savedAt: Date.now() });
                    }
                  }
            }
            bookmarked={
              segment === 'bookmark' ? true : bookmarks.has((b) => b.id === item.id)
            }
          />
        )}
        contentContainerStyle={{ paddingTop: spacing.md, paddingBottom: spacing.xxxl }}
        showsVerticalScrollIndicator={false}
        ListEmptyComponent={
          segment === 'bookmark' ? (
            <EmptyState
              title="还没有收藏"
              description="在检索结果或文献详情页点击书签图标即可保存"
              actionLabel="去检索"
              onAction={() => nav.navigate('Home')}
            />
          ) : (
            <EmptyState
              title="还没有浏览记录"
              description="打开过的文献会自动记录在这里，方便回看"
              actionLabel="去检索"
              onAction={() => nav.navigate('Home')}
            />
          )
        }
        />
      </View>
    </View>
  );
}

function SegBtn({
  active,
  onPress,
  icon,
  label,
}: {
  active: boolean;
  onPress: () => void;
  icon: React.ReactNode;
  label: string;
}) {
  return (
    <Pressable onPress={onPress} style={[styles.segBtn, active && styles.segBtnActive]}>
      {icon}
      <Text style={[styles.segText, active && styles.segTextActive]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: spacing.lg,
  },
  title: { fontSize: fontSize.display, fontWeight: '800', color: colors.text },
  statsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginHorizontal: spacing.lg,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    paddingVertical: spacing.lg,
  },
  statBox: { flex: 1, alignItems: 'center' },
  statNum: { fontSize: 22, fontWeight: '800', color: colors.primary },
  statLabel: { fontSize: fontSize.caption, color: colors.textTertiary, marginTop: 2 },
  divider: { width: StyleSheet.hairlineWidth, height: 28, backgroundColor: colors.border },
  segment: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginTop: spacing.xl,
    marginHorizontal: spacing.lg,
    marginBottom: spacing.sm,
  },
  segBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: spacing.lg,
    paddingVertical: 8,
    borderRadius: radius.pill,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  segBtnActive: { backgroundColor: colors.primaryLight, borderColor: colors.primary },
  segText: { fontSize: fontSize.small, color: colors.textTertiary },
  segTextActive: { color: colors.primary, fontWeight: '700' },
});
