import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { FileSearch, WifiOff, ShieldAlert } from 'lucide-react-native';
import { colors, fontSize, radius, spacing } from '@/shared/theme/theme';

interface EmptyStateProps {
  kind?: 'empty' | 'offline' | 'blocked';
  title: string;
  description?: string;
  actionLabel?: string;
  onAction?: () => void;
}

const ICONS = {
  empty: FileSearch,
  offline: WifiOff,
  blocked: ShieldAlert,
};

export function EmptyState({
  kind = 'empty',
  title,
  description,
  actionLabel,
  onAction,
}: EmptyStateProps) {
  const Icon = ICONS[kind];
  return (
    <View style={styles.wrap}>
      <View style={styles.iconWrap}>
        <Icon size={30} color={colors.textTertiary} strokeWidth={1.6} />
      </View>
      <Text style={styles.title}>{title}</Text>
      {!!description && <Text style={styles.desc}>{description}</Text>}
      {!!actionLabel && !!onAction && (
        <Pressable
          onPress={onAction}
          style={({ pressed }) => [styles.btn, pressed && { opacity: 0.8 }]}
        >
          <Text style={styles.btnText}>{actionLabel}</Text>
        </Pressable>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing.xxxl,
    paddingHorizontal: spacing.xxl,
  },
  iconWrap: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.lg,
    borderWidth: 1,
    borderColor: colors.border,
  },
  title: {
    fontSize: fontSize.bodyLg,
    fontWeight: '600',
    color: colors.text,
    textAlign: 'center',
  },
  desc: {
    marginTop: spacing.sm,
    fontSize: fontSize.small,
    color: colors.textTertiary,
    textAlign: 'center',
    lineHeight: 20,
  },
  btn: {
    marginTop: spacing.xl,
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.md - 2,
    backgroundColor: colors.primary,
    borderRadius: radius.pill,
  },
  btnText: {
    color: colors.textInverse,
    fontSize: fontSize.body,
    fontWeight: '600',
  },
});
