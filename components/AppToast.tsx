import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Animated,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { CheckCircle, AlertCircle } from 'lucide-react-native';
import { alpha, Colors, Typography, Spacing, BorderRadius, Shadows } from '@/constants/theme';
import {
  registerNotifyHost,
  type ToastPayload,
  type ConfirmPayload,
} from '@/utils/notify';

const TOAST_DURATION_MS = 3000;

function ToastItem({ toast, onDone }: { toast: ToastPayload; onDone: (id: number) => void }) {
  const opacity = useRef(new Animated.Value(0)).current;
  // Guards against the auto-timeout and a tap both firing the exit animation.
  const dismissedRef = useRef(false);

  const dismiss = useCallback(() => {
    if (dismissedRef.current) return;
    dismissedRef.current = true;
    Animated.timing(opacity, { toValue: 0, duration: 220, useNativeDriver: true }).start(() =>
      onDone(toast.id)
    );
  }, [opacity, toast.id, onDone]);

  useEffect(() => {
    Animated.timing(opacity, { toValue: 1, duration: 180, useNativeDriver: true }).start();
    const timer = setTimeout(dismiss, TOAST_DURATION_MS);
    return () => clearTimeout(timer);
  }, [opacity, dismiss]);

  const isError = toast.kind === 'error';
  return (
    <Animated.View style={{ opacity }}>
      <Pressable
        style={styles.toast}
        onPress={dismiss}
        accessibilityRole="alert"
        accessibilityLiveRegion="polite"
        accessibilityHint="Tap to dismiss"
      >
        <View style={[styles.toastIcon, { backgroundColor: isError ? Colors.errorSoft : Colors.successSoft }]}>
          {isError ? (
            <AlertCircle size={18} color={Colors.error} />
          ) : (
            <CheckCircle size={18} color={Colors.success} />
          )}
        </View>
        <Text style={styles.toastText} numberOfLines={3}>
          {toast.message}
        </Text>
      </Pressable>
    </Animated.View>
  );
}

/**
 * Global host for cross-platform toasts and (on web) confirm dialogs.
 * Mounted once in app/_layout.tsx; triggered via utils/notify.
 */
export function AppToast() {
  const insets = useSafeAreaInsets();
  const [toasts, setToasts] = useState<ToastPayload[]>([]);
  // FIFO queue: a confirm requested while another is open must not clobber
  // it (the replaced dialog's onConfirm/onCancel would never fire, hanging
  // promise-based callers). The head of the queue is the visible dialog.
  const [confirms, setConfirms] = useState<ConfirmPayload[]>([]);
  const confirm = confirms.length > 0 ? confirms[0] : null;

  useEffect(() => {
    return registerNotifyHost(
      (toast) => setToasts((prev) => [...prev.slice(-2), toast]),
      (request) => setConfirms((prev) => [...prev, request])
    );
  }, []);

  // Stable identity: ToastItem's auto-dismiss effect depends on this (via
  // `dismiss`), so a fresh function each render would restart the 3s timer
  // whenever any other toast/confirm re-renders the host.
  const removeToast = useCallback(
    (id: number) => setToasts((prev) => prev.filter((t) => t.id !== id)),
    []
  );

  const closeConfirm = (confirmed: boolean) => {
    if (!confirm) return;
    setConfirms((prev) => prev.slice(1));
    if (confirmed) confirm.onConfirm();
    else confirm.onCancel?.();
  };

  return (
    <>
      <View
        pointerEvents="box-none"
        style={[styles.toastWrap, { top: insets.top + (Platform.OS === 'web' ? 16 : 8) }]}
      >
        {toasts.map((toast) => (
          <ToastItem key={toast.id} toast={toast} onDone={removeToast} />
        ))}
      </View>

      {confirm ? (
        <Modal transparent animationType="fade" visible onRequestClose={() => closeConfirm(false)}>
          <View style={styles.confirmBackdrop}>
            <View style={styles.confirmCard} accessibilityRole="alert" accessibilityViewIsModal>
              <Text style={styles.confirmTitle}>{confirm.title}</Text>
              {confirm.message ? (
                // Capped height so a very long message can never push the
                // action buttons off-screen on small devices.
                <ScrollView style={styles.confirmMessageScroll} bounces={false}>
                  <Text style={styles.confirmMessage}>{confirm.message}</Text>
                </ScrollView>
              ) : null}
              <View style={styles.confirmActions}>
                <TouchableOpacity
                  style={[styles.confirmBtn, styles.cancelBtn]}
                  onPress={() => closeConfirm(false)}
                  activeOpacity={0.8}
                  accessibilityRole="button"
                >
                  <Text style={styles.cancelBtnText}>{confirm.cancelLabel ?? 'Cancel'}</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[
                    styles.confirmBtn,
                    { backgroundColor: confirm.destructive ? Colors.error : Colors.primary },
                  ]}
                  onPress={() => closeConfirm(true)}
                  activeOpacity={0.85}
                  accessibilityRole="button"
                >
                  <Text style={styles.confirmBtnText}>{confirm.confirmLabel ?? 'OK'}</Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </Modal>
      ) : null}
    </>
  );
}

