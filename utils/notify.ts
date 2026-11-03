import { Alert, Platform } from 'react-native';

export type ToastKind = 'success' | 'error';

export type ToastAction = {
  label: string;
  onPress: () => void;
};

export type ToastPayload = {
  id: number;
  kind: ToastKind;
  message: string;
  /** Optional inline action (e.g. Undo). Extends the toast's lifetime. */
  action?: ToastAction;
};

export type ConfirmPayload = {
  title: string;
  message?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
  onConfirm: () => void;
  onCancel?: () => void;
};

type ToastListener = (toast: ToastPayload) => void;
type ConfirmListener = (request: ConfirmPayload) => void;

let toastListener: ToastListener | null = null;
let confirmListener: ConfirmListener | null = null;
let nextId = 1;
const pendingToasts: ToastPayload[] = [];

/** Called once by the AppToast host when it mounts. */
export function registerNotifyHost(onToast: ToastListener, onConfirm: ConfirmListener) {
  toastListener = onToast;
  confirmListener = onConfirm;
  // Flush anything that fired before the host mounted.
  while (pendingToasts.length > 0) {
    const toast = pendingToasts.shift();
    if (toast) toastListener(toast);
  }
  return () => {
    if (toastListener === onToast) toastListener = null;
    if (confirmListener === onConfirm) confirmListener = null;
  };
}

function emitToast(kind: ToastKind, message: string, action?: ToastAction) {
  const toast: ToastPayload = { id: nextId++, kind, message, action };
  if (toastListener) toastListener(toast);
  else pendingToasts.push(toast);
}

export const notify = {
  success(message: string) {
    emitToast('success', message);
  },
  error(message: string) {
    emitToast('error', message);
  },
  /**
   * Success toast with an inline action. Preferred over a confirm dialog for
   * reversible actions: the user isn't interrupted, and a mistake costs one
   * tap instead of two.
   */
  withAction(message: string, action: ToastAction) {
    emitToast('success', message, action);
  },
  /** Shorthand for the common "X removed · Undo" pattern. */
  undo(message: string, onUndo: () => void) {
    emitToast('success', message, { label: 'Undo', onPress: onUndo });
  },
};

/**
 * Cross-platform blocking confirmation. Uses the native Alert dialog on
 * iOS/Android (where it works) and a themed overlay rendered by the AppToast
 * host on web (where Alert.alert is a no-op).
 */
export function notifyConfirm({
  title,
  message,
  confirmLabel = 'OK',
  cancelLabel = 'Cancel',
  destructive = false,
  onConfirm,
  onCancel,
}: ConfirmPayload) {
  if (Platform.OS !== 'web') {
    Alert.alert(
      title,
      message,
      [
        { text: cancelLabel, style: 'cancel', onPress: () => onCancel?.() },
        {
          text: confirmLabel,
          style: destructive ? 'destructive' : 'default',
          onPress: onConfirm,
        },
      ],
      { cancelable: true, onDismiss: () => onCancel?.() }
    );
    return;
  }
  if (confirmListener) {
    confirmListener({ title, message, confirmLabel, cancelLabel, destructive, onConfirm, onCancel });
  } else {
    // Host not mounted yet — last-resort fallback so the action isn't lost.
    const confirmFn = (globalThis as { confirm?: (msg: string) => boolean }).confirm;
    const text = message ? `${title}\n\n${message}` : title;
    if (typeof confirmFn === 'function' && confirmFn(text)) onConfirm();
    else onCancel?.();
  }
}
