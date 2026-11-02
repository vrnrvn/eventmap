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
