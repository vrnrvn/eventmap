import React, { Children, Fragment, ReactNode } from 'react';
import { StyleSheet, Text, View, ViewStyle, StyleProp } from 'react-native';
import { Colors, Shadows, Spacing, Typography } from '@/constants/theme';

type Props = {
  /** Uppercase label shown above the card; omit for an unlabelled card. */
  title?: string;
  /** Optional right-aligned accessory next to the title (badge, link). */
  titleAccessory?: ReactNode;
  /** Helper copy under the card. */
  footer?: string;
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
  /** Draw hairline separators between direct children (default true). */
  separators?: boolean;
};

/**
 * Labelled white card used for grouped settings rows. Mirrors the
 * `sectionLabel` + `card` + `fieldSeparator` pattern in `screens/Settings.tsx`
 * so host tooling screens look like the rest of the app.
 */
export function SettingsSection({
  title,
  titleAccessory,
  footer,
  children,
  style,
  separators = true,
}: Props) {
  const items = Children.toArray(children).filter(Boolean);
  return (
    <View style={[styles.wrap, style]}>
      {title ? (
        <View style={styles.labelRow}>
          <Text style={styles.label}>{title}</Text>
          {titleAccessory}
        </View>
      ) : null}
      <View style={styles.card}>
        {items.map((child, index) => (
          <Fragment key={index}>
            {separators && index > 0 ? <View style={styles.separator} /> : null}
            {child}
          </Fragment>
        ))}
      </View>
      {footer ? <Text style={styles.footer}>{footer}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    marginBottom: Spacing.lg,
  },
  labelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 10,
    marginLeft: 4,
  },
  label: {
    fontSize: Typography.sizes.sm,
    fontFamily: Typography.fontFamilies.semibold,
    color: Colors.text.tertiary,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
  },
  card: {
    backgroundColor: Colors.surface,
    borderRadius: 20,
    overflow: 'hidden',
    ...Shadows.card,
  },
  separator: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: Colors.border.light,
    marginLeft: 66,
  },
  footer: {
    marginTop: Spacing.sm,
    marginHorizontal: 4,
    fontSize: Typography.sizes.xs,
    fontFamily: Typography.fontFamily,
    color: Colors.text.tertiary,
    lineHeight: 16,
  },
});
