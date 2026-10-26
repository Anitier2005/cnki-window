import React, { memo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import {
  Bookmark,
  GraduationCap,
  Lightbulb,
  Newspaper,
  ScrollText,
  ShieldCheck,
  FileText,
} from 'lucide-react-native';
import { colors, docTypeMeta, fontSize, radius, shadow, spacing } from '@/shared/theme/theme';
import { CnkiDoc, DocType } from '@/core/types/cnki';

const TYPE_ICON: Record<DocType, React.ComponentType<any>> = {
  journal: FileText,
  thesis: GraduationCap,
  conference: Lightbulb,
  newspaper: Newspaper,
  patent: ShieldCheck,
  standard: ScrollText,
  other: FileText,
};

/** 关键词高亮：把命中的片段染成强调色，扫读时定位更快 */
export function HighlightText({
  text,
  keyword,
  style,
  numberOfLines,
}: {
  text: string;
  keyword?: string;
  style?: any;
  numberOfLines?: number;
}) {
  if (!keyword || !keyword.trim()) {
    return (
      <Text style={style} numberOfLines={numberOfLines}>
        {text}
      </Text>
    );
  }

  // 多关键词用空格分隔，逐个高亮
  const terms = keyword
    .split(/\s+/)
    .map((t) => t.trim())
    .filter(Boolean)
    .sort((a, b) => b.length - a.length);

  if (terms.length === 0) {
    return (
      <Text style={style} numberOfLines={numberOfLines}>
        {text}
      </Text>
    );
  }

  const pattern = new RegExp(`(${terms.map(escapeRegExp).join('|')})`, 'gi');
  const parts = text.split(pattern);

  return (
    <Text style={style} numberOfLines={numberOfLines}>
      {parts.map((part, i) => {
        const hit = terms.some((t) => part.toLowerCase() === t.toLowerCase());
        return hit ? (
          <Text key={i} style={styles.mark}>
            {part}
          </Text>
        ) : (
          part
        );
      })}
    </Text>
  );
}

function escapeRegExp(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

interface DocCardProps {
  doc: CnkiDoc;
  keyword?: string;
  bookmarked?: boolean;
  /** 平板上排成多列时用：去掉左右外边距，宽度由网格决定 */
  grid?: boolean;
  onPress: () => void;
  onToggleBookmark?: () => void;
}

/**
 * 文献卡片。
 *
 * 手机端的核心问题不是"信息不够"，而是"信息太挤"。
 * 所以这里把 PC 表格的 8 列压成三层：标题 → 出处 → 指标，
 * 一屏稳定放 5~6 条，拇指滚动即可读完。
 */
export const DocCard = memo(function DocCard({
  doc,
  keyword,
  bookmarked,
  grid,
  onPress,
  onToggleBookmark,
}: DocCardProps) {
  const meta = docTypeMeta[doc.type] ?? docTypeMeta.other;
  const Icon = TYPE_ICON[doc.type] ?? FileText;

  return (
    <Pressable
      onPress={onPress}
      android_ripple={{ color: colors.primaryLight }}
      style={({ pressed }) => [styles.card, grid && styles.cardGrid, pressed && styles.cardPressed]}
    >
      <View style={styles.headerRow}>
        <View style={[styles.typeBadge, { backgroundColor: meta.bg }]}>
          <Icon size={11} color={meta.color} strokeWidth={2.4} />
          <Text style={[styles.typeText, { color: meta.color }]}>{meta.label}</Text>
        </View>

        {!!doc.date && <Text style={styles.date}>{doc.date}</Text>}

        <View style={{ flex: 1 }} />

        {onToggleBookmark && (
          <Pressable
            onPress={onToggleBookmark}
            hitSlop={12}
            style={styles.bookmarkBtn}
            android_ripple={{ color: colors.primaryLight, borderless: true }}
          >
            <Bookmark
              size={17}
              color={bookmarked ? colors.accent : colors.textTertiary}
              fill={bookmarked ? colors.accent : 'transparent'}
              strokeWidth={2}
            />
          </Pressable>
        )}
      </View>

      <HighlightText
        text={doc.title}
        keyword={keyword}
        numberOfLines={2}
        style={styles.title}
      />

      <View style={styles.metaRow}>
        {doc.authors.length > 0 && (
          <Text style={styles.authors} numberOfLines={1}>
            {doc.authors.slice(0, 3).join('、')}
            {doc.authors.length > 3 ? ' 等' : ''}
          </Text>
        )}
        {!!doc.source && (
          <Text style={[styles.source, doc.authors.length > 0 && styles.sourceAfterAuthor]} numberOfLines={1}>
            {doc.source}
          </Text>
        )}
      </View>

      {(doc.cited !== undefined || doc.downloads !== undefined) && (
        <View style={styles.metrics}>
          {doc.cited !== undefined && (
            <Text style={styles.metric}>
              被引 <Text style={styles.metricNum}>{doc.cited}</Text>
            </Text>
          )}
          {doc.downloads !== undefined && (
            <Text style={styles.metric}>
              下载 <Text style={styles.metricNum}>{doc.downloads}</Text>
            </Text>
          )}
        </View>
      )}
    </Pressable>
  );
});

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    padding: spacing.lg,
    marginHorizontal: spacing.lg,
    marginBottom: spacing.md,
    ...shadow.card,
  },
  cardPressed: { opacity: 0.72 },
  /* 多列网格里由 columnWrapperStyle 统一给间距，卡片自己不再留左右边 */
  cardGrid: { flex: 1, marginHorizontal: 0 },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginBottom: spacing.sm,
  },
  typeBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: radius.sm,
  },
  typeText: { fontSize: fontSize.caption, fontWeight: '600' },
  date: { fontSize: fontSize.caption, color: colors.textTertiary },
  bookmarkBtn: { padding: 2 },
  title: {
    fontSize: fontSize.bodyLg,
    lineHeight: 22,
    fontWeight: '600',
    color: colors.text,
    letterSpacing: 0.1,
  },
  mark: { color: colors.accent, fontWeight: '700' },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: spacing.sm,
    flexWrap: 'nowrap',
  },
  authors: {
    fontSize: fontSize.small,
    color: colors.textSecondary,
    flexShrink: 1,
  },
  source: {
    fontSize: fontSize.small,
    color: colors.primary,
    flexShrink: 2,
  },
  sourceAfterAuthor: { marginLeft: spacing.sm },
  metrics: {
    flexDirection: 'row',
    gap: spacing.lg,
    marginTop: spacing.sm,
  },
  metric: { fontSize: fontSize.caption, color: colors.textTertiary },
  metricNum: { color: colors.textSecondary, fontWeight: '600' },
});
