import React from 'react';
import { StyleSheet, Text, View, ViewStyle, StyleProp } from 'react-native';
import { CloudAlert as AlertIcon } from 'lucide-react-native';
import { Colors, Typography, BorderRadius, Spacing } from '@/constants/theme';
import { Button } from '@/components/ui/Button';

export interface ErrorStateProps {
  title?: string;
  message?: string;
  /** When provided, renders a Retry button. */
  onRetry?: () => void;
  retryLabel?: string;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

/**
 * Shared full-area error state with retry. Use instead of rendering an
 * empty state (or nothing) when a load fails, so failures are never
 * mistaken for "no data".
 */
export function ErrorState({
  title = "Couldn't load this",
  message = 'Something went wrong. Check your connection and try again.',
  onRetry,
  retryLabel = 'Try again',
  style,
  testID,
}: ErrorStateProps) {
  return (
    <View
      style={[styles.container, style]}
      accessibilityRole="alert"
      accessibilityLiveRegion="polite"
      testID={testID}
    >
      <View style={styles.iconWell}>
        <AlertIcon size={28} color={Colors.error} />
      </View>
      <Text style={styles.title} accessibilityRole="header">
        {title}
      </Text>
      <Text style={styles.message}>{message}</Text>
      {onRetry ? (
        <Button
          label={retryLabel}
          onPress={onRetry}
          variant="secondary"
          style={styles.retry}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.xl,
  },
  iconWell: {
    width: 64,
    height: 64,
    borderRadius: BorderRadius.xl,
    backgroundColor: Colors.errorSoft,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: Spacing.md,
  },
  title: {
    fontSize: Typography.sizes.lg,
    fontFamily: Typography.displayFontFamilies.bold,
    color: Colors.text.primary,
    textAlign: 'center',
    marginBottom: Spacing.xs,
  },
  message: {
    fontSize: Typography.sizes.sm,
    fontFamily: Typography.fontFamilies.regular,
    lineHeight: Typography.sizes.sm * Typography.lineHeights.normal,
    color: Colors.text.secondary,
    textAlign: 'center',
    marginBottom: Spacing.md,
    maxWidth: 320,
  },
  retry: {
    alignSelf: 'center',
  },
});

export default ErrorState;
