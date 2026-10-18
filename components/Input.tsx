import { useState } from 'react';
import { View, Text, TextInput, StyleSheet, TextInputProps } from 'react-native';
import { Colors, Spacing, Typography } from '@/constants/theme';

type InputProps = TextInputProps & {
  label?: string;
  error?: string;
  rightAdornment?: React.ReactNode;
};

export function Input({ label, error, style, onFocus, onBlur, rightAdornment, ...props }: InputProps) {
  const [focused, setFocused] = useState(false);

  return (
    <View style={styles.container}>
      {label && <Text style={styles.label}>{label}</Text>}
      <View style={styles.inputRow}>
        <TextInput
          style={[
            styles.input,
            focused && styles.inputFocused,
            error && styles.inputError,
            !!rightAdornment && styles.inputWithAdornment,
            style,
          ]}
          placeholderTextColor={Colors.text.tertiary}
          onFocus={(e) => {
            setFocused(true);
            onFocus?.(e);
          }}
          onBlur={(e) => {
            setFocused(false);
            onBlur?.(e);
          }}
          {...props}
        />
        {rightAdornment && <View style={styles.adornment}>{rightAdornment}</View>}
      </View>
      {error && <Text style={styles.errorText}>{error}</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    marginBottom: Spacing.md,
  },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  label: {
    fontSize: Typography.sizes.sm,
    fontFamily: Typography.fontFamilies.medium,
    fontWeight: Typography.weights.medium,
    color: Colors.text.primary,
    marginBottom: Spacing.xs,
  },
  input: {
    flex: 1,
    borderBottomWidth: 2,
    borderBottomColor: Colors.border.light,
    paddingHorizontal: 0,
    paddingVertical: 12,
    paddingRight: 0,
    fontSize: Typography.sizes.md,
    color: Colors.text.primary,
    backgroundColor: 'transparent',
  },
  inputWithAdornment: {
    paddingRight: 36,
  },
  adornment: {
    position: 'absolute',
    right: 0,
    bottom: 12,
  },
  inputFocused: {
    borderBottomColor: Colors.primary,
  },
  inputError: {
    borderBottomColor: Colors.error,
  },
  errorText: {
    fontSize: Typography.sizes.xs,
    color: Colors.error,
    marginTop: Spacing.xs,
  },
});