const styles = StyleSheet.create({
  toastWrap: {
    position: 'absolute',
    left: 0,
    right: 0,
    alignItems: 'center',
    zIndex: 9999,
    ...(Platform.OS === 'android' ? { elevation: 24 } : null),
    gap: Spacing.sm,
    paddingHorizontal: Spacing.lg,
  },
  toast: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm + 2,
    backgroundColor: Colors.surface,
    borderRadius: BorderRadius.lg,
    paddingVertical: Spacing.sm + 4,
    paddingHorizontal: Spacing.md,
    maxWidth: 440,
    borderWidth: 1,
    borderColor: Colors.border.light,
    ...Shadows.lg,
  },
  toastIcon: {
    width: 30,
    height: 30,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  toastText: {
    flexShrink: 1,
    color: Colors.text.primary,
    fontSize: Typography.sizes.sm,
    fontFamily: Typography.fontFamilies.medium,
    fontWeight: Typography.weights.medium,
    lineHeight: 20,
  },

  confirmBackdrop: {
    flex: 1,
    backgroundColor: Colors.overlay.dark,
    alignItems: 'center',
    justifyContent: 'center',
    padding: Spacing.lg,
  },
  confirmCard: {
    width: '100%',
    maxWidth: 400,
    backgroundColor: Colors.surface,
    borderRadius: BorderRadius.lg,
    padding: Spacing.lg,
  },
  confirmTitle: {
    fontSize: Typography.sizes.lg,
    fontFamily: Typography.fontFamilies.bold,
    fontWeight: Typography.weights.bold,
    color: Colors.text.primary,
    marginBottom: Spacing.sm,
  },
  confirmMessageScroll: {
    maxHeight: 260,
    marginBottom: Spacing.md,
  },
  confirmMessage: {
    fontSize: Typography.sizes.md,
    fontFamily: Typography.fontFamily,
    color: Colors.text.secondary,
    lineHeight: 22,
  },
  confirmActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: Spacing.sm,
    marginTop: Spacing.xs,
  },
  confirmBtn: {
    paddingHorizontal: Spacing.md + 4,
    paddingVertical: Spacing.sm + 4,
    borderRadius: BorderRadius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cancelBtn: {
    backgroundColor: alpha(Colors.text.primary, 0.06),
  },
  cancelBtnText: {
    color: Colors.text.primary,
    fontSize: Typography.sizes.md,
    fontFamily: Typography.fontFamilies.semibold,
    fontWeight: Typography.weights.semibold,
  },
  confirmBtnText: {
    color: Colors.text.inverse,
    fontSize: Typography.sizes.md,
    fontFamily: Typography.fontFamilies.semibold,
    fontWeight: Typography.weights.semibold,
  },
});
