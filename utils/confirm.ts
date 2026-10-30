import { notifyConfirm } from './notify';

type ConfirmOptions = {
  title: string;
  message?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
};

/**
 * Cross-platform confirmation that resolves `true` when the user confirms.
 * Thin promise wrapper over `notifyConfirm` (utils/notify.ts) so there is a
 * single confirmation code path: native Alert on iOS/Android, themed overlay
 * (or `window.confirm` fallback) on web. If no confirm mechanism is
 * available, it resolves `false` — never auto-confirming the action.
 */
export function confirmAction(options: ConfirmOptions): Promise<boolean> {
  return new Promise((resolve) => {
    notifyConfirm({
      ...options,
      onConfirm: () => resolve(true),
      onCancel: () => resolve(false),
    });
  });
}
