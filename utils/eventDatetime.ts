/**
 * Pure date helpers shared by the event create/edit forms.
 * No React Native imports — this module is unit-tested under node.
 */

/** Default event duration, matching the form's initial start/end gap. */
export const DEFAULT_DURATION_MS = 2 * 60 * 60 * 1000;

/**
 * Apply a new start while preserving the existing duration: the end shifts by
 * the same delta. Falls back to +2h if the current duration is not positive.
 *
 * Duration is preserved in absolute milliseconds (epoch math), not wall-clock
 * time — across a DST transition the end's local clock time may differ.
 */
export const withShiftedEnd = <T extends { startDatetime: Date; endDatetime: Date }>(
  f: T,
  newStart: Date
): T => {
  const duration = f.endDatetime.getTime() - f.startDatetime.getTime();
  const safeDuration = duration > 0 ? duration : DEFAULT_DURATION_MS;
  return {
    ...f,
    startDatetime: newStart,
    endDatetime: new Date(newStart.getTime() + safeDuration),
  };
};

const pad2 = (n: number) => String(n).padStart(2, '0');

/**
 * Format a Date as the local-time string an `<input type="datetime-local">`
 * expects (`YYYY-MM-DDTHH:mm`). Seconds are dropped.
 */
export const toDateTimeLocalValue = (d: Date): string =>
  `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}T${pad2(d.getHours())}:${pad2(d.getMinutes())}`;

/**
 * Parse an `<input type="datetime-local">` value back into a local Date.
 * Returns null for empty or malformed input (e.g. the user cleared the field).
 */
export const fromDateTimeLocalValue = (value: string): Date | null => {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(value);
  if (!m) return null;
  const [, y, mo, d, h, mi, s] = m;
  const date = new Date(
    Number(y),
    Number(mo) - 1,
    Number(d),
    Number(h),
    Number(mi),
    s ? Number(s) : 0,
    0
  );
  return Number.isNaN(date.getTime()) ? null : date;
};
