import React from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
  ViewStyle,
  StyleProp,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Colors, Typography, BorderRadius, Spacing } from '@/constants/theme';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'destructive';
export type ButtonSize = 'md' | 'lg';

export interface ButtonProps {
  label: string;
  onPress: () => void;
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Shows a spinner in place of the label while preserving button width. */
  loading?: boolean;
  disabled?: boolean;
  /** Optional icon rendered to the left of the label. */
  icon?: React.ReactNode;
  fullWidth?: boolean;
  /** Render the primary variant with the brand gradient background. */
  gradient?: boolean;
  accessibilityLabel?: string;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

const HEIGHTS: Record<ButtonSize, number> = { md: 48, lg: 56 };

export function Button({
  label,
  onPress,
  variant = 'primary',
  size = 'md',
  loading = false,
  disabled = false,
  icon,
  fullWidth = false,
  gradient = false,
  accessibilityLabel,
  style,
  testID,
}: ButtonProps) {
  const isDisabled = disabled || loading;

  const containerStyle: StyleProp<ViewStyle> = [
    styles.base,
    { height: HEIGHTS[size], minHeight: 44 },
    variant === 'primary' && !gradient && styles.primary,
    variant === 'secondary' && styles.secondary,
    variant === 'ghost' && styles.ghost,
    variant === 'destructive' && styles.destructive,
    fullWidth && styles.fullWidth,
    disabled && !loading && styles.disabled,
    style,
  ];

  const labelStyle = [
    styles.label,
    size === 'lg' && styles.labelLg,
    (variant === 'primary' || variant === 'destructive') && styles.labelOnFill,
    variant === 'secondary' && styles.labelSecondary,
    variant === 'ghost' && styles.labelGhost,
  ];

  const spinnerColor =
    variant === 'primary' || variant === 'destructive' ? '#FFFFFF' : Colors.primary;

  const content = (
    <>
      <View style={[styles.content, loading && styles.contentHidden]}>
        {icon ? <View style={styles.icon}>{icon}</View> : null}
        <Text style={labelStyle} numberOfLines={1}>
          {label}
        </Text>
      </View>
      {loading ? (
        <View style={styles.spinner} pointerEvents="none">
          <ActivityIndicator color={spinnerColor} />
        </View>
      ) : null}
    </>
  );

  return (
    <Pressable
      onPress={onPress}
      disabled={isDisabled}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityState={{ disabled: isDisabled, busy: loading }}
      testID={testID}
      style={({ pressed }) => [
        ...(variant === 'primary' && gradient
          ? [styles.base, { height: HEIGHTS[size], minHeight: 44 }, styles.gradientWrap, fullWidth && styles.fullWidth, disabled && !loading && styles.disabled, style]
          : [containerStyle]),
        pressed && !isDisabled && styles.pressed,
      ]}
    >
      {variant === 'primary' && gradient ? (
        <LinearGradient
          colors={[Colors.primary, Colors.secondary]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 0 }}
          style={styles.gradientFill}
        >
          {content}
        </LinearGradient>
      ) : (
        content
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    borderRadius: BorderRadius.round,
    paddingHorizontal: Spacing.lg,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    alignSelf: 'flex-start',
  },
  fullWidth: {
    alignSelf: 'stretch',
    width: '100%',
  },
  primary: {
    backgroundColor: Colors.primary,
  },
  secondary: {
    backgroundColor: Colors.surface,
    borderWidth: 1.5,
    borderColor: Colors.primary,
  },
  ghost: {
    backgroundColor: 'transparent',
  },
  destructive: {
    backgroundColor: Colors.error,
  },
  disabled: {
    opacity: 0.5,
  },
  pressed: {
    opacity: 0.85,
  },
  gradientWrap: {
    overflow: 'hidden',
    paddingHorizontal: 0,
  },
  gradientFill: {
    flex: 1,
    width: '100%',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: Spacing.lg,
  },
  content: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.sm,
  },
  contentHidden: {
    opacity: 0,
  },
  icon: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  spinner: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
  },
  label: {
    fontSize: Typography.sizes.md,
    fontFamily: Typography.fontFamilies.bold,
    fontWeight: Typography.weights.bold,
  },
  labelLg: {
    fontSize: Typography.sizes.lg,
  },
  labelOnFill: {
    color: '#FFFFFF',
  },
  labelSecondary: {
    color: Colors.primary,
  },
  labelGhost: {
    color: Colors.primary,
  },
});

export default Button;
