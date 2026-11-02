import { describe, it, expect } from 'vitest';
import { formatRelativeLabel } from '@/utils/relativeTime';

// Local-naive timestamps keep the tests timezone-independent: both the fixed
// `now` and the inputs parse in the machine's local zone, so diffs are exact.
const NOW = new Date('2026-06-15T12:00:00');

const secondsAgo = (s: number) => new Date(NOW.getTime() - s * 1000);
const minutesAgo = (m: number) => secondsAgo(m * 60);
const hoursAgo = (h: number) => minutesAgo(h * 60);
const daysAgo = (d: number) => hoursAgo(d * 24);

describe('formatRelativeLabel', () => {
  describe('under a minute', () => {
    it('returns "Just now" at 0s', () => {
      expect(formatRelativeLabel(NOW, NOW)).toBe('Just now');
    });

    it('returns "Just now" at 59s', () => {
      expect(formatRelativeLabel(secondsAgo(59), NOW)).toBe('Just now');
    });
  });

  describe('minutes', () => {
    it('switches to "1m ago" at exactly 60s', () => {
      expect(formatRelativeLabel(secondsAgo(60), NOW)).toBe('1m ago');
    });

    it('returns "59m ago" at the 59-minute boundary', () => {
      expect(formatRelativeLabel(minutesAgo(59), NOW)).toBe('59m ago');
    });

    it('stays in minutes until the hour ticks over (59m59s)', () => {
      expect(formatRelativeLabel(secondsAgo(59 * 60 + 59), NOW)).toBe('59m ago');
    });
  });

  describe('hours', () => {
    it('switches to "1h ago" at exactly 60m', () => {
      expect(formatRelativeLabel(minutesAgo(60), NOW)).toBe('1h ago');
    });

    it('returns "23h ago" at the 23-hour boundary', () => {
      expect(formatRelativeLabel(hoursAgo(23), NOW)).toBe('23h ago');
    });

    it('stays in hours until a full day has elapsed (23h59m)', () => {
      expect(formatRelativeLabel(minutesAgo(23 * 60 + 59), NOW)).toBe('23h ago');
    });
  });

  describe('"Yesterday" (elapsed-time based, not calendar based)', () => {
    it('switches to "Yesterday" at exactly 24h', () => {
      expect(formatRelativeLabel(hoursAgo(24), NOW)).toBe('Yesterday');
    });

    it('still says "Yesterday" at 47h59m — the label covers 24h..48h elapsed', () => {
      // Calendar-wise 47h59m before Jun 15 12:00 is Jun 13 (two calendar days
      // back); the implementation is elapsed-time based so it says Yesterday.
      expect(formatRelativeLabel(minutesAgo(47 * 60 + 59), NOW)).toBe('Yesterday');
    });

    it('does NOT say "Yesterday" for a calendar-yesterday timestamp under 24h ago', () => {
      // 20h ago is Jun 14 (calendar yesterday) but renders as hours.
      expect(formatRelativeLabel(hoursAgo(20), NOW)).toBe('20h ago');
    });
  });

  describe('days', () => {
    it('returns "2 days ago" at exactly 48h', () => {
      expect(formatRelativeLabel(hoursAgo(48), NOW)).toBe('2 days ago');
    });

    it('returns "6 days ago" at the 6-day boundary', () => {
      expect(formatRelativeLabel(daysAgo(6), NOW)).toBe('6 days ago');
    });
  });

  describe('7+ days: short date', () => {
    it('switches to "Mon D" at exactly 7 days', () => {
      expect(formatRelativeLabel(daysAgo(7), NOW)).toBe('Jun 8');
    });

    it('formats older dates as "Mon D"', () => {
      expect(formatRelativeLabel(new Date('2026-03-03T09:00:00'), NOW)).toBe('Mar 3');
    });

    it('omits the year even across a year boundary (matches implementation)', () => {
      const janNow = new Date('2026-01-10T12:00:00');
      expect(formatRelativeLabel(new Date('2025-12-20T08:00:00'), janNow)).toBe('Dec 20');
    });
  });

  describe('future timestamps (clock skew)', () => {
    it('clamps a few minutes in the future to "Just now", never "-5m ago"', () => {
      const future = new Date(NOW.getTime() + 5 * 60 * 1000);
      expect(formatRelativeLabel(future, NOW)).toBe('Just now');
    });

    it('clamps far-future timestamps to "Just now" too', () => {
      const future = new Date(NOW.getTime() + 3 * 86400000);
      expect(formatRelativeLabel(future, NOW)).toBe('Just now');
    });
  });

  describe('input shapes', () => {
    it('accepts an ISO string', () => {
      const iso = minutesAgo(5).toISOString();
      expect(formatRelativeLabel(iso, NOW)).toBe('5m ago');
    });

    it('defaults `now` to the current time', () => {
      expect(formatRelativeLabel(new Date(Date.now() - 30 * 1000))).toBe('Just now');
    });
  });
});
