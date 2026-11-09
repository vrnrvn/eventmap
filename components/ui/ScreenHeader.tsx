import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View, ViewStyle, StyleProp } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { ChevronLeft } from '@/components/icons.generated';
import { Colors, Typography, Spacing } from '@/constants/theme';

export interface ScreenHeaderProps {
  title: string;
  /** Custom back handler; defaults to router.back(). */
  onBack?: () => void;
  /** Hide the back button entirely. */
  showBack?: boolean;
  /** Optional right-side accessory (actions, buttons). */
  right?: React.ReactNode;
  /** Background color behind the header; defaults to transparent. */
  backgroundColor?: string;
  /** Apply top safe-area inset padding (default true). */
  safeArea?: boolean;
  style?: StyleProp<ViewStyle>;
}

const BACK_HIT_SLOP = { top: 8, bottom: 8, left: 8, right: 8 };

export function ScreenHeader({
  title,
  onBack,
  showBack = true,
  right,
  backgroundColor = 'transparent',
  safeArea = true,
  style,
}: ScreenHeaderProps) {
  const insets = useSafeAreaInsets();

  return (
    <View
      style={[
        styles.container,
        { backgroundColor, paddingTop: safeArea ? insets.top + Spacing.sm : Spacing.sm },
        style,
      ]}
    >
      {showBack ? (
        <TouchableOpacity
          onPress={onBack ?? (() => router.back())}
          style={styles.backBtn}
          hitSlop={BACK_HIT_SLOP}
          accessibilityRole="button"
          accessibilityLabel="Go back"
          activeOpacity={0.7}
        >
          <ChevronLeft size={24} color={Colors.text.primary} />
        </TouchableOpacity>
      ) : (
        <View style={styles.backBtn} />
      )}
      <Text style={styles.title} numberOfLines={1} accessibilityRole="header">
        {title}
      </Text>
      <View style={styles.right}>{right ?? null}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: Spacing.md,
    paddingBottom: Spacing.sm,
  },
  backBtn: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: {
    flex: 1,
    textAlign: 'center',
    fontSize: Typography.sizes.lg,
    color: Colors.text.primary,
    fontFamily: Typography.displayFontFamilies.bold,
    fontWeight: Typography.weights.bold,
  },
  right: {
    minWidth: 44,
    minHeight: 44,
    alignItems: 'flex-end',
    justifyContent: 'center',
  },
});

export default ScreenHeader;
