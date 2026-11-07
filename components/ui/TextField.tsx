import React, { forwardRef, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  type TextInputProps,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { Eye, EyeOff } from '@/components/icons.generated';
import { Colors, Spacing, Typography, BorderRadius } from '@/constants/theme';

export interface TextFieldProps extends TextInputProps {
  label: string;
  /** Validation message shown under the shell; also tints the shell border. */
  error?: string;
  /** Icon rendered at the start of the pill shell (e.g. Mail, Lock). */
  leadingIcon?: React.ReactNode;
  /** Optional element rendered to the right of the label (e.g. a "Forgot?" link). */
  labelAccessory?: React.ReactNode;
  /** Style for the outer container — use for spacing between fields. */
  containerStyle?: StyleProp<ViewStyle>;
  /** Character counter rendered bottom-right below the text area (multiline-friendly). */
  counter?: { count: number; max: number };
}

/**
 * Filled pill text field used across auth and onboarding.
 * Label doubles as the input's accessibilityLabel; `secureTextEntry` gets a
 * built-in 44pt show/hide toggle.
 */
export const TextField = forwardRef<TextInput, TextFieldProps>(function TextField(
  { label, error, leadingIcon, labelAccessory, containerStyle, counter, secureTextEntry, style, ...inputProps },
  ref
) {
  const [revealed, setRevealed] = useState(false);
  const multiline = !!inputProps.multiline;

  return (
    <View style={containerStyle}>
      <View style={styles.labelRow}>
        <Text style={styles.label}>{label}</Text>
        {labelAccessory}
      </View>
      <View
        style={[
          styles.shell,
          multiline && styles.shellMultiline,
          !!error && styles.shellError,
        ]}
      >
        {leadingIcon}
        <TextInput
          ref={ref}
          accessibilityLabel={label}
          placeholderTextColor={Colors.text.tertiary}
          secureTextEntry={secureTextEntry ? !revealed : secureTextEntry}
          textAlignVertical={multiline ? 'top' : undefined}
          {...inputProps}
          style={[styles.input, multiline && styles.inputMultiline, style]}
        />
        {multiline && counter ? (
          <Text style={[styles.counter, counter.count > counter.max && styles.counterOver]}>
            {counter.count}/{counter.max}
          </Text>
        ) : null}
        {/* RN doesn't support secure multiline input, and the toggle's row
            layout breaks inside the column (multiline) shell — single-line only. */}
        {secureTextEntry && !multiline ? (
          <TouchableOpacity
            onPress={() => setRevealed((v) => !v)}
            style={styles.eyeBtn}
            accessibilityRole="button"
            accessibilityLabel={revealed ? 'Hide password' : 'Show password'}
          >
            {revealed ? (
              <EyeOff size={21} color={Colors.text.tertiary} />
            ) : (
              <Eye size={21} color={Colors.text.tertiary} />
            )}
          </TouchableOpacity>
        ) : null}
      </View>
      {error ? (
        <Text style={styles.errorText} accessibilityLiveRegion="polite">
          {error}
        </Text>
      ) : null}
    </View>
  );
});

const styles = StyleSheet.create({
  labelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: Spacing.sm,
  },
  label: {
    flexShrink: 1,
    color: Colors.text.secondary,
    fontSize: Typography.sizes.xs,
    letterSpacing: 1.8,
    textTransform: 'uppercase',
    fontFamily: Typography.labelFontFamilies.semibold,
  },
  shell: {
    height: 60,
    borderRadius: BorderRadius.round,
    backgroundColor: Colors.background.secondary,
    borderWidth: 1.5,
    borderColor: 'transparent',
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: Spacing.md,
    gap: Spacing.sm,
  },
  // Multiline: the shell grows with content; the input stacks above the
  // counter so the counter never overlaps the text (see Input.tsx's old
  // absolute-positioned counter bug).
  shellMultiline: {
    height: undefined,
    minHeight: 110,
    borderRadius: BorderRadius.xl,
    flexDirection: 'column',
    alignItems: 'stretch',
    paddingVertical: Spacing.md,
  },
  shellError: {
    borderColor: Colors.error,
  },
  input: {
    flex: 1,
    color: Colors.text.primary,
    fontSize: Typography.sizes.md,
    fontFamily: Typography.fontFamilies.medium,
  },
  inputMultiline: {
    flex: 1,
    minHeight: 60,
    paddingTop: 0,
    paddingBottom: 0,
  },
  counter: {
    alignSelf: 'flex-end',
    marginTop: Spacing.xs,
    color: Colors.text.tertiary,
    fontSize: Typography.sizes.xs,
    fontFamily: Typography.fontFamilies.medium,
  },
  counterOver: {
    color: Colors.error,
  },
  eyeBtn: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: -Spacing.sm,
  },
  errorText: {
    marginTop: Spacing.xs,
    marginLeft: Spacing.xs,
    color: Colors.error,
    fontSize: Typography.sizes.xs,
    fontFamily: Typography.fontFamilies.medium,
  },
});

export default TextField;
