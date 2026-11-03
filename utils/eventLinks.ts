/**
 * Pure helpers for event links. No React Native imports, so the URL
 * normalisation can be unit-tested under node.
 */

export const MAX_EVENT_LINKS = 5;

export type EventLinkDraft = {
  /** Present for links already saved on the event. */
  id?: string;
  label: string;
  url: string;
};

/**
 * Accepts what a host is likely to type and returns a storable URL, or null
 * when it can't be made into one. A bare domain gets https://.
 */
export function normalizeLinkUrl(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  // Any explicit scheme is kept as-is and validated below; only input with no
  // scheme at all gets https:// (so `mailto:a@b.com` is rejected rather than
  // becoming `https://mailto:a@b.com`).
  const hasScheme = /^[a-z][a-z0-9+.-]*:/i.test(trimmed);
  const withScheme = hasScheme ? trimmed : `https://${trimmed}`;
  let parsed: URL;
  try {
    parsed = new URL(withScheme);
  } catch {
    return null;
  }
  // Only web links: a tel:/mailto:/javascript: URL has no place on an event
  // card, and the detail screen opens these with Linking.openURL.
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return null;
  if (!parsed.hostname.includes('.')) return null;
  return parsed.toString();
}
