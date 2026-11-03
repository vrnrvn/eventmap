import { Linking, Platform, Share } from 'react-native';
import * as FileSystem from 'expo-file-system/legacy';
import { buildEventIcs, getEventWebUrl, type IcsEventInput } from '@/utils/eventIcs';

// Re-exported so existing callers keep importing from one place.
export {
  buildEventIcs,
  buildRecurrenceRule,
  getEventWebUrl,
  getGoogleCalendarEventUrl,
  type IcsEventInput,
} from '@/utils/eventIcs';

/**
 * Shares an event link. `Share.share` maps to `navigator.share` on web, which
 * most desktop browsers don't implement (and which rejects on dismissal), so
 * there the link is copied to the clipboard instead.
 *
 * Resolves to what happened so callers can show the right confirmation.
 */
export async function shareEventLink(opts: {
  title: string;
  url: string;
  /** Injected by the caller (expo-clipboard) to keep this module RN-only. */
  copyToClipboard: (text: string) => Promise<void>;
}): Promise<'shared' | 'copied' | 'dismissed'> {
  const { title, url, copyToClipboard } = opts;

  if (Platform.OS === 'web') {
    const nav = typeof navigator !== 'undefined' ? navigator : undefined;
    if (nav && typeof nav.share === 'function') {
      try {
        await nav.share({ title, url });
        return 'shared';
      } catch {
        // User dismissed, or the browser refused (e.g. non-secure context):
        // fall through to the clipboard so the action still does something.
      }
    }
    await copyToClipboard(url);
    return 'copied';
  }

  const result = await Share.share(
    Platform.OS === 'ios' ? { title, url } : { title, message: `${title}\n${url}` }
  );
  return result.action === Share.dismissedAction ? 'dismissed' : 'shared';
}

/**
 * Generates the .ics for an event and hands it to the platform:
 * - web: Blob download (data stays on-page, no server round trip);
 * - iOS: file written to the cache dir, shared via the native share sheet
 *   (Share.share supports file:// URLs on iOS — expo-sharing is not in deps);
 * - Android: RN's Share can only send text, so the cached file is exposed via
 *   a content:// URI (FileProvider) and opened with ACTION_VIEW, which lets
 *   the user's calendar app import it.
 *
 * Throws on failure (callers surface a toast); a dismissed share sheet resolves.
 */
export async function shareEventIcs(input: IcsEventInput): Promise<void> {
  const ics = buildEventIcs(input);
  const fileName = `event-${input.id}.ics`;

  if (Platform.OS === 'web') {
    const blob = new Blob([ics], { type: 'text/calendar;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    try {
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = fileName;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
    } finally {
      // Give the download a tick to start before revoking.
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
    }
    return;
  }

  const fileUri = `${FileSystem.cacheDirectory}${fileName}`;
  await FileSystem.writeAsStringAsync(fileUri, ics, {
    encoding: FileSystem.EncodingType.UTF8,
  });

  if (Platform.OS === 'ios') {
    await Share.share({ title: input.title, url: fileUri });
    return;
  }

  // Android
  const contentUri = await FileSystem.getContentUriAsync(fileUri);
  await Linking.openURL(contentUri);
}
