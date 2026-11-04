import React, { ReactNode } from 'react';
import { StyleSheet, Switch, Text, TouchableOpacity, View } from 'react-native';
import { ChevronRight } from 'lucide-react-native';
import { alpha, Colors, Typography } from '@/constants/theme';

type BaseProps = {
  /** Icon rendered inside the tinted well on the left. */
  icon?: ReactNode;
  /** Well tint; defaults to the brand soft tint. */
  iconBackground?: string;
  title: string;
  description?: string;
  /** Trailing text (e.g. current value) shown before the chevron. */
  value?: string;
  disabled?: boolean;
  testID?: string;
};

type SwitchProps = BaseProps & {
  kind: 'switch';
  checked: boolean;
  onChange: (next: boolean) => void;
};

type NavProps = BaseProps & {
  kind?: 'nav';
  onPress: () => void;
  /** Hide the chevron (e.g. when `value` already tells the story). */
  hideChevron?: boolean;
  destructive?: boolean;
};

type StaticProps = BaseProps & {
  kind: 'static';
  /** Custom trailing element (count, badge). */
  trailing?: ReactNode;
};

export type SettingsRowProps = SwitchProps | NavProps | StaticProps;

/**
 * One row inside a `SettingsSection`: icon well, title + description, and a
 * trailing Switch, chevron or custom element. Replaces the inline
 * `privacyRow` + `Switch` markup copied around `screens/Settings.tsx`.
 */
export function SettingsRow(props: SettingsRowProps) {
  const { icon, iconBackground, title, description, value, disabled, testID } = props;

  const content = (
    <>
      {icon ? (
        <View style={[styles.iconWell, { backgroundColor: iconBackground ?? Colors.primarySoft }]}>
          {icon}
        </View>
      ) : null}
      <View style={styles.content}>
        <Text
          style={[
            styles.title,
            props.kind !== 'switch' && props.kind !== 'static' && props.destructive
              ? styles.titleDestructive
              : null,
            disabled ? styles.titleDisabled : null,
          ]}
          numberOfLines={2}
        >
          {title}
        </Text>
        {description ? <Text style={styles.description}>{description}</Text> : null}
      </View>
    </>
  );

  if (props.kind === 'switch') {
    return (
      <View style={styles.row} testID={testID}>
        {content}
        <Switch
          value={props.checked}
          onValueChange={props.onChange}
          disabled={disabled}
          accessibilityLabel={title}
          accessibilityHint={description}
          trackColor={{ false: Colors.border.medium, true: alpha(Colors.primary, 0.5) }}
          thumbColor={props.checked ? Colors.primary : Colors.background.secondary}
        />
      </View>
    );
  }

  if (props.kind === 'static') {
    return (
      <View style={styles.row} testID={testID}>
        {content}
        {value ? <Text style={styles.value}>{value}</Text> : null}
        {props.trailing ?? null}
      </View>
    );
  }

  return (
    <TouchableOpacity
      style={[styles.row, disabled && styles.rowDisabled]}
      onPress={props.onPress}
      disabled={disabled}
      activeOpacity={0.7}
      accessibilityRole="button"
      accessibilityLabel={title}
      accessibilityHint={description}
      accessibilityState={{ disabled: !!disabled }}
      testID={testID}
    >
      {content}
      {value ? <Text style={styles.value}>{value}</Text> : null}
      {props.hideChevron ? null : <ChevronRight size={18} color={Colors.text.disabled} />}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 14,
    gap: 14,
    minHeight: 56,
  },
  rowDisabled: {
    opacity: 0.6,
  },
  iconWell: {
    width: 36,
    height: 36,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  content: {
    flex: 1,
  },
  title: {
    fontSize: Typography.sizes.md,
    fontFamily: Typography.fontFamilies.semibold,
    color: Colors.text.primary,
    marginBottom: 2,
  },
  titleDestructive: {
    color: Colors.error,
  },
  titleDisabled: {
    color: Colors.text.disabled,
  },
  description: {
    fontSize: Typography.sizes.sm,
    fontFamily: Typography.fontFamily,
    color: Colors.text.tertiary,
    lineHeight: 18,
  },
  value: {
    fontSize: Typography.sizes.sm,
    fontFamily: Typography.fontFamilies.medium,
    color: Colors.text.secondary,
    maxWidth: 120,
  },
});
