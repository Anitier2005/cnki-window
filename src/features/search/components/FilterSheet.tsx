import React, { useEffect, useState } from 'react';
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Check, X } from 'lucide-react-native';
import { colors, fontSize, radius, spacing } from '@/shared/theme/theme';
import { DocType } from '@/core/types/cnki';
import { JOURNAL_LEVELS } from '@/core/api/query';
import { useResponsive } from '@/shared/hooks/useResponsive';

export interface FilterState {
  sort: 'relevance' | 'date' | 'cited' | 'download';
  types: DocType[];
  /** 来源类别代码：P01 北大核心 / P0209 CSSCI / P0210 CSCD / P13 AMI / P0202 EI / P0201 SCI */
  levels: string[];
  yearRange?: [string, string];
}

/*
 * 这里只列跨库检索真正能找到的类型。
 * 专利没有对应的单库参数（知网把它放在独立的专利库里，跨库 brief
 * 不返回专利条目），勾上只会得到一个空列表，所以干脆不摆出来。
 */
const TYPE_OPTIONS: { key: DocType; label: string }[] = [
  { key: 'journal', label: '期刊' },
  { key: 'thesis', label: '学位论文' },
  { key: 'conference', label: '会议' },
  { key: 'newspaper', label: '报纸' },
  { key: 'standard', label: '标准' },
];

/** 来源类别与知网结果页左侧勾选框一致，代码见 api/query.ts 的 JOURNAL_LEVELS */
const LEVEL_OPTIONS: { code: string; label: string }[] = JOURNAL_LEVELS;

const YEAR_OPTIONS: { label: string; range?: () => [string, string] }[] = [
  { label: '不限' },
  { label: '近 3 年', range: () => yearBack(3) },
  { label: '近 5 年', range: () => yearBack(5) },
  { label: '近 10 年', range: () => yearBack(10) },
];

function yearBack(n: number): [string, string] {
  const now = new Date().getFullYear();
  return [String(now - n), String(now)];
}

interface Props {
  visible: boolean;
  value: FilterState;
  onClose: () => void;
  onApply: (v: FilterState) => void;
}

