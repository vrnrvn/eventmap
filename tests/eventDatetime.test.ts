import { describe, it, expect } from 'vitest';
import { DEFAULT_DURATION_MS, withShiftedEnd } from '@/utils/eventDatetime';

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

/** Build the minimal form shape the helper operates on. */
const form = (start: Date, end: Date) => ({
  startDatetime: start,
  endDatetime: end,
});

const durationOf = (f: { startDatetime: Date; endDatetime: Date }) =>
  f.endDatetime.getTime() - f.startDatetime.getTime();

describe('withShiftedEnd', () => {
  it('shifts the end forward by the same delta (start +1 day, duration preserved exactly)', () => {
    const start = new Date(2026, 5, 10, 18, 0, 0); // Jun 10 2026 18:00 local
    const end = new Date(2026, 5, 10, 21, 30, 0); // 3.5h later
    const newStart = new Date(start.getTime() + DAY);

    const next = withShiftedEnd(form(start, end), newStart);

    expect(next.startDatetime).toBe(newStart);
    expect(next.endDatetime.getTime()).toBe(newStart.getTime() + 3.5 * HOUR);
    expect(durationOf(next)).toBe(durationOf(form(start, end)));
  });

  it('shifts backward in time, preserving duration', () => {
    const start = new Date(2026, 5, 10, 18, 0, 0);
    const end = new Date(2026, 5, 10, 20, 0, 0);
    const newStart = new Date(start.getTime() - 5 * DAY - 4 * HOUR);

    const next = withShiftedEnd(form(start, end), newStart);

    expect(next.startDatetime.getTime()).toBe(newStart.getTime());
    expect(durationOf(next)).toBe(2 * HOUR);
    expect(next.endDatetime.getTime()).toBeLessThan(end.getTime());
  });

  it('applies the default duration when the current duration is zero', () => {
    const start = new Date(2026, 2, 1, 12, 0, 0);
    const end = new Date(start.getTime()); // zero duration
    const newStart = new Date(start.getTime() + HOUR);

    const next = withShiftedEnd(form(start, end), newStart);

    expect(durationOf(next)).toBe(DEFAULT_DURATION_MS);
    expect(next.endDatetime.getTime()).toBe(newStart.getTime() + DEFAULT_DURATION_MS);
  });

  it('applies the default duration when the end is before the start (negative duration)', () => {
    const start = new Date(2026, 2, 1, 12, 0, 0);
    const end = new Date(start.getTime() - 3 * HOUR); // end before start
    const newStart = new Date(2026, 2, 2, 9, 0, 0);

    const next = withShiftedEnd(form(start, end), newStart);

    expect(durationOf(next)).toBe(DEFAULT_DURATION_MS);
  });

  it('preserves absolute ms duration (not wall-clock time) across a DST boundary', () => {
    // US spring-forward 2026: clocks jump 2026-03-08T10:00:00Z in
    // America/Los_Angeles. The implementation does pure epoch-ms math
    // (getTime), so it guarantees the absolute duration is preserved; the
    // end's local wall-clock time may differ in a DST-observing zone. Using
    // explicit UTC instants keeps this assertion independent of the test
    // runner's timezone.
    const start = new Date(Date.UTC(2026, 2, 6, 20, 0, 0)); // Mar 6, before transition
    const end = new Date(start.getTime() + 4 * HOUR);
    const newStart = new Date(Date.UTC(2026, 2, 8, 8, 0, 0)); // straddles 10:00Z jump

    const next = withShiftedEnd(form(start, end), newStart);

    expect(durationOf(next)).toBe(4 * HOUR);
    expect(next.endDatetime.getTime()).toBe(Date.UTC(2026, 2, 8, 12, 0, 0));
  });

  it('shifts across month and year boundaries', () => {
    const start = new Date(2026, 11, 31, 23, 0, 0); // Dec 31 2026 23:00
    const end = new Date(start.getTime() + 2 * HOUR); // ends Jan 1 2027
    const newStart = new Date(2027, 0, 31, 23, 30, 0); // Jan 31 2027 → ends Feb 1

    const next = withShiftedEnd(form(start, end), newStart);

    expect(durationOf(next)).toBe(2 * HOUR);
    expect(next.endDatetime.getFullYear()).toBe(2027);
    expect(next.endDatetime.getMonth()).toBe(1); // February
    expect(next.endDatetime.getDate()).toBe(1);
  });

  it('preserves a very long multi-day duration', () => {
    const start = new Date(2026, 6, 1, 9, 0, 0);
    const duration = 10 * DAY + 7 * HOUR; // 10-day festival
    const end = new Date(start.getTime() + duration);
    const newStart = new Date(start.getTime() + 3 * DAY);

    const next = withShiftedEnd(form(start, end), newStart);

    expect(durationOf(next)).toBe(duration);
  });

  it('is idempotent: shifting to the same start leaves the end unchanged', () => {
    const start = new Date(2026, 3, 15, 10, 0, 0);
    const end = new Date(start.getTime() + 90 * 60 * 1000);

    const next = withShiftedEnd(form(start, end), new Date(start.getTime()));

    expect(next.startDatetime.getTime()).toBe(start.getTime());
    expect(next.endDatetime.getTime()).toBe(end.getTime());

    // Applying it again changes nothing further.
    const again = withShiftedEnd(next, next.startDatetime);
    expect(again.endDatetime.getTime()).toBe(end.getTime());
  });

  it('preserves other form fields and does not mutate the input', () => {
    const start = new Date(2026, 3, 15, 10, 0, 0);
    const end = new Date(start.getTime() + HOUR);
    const input = { startDatetime: start, endDatetime: end, title: 'Picnic' };
    const newStart = new Date(start.getTime() + DAY);

    const next = withShiftedEnd(input, newStart);

    expect(next.title).toBe('Picnic');
    expect(input.startDatetime.getTime()).toBe(start.getTime());
    expect(input.endDatetime.getTime()).toBe(end.getTime());
    expect(next).not.toBe(input);
  });
});
