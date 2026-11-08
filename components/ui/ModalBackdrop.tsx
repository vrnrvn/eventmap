import type { ReactNode } from 'react';
import { Pressable, StyleSheet, type StyleProp, type ViewStyle } from 'react-native';

type Props = {
  onPress: () => void;
  /** What tapping outside does, e.g. "Close message actions". */
  label: string;
  style?: StyleProp<ViewStyle>;
  children?: ReactNode;
};

/**
 * Tap-outside-to-close layer for sheets and overlays.
 *
 * Render it as a SIBLING placed before the sheet, never as the sheet's
 * parent. On iOS an accessible Pressable becomes a single VoiceOver
 * element, so a sheet nested inside its backdrop hides every button in the
 * sheet from screen-reader users. Give the sheet `accessibilityViewIsModal`
 * (and its own Close button) so VoiceOver stays inside it.
 */
export function ModalBackdrop({ onPress, label, style, children }: Props) {
  return (
    <Pressable
      style={[StyleSheet.absoluteFill, style]}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
    >
      {children}
    </Pressable>
  );
}
