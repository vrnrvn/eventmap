/**
 * Which required fields of the Create form are still missing, for the sticky
 * action bar's progress line (review C2). Before this, a host found out what
 * was missing only when Publish was refused; the validation itself was always
 * cheap enough to run live, it just had nowhere to show.
 *
 * Keys match the `validate()` keys in `app/(tabs)/create.tsx`, so the screen
 * can reuse its `FIELD_SECTION` map to scroll to the first missing one.
 *
 * Pure module (no React Native imports) so it is unit-tested under node.
 */

export type RequiredFieldKey =
  | 'title'
  | 'description'
  | 'categoryId'
  | 'startDatetime'
  | 'endDatetime'
  | 'location';

export type RequiredFieldInput = {
  title: string;
  description: string;
  categoryId: string;
  /** Start instant is after now (in the event's zone). */
  startInFuture: boolean;
  endAfterStart: boolean;
  /** `eventNeedsExplicitPlace(...)`: a place is required and none is set. */
  placeMissing: boolean;
};

export type RequiredField = { key: RequiredFieldKey; label: string };

export type RequiredFieldStatus = {
  /** In form order, so "first missing" is also "highest on the page". */
  missing: RequiredField[];
  total: number;
  done: number;
  ready: boolean;
};

const LABELS: Record<RequiredFieldKey, string> = {
  title: 'Title',
  description: 'Description',
  categoryId: 'Category',
  startDatetime: 'Start time',
  endDatetime: 'End time',
  location: 'Place',
};

export function requiredFieldStatus(input: RequiredFieldInput): RequiredFieldStatus {
  const checks: [RequiredFieldKey, boolean][] = [
    ['title', !!input.title.trim()],
    ['description', !!input.description.trim()],
    ['categoryId', !!input.categoryId],
    ['startDatetime', input.startInFuture],
    ['endDatetime', input.endAfterStart],
    // Only counted when the host actually has to set one; a venue with a
    // fixed address publishes there by default and should not see "Place".
    ['location', !input.placeMissing],
  ];
  const missing = checks.filter(([, ok]) => !ok).map(([key]) => ({ key, label: LABELS[key] }));
  return {
    missing,
    total: checks.length,
    done: checks.length - missing.length,
    ready: missing.length === 0,
  };
}

/**
 * One short line for the bar. Names the fields when there are few, counts
 * the rest when there are many — a list of six is no longer a hint.
 */
export function progressLine(status: RequiredFieldStatus): string {
  if (status.ready) return 'Ready to publish';
  const labels = status.missing.map((f) => f.label);
  if (labels.length <= 3) return `Still needed: ${labels.join(', ')}`;
  return `Still needed: ${labels.slice(0, 2).join(', ')} and ${labels.length - 2} more`;
}