export function FilterSheet({ visible, value, onClose, onApply }: Props) {
  const [draft, setDraft] = useState<FilterState>(value);
  const r = useResponsive();

  useEffect(() => {
    if (visible) setDraft(value);
  }, [visible, value]);

  const toggleType = (t: DocType) => {
    setDraft((d) => ({
      ...d,
      types: d.types.includes(t) ? d.types.filter((x) => x !== t) : [...d.types, t],
    }));
  };

  const toggleLevel = (code: string) => {
    setDraft((d) => ({
      ...d,
      levels: d.levels.includes(code) ? d.levels.filter((x) => x !== code) : [...d.levels, code],
    }));
  };

  const pickYear = (range?: [string, string]) => {
    setDraft((d) => ({ ...d, yearRange: range }));
  };

  const isYearActive = (range?: [string, string]) => {
    if (!range && !draft.yearRange) return true;
    if (!range || !draft.yearRange) return false;
    return range[0] === draft.yearRange[0] && range[1] === draft.yearRange[1];
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={r.wide ? styles.modalWide : styles.modal}>
        <Pressable style={styles.backdropFill} onPress={onClose} />
        <View style={r.wide ? styles.sheetWide : styles.sheet}>
          {!r.wide && <View style={styles.handle} />}

        <View style={styles.header}>
          <Text style={styles.title}>筛选</Text>
          <Pressable onPress={onClose} hitSlop={10}>
            <X size={19} color={colors.textSecondary} strokeWidth={2.2} />
          </Pressable>
        </View>

        <ScrollView contentContainerStyle={{ paddingBottom: spacing.xl }}>
          <Text style={styles.groupTitle}>文献类型</Text>
          <View style={styles.chipWrap}>
            {TYPE_OPTIONS.map((t) => {
              const active = draft.types.includes(t.key);
              return (
                <Pressable
                  key={t.key}
                  onPress={() => toggleType(t.key)}
                  style={[styles.chip, active && styles.chipActive]}
                >
                  {active && <Check size={12} color={colors.primary} strokeWidth={3} />}
                  <Text style={[styles.chipText, active && styles.chipTextActive]}>
                    {t.label}
                  </Text>
                </Pressable>
              );
            })}
          </View>

          <Text style={styles.groupTitle}>来源类别（期刊级别）</Text>
          <View style={styles.chipWrap}>
            {LEVEL_OPTIONS.map((lv) => {
              const active = draft.levels.includes(lv.code);
              return (
                <Pressable
                  key={lv.code}
                  onPress={() => toggleLevel(lv.code)}
                  style={[styles.chip, active && styles.chipActive]}
                >
                  {active && <Check size={12} color={colors.primary} strokeWidth={3} />}
                  <Text style={[styles.chipText, active && styles.chipTextActive]}>
                    {lv.label}
                  </Text>
                </Pressable>
              );
            })}
          </View>
          <Text style={styles.hint}>
            只对期刊生效；多选表示「或」（例如同时看 CSSCI 和北大核心）。
          </Text>

          <Text style={styles.groupTitle}>发表时间</Text>
          <View style={styles.chipWrap}>
            {YEAR_OPTIONS.map((y) => {
              const range = y.range?.();
              const active = isYearActive(range);
              return (
                <Pressable
                  key={y.label}
                  onPress={() => pickYear(range)}
                  style={[styles.chip, active && styles.chipActive]}
                >
                  <Text style={[styles.chipText, active && styles.chipTextActive]}>
                    {y.label}
                  </Text>
                </Pressable>
              );
            })}
          </View>

          <Text style={styles.note}>
            只勾选一种文献类型时，会直接进入该类型的数据库检索，条数与翻页都准确。勾选多种类型则在总库结果里筛选（前几页可能命中较少）。年份筛选只在已加载的结果内生效。
          </Text>
        </ScrollView>

        <View style={styles.footer}>
          <Pressable
            onPress={() => setDraft({ sort: draft.sort, types: [], levels: [], yearRange: undefined })}
            style={styles.resetBtn}
          >
            <Text style={styles.resetText}>重置</Text>
          </Pressable>
          <Pressable onPress={() => onApply(draft)} style={styles.applyBtn}>
            <Text style={styles.applyText}>应用</Text>
          </Pressable>
        </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  /* 手机：从底部升起；平板：屏幕正中一张卡 */
  modal: { flex: 1, justifyContent: 'flex-end' },
  modalWide: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: spacing.xl },
  backdropFill: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
    bottom: 0,
    backgroundColor: 'rgba(14,27,51,0.35)',
  },
  backdrop: { flex: 1, backgroundColor: 'rgba(14,27,51,0.35)' },
  sheetWide: {
    width: 580,
    maxWidth: '94%',
    maxHeight: '88%',
    backgroundColor: colors.surface,
    borderRadius: radius.xl,
    paddingHorizontal: spacing.xl,
    paddingBottom: spacing.xl,
  },
  sheet: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.xxl,
    maxHeight: '72%',
  },
  handle: {
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.borderStrong,
    alignSelf: 'center',
    marginTop: spacing.sm,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: spacing.lg,
  },
  title: { fontSize: fontSize.title, fontWeight: '700', color: colors.text },
  groupTitle: {
    fontSize: fontSize.small,
    fontWeight: '700',
    color: colors.textSecondary,
    marginTop: spacing.md,
    marginBottom: spacing.md,
  },
  chipWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: spacing.md,
    paddingVertical: 7,
    borderRadius: radius.pill,
    backgroundColor: colors.bg,
    borderWidth: 1,
    borderColor: colors.border,
  },
  chipActive: { backgroundColor: colors.primaryLight, borderColor: colors.primary },
  chipText: { fontSize: fontSize.small, color: colors.textSecondary },
  chipTextActive: { color: colors.primary, fontWeight: '600' },
  note: {
    fontSize: fontSize.caption,
    color: colors.textTertiary,
    lineHeight: 18,
    marginTop: spacing.xl,
  },
  hint: {
    fontSize: fontSize.caption,
    color: colors.textTertiary,
    lineHeight: 17,
    marginTop: spacing.sm,
  },
  footer: { flexDirection: 'row', gap: spacing.md, marginTop: spacing.lg },
  resetBtn: {
    flex: 1,
    height: 46,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.bg,
    borderWidth: 1,
    borderColor: colors.border,
  },
  resetText: { fontSize: fontSize.body, color: colors.textSecondary, fontWeight: '600' },
  applyBtn: {
    flex: 2,
    height: 46,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.primary,
  },
  applyText: { fontSize: fontSize.body, color: colors.textInverse, fontWeight: '700' },
});
