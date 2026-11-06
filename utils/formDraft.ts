/**
 * Local drafts of the create / edit event forms (docs/OFFLINE_PLAN.md
 * §3.7), so a dropped connection, a failed save or a killed app doesn't
 * lose what the host typed. Pure module — unit-tested under node.
 */

export const DRAFT_VERSION = 1;
export const DRAFT_MAX_AGE_MS = 14 * 24 * 60 * 60 * 1000;

export const draftKeys = {
  createEvent: (userId: string) => `eventmap.draft.createEvent.${userId}`,
  editEvent: (userId: string, eventId: string) => `eventmap.draft.editEvent.${userId}.${eventId}`,
};

type Envelope<T> = { v: number; savedAt: number; base: string | null; data: T };

/**
 * Only images that survive a restart are kept: already-uploaded photos and
 * local files. Web `blob:` URLs die with the page and `data:` URIs can be
 * megabytes.
 */
function keepImage(img: unknown): boolean {
  if (typeof img !== 'object' || img === null) return false;
  const { uri, remoteUrl } = img as { uri?: unknown; remoteUrl?: unknown };
  if (typeof remoteUrl === 'string' && remoteUrl) return true;
  return typeof uri === 'string' && /^(file|content|ph|assets-library):/.test(uri);
}

/**
 * `base` ties an edit draft to the version of the event it was made from
 * (its updated_at), so edits to an event that changed since aren't restored
 * over it.
 */
export function serializeDraft<T extends object>(data: T, base: string | null = null, now = Date.now()): string {
  const withImages =
    'images' in data && Array.isArray((data as { images?: unknown }).images)
      ? { ...data, images: ((data as { images: unknown[] }).images).filter(keepImage) }
      : data;
  const envelope: Envelope<T> = { v: DRAFT_VERSION, savedAt: now, base, data: withImages as T };
  return JSON.stringify(envelope, function (key, value) {
    // `this[key]` is the raw value; `value` was already turned into a string.
    const raw = (this as Record<string, unknown>)[key];
    return raw instanceof Date ? { __date: raw.toISOString() } : value;
  });
}

/** The draft's data with dates revived, or null if none / expired / for another base. */
export function parseDraft<T>(raw: string | null | undefined, base: string | null = null, now = Date.now()): T | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw, (_key, value) => {
      if (value && typeof value === 'object' && typeof value.__date === 'string') {
        const d = new Date(value.__date);
        return Number.isNaN(d.getTime()) ? undefined : d;
      }
      return value;
    }) as Partial<Envelope<T>>;
    if (parsed?.v !== DRAFT_VERSION || typeof parsed.savedAt !== 'number') return null;
    if (now - parsed.savedAt > DRAFT_MAX_AGE_MS) return null;
    if ((parsed.base ?? null) !== base) return null;
    if (typeof parsed.data !== 'object' || parsed.data === null) return null;
    return parsed.data as T;
  } catch {
    return null;
  }
}
