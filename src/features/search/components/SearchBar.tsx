import React from 'react';
import {
  Pressable,
  StyleSheet,
  TextInput,
  View,
  ViewStyle,
} from 'react-native';
import { Search, X } from 'lucide-react-native';
import { colors, fontSize, radius, shadow, spacing } from '@/shared/theme/theme';

interface SearchBarProps {
  value: string;
  onChangeText: (t: string) => void;
  onSubmit: () => void;
  placeholder?: string;
  autoFocus?: boolean;
  style?: ViewStyle;
  /** 右侧附加的按钮，例如「筛选」 */
  accessory?: React.ReactNode;
}

export function SearchBar({
  value,
  onChangeText,
  onSubmit,
  placeholder = '搜索文献、作者、关键词',
  autoFocus,
  style,
  accessory,
}: SearchBarProps) {
  return (
    <View style={[styles.wrap, style]}>
      <View style={styles.box}>
        <Search size={17} color={colors.textTertiary} strokeWidth={2.2} />
        <TextInput
          value={value}
          onChangeText={onChangeText}
          onSubmitEditing={onSubmit}
          placeholder={placeholder}
          placeholderTextColor={colors.textTertiary}
          style={styles.input}
          returnKeyType="search"
          autoFocus={autoFocus}
          autoCorrect={false}
          autoCapitalize="none"
        />
        {!!value && (
          <Pressable onPress={() => onChangeText('')} hitSlop={10}>
            <X size={16} color={colors.textTertiary} strokeWidth={2.2} />
          </Pressable>
        )}
      </View>
      {accessory}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  box: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    height: 44,
    paddingHorizontal: spacing.md,
    backgroundColor: colors.surface,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.border,
    ...shadow.card,
  },
  input: {
    flex: 1,
    fontSize: fontSize.body,
    color: colors.text,
    padding: 0,
  },
});
