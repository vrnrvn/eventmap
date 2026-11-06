import { useCallback, useEffect, useRef } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { parseDraft, serializeDraft } from '@/utils/formDraft';

const SAVE_DELAY_MS = 800;

/**
 * Autosaves `value` under `key` (debounced) while `shouldSave` is true, and
 * removes the draft when it turns false. Nothing is written until `ready`:
 * the screen first reads and restores the stored draft, which a premature
 * "not dirty, remove" would otherwise delete. `key` null disables
 * everything (e.g. no signed-in user yet). Storage errors are ignored: a draft is a
 * convenience, never a reason to block the form.
 */
export function useFormDraft<T extends object>(
  key: string | null,
  value: T,
  { shouldSave, ready, base = null }: { shouldSave: boolean; ready: boolean; base?: string | null }
) {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!key || !ready) return;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      timer.current = null;
      if (shouldSave) AsyncStorage.setItem(key, serializeDraft(value, base)).catch(() => {});
      else AsyncStorage.removeItem(key).catch(() => {});
    }, SAVE_DELAY_MS);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [key, value, shouldSave, ready, base]);

  /** The stored draft for `key`, if any (call once when the form is ready). */
  const readDraft = useCallback(async (): Promise<T | null> => {
    if (!key) return null;
    const raw = await AsyncStorage.getItem(key).catch(() => null);
    return parseDraft<T>(raw, base);
  }, [key, base]);

  /** Removes the draft now (after a successful save or an explicit discard). */
  const clearDraft = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    if (key) AsyncStorage.removeItem(key).catch(() => {});
  }, [key]);

  return { readDraft, clearDraft };
}
