export type RecurrenceFrequency = 'daily' | 'weekly' | 'monthly';

export type RecurrencePattern = {
  frequency: RecurrenceFrequency;
  interval: number;
  endDate?: string;
};

export type RecurrenceOption = RecurrencePattern | null;

export const RECURRENCE_OPTIONS: { value: RecurrenceOption; label: string }[] = [
  { value: null, label: 'None' },
  { value: { frequency: 'daily', interval: 1 }, label: 'Every Day' },
  { value: { frequency: 'weekly', interval: 1 }, label: 'Every Week' },
  { value: { frequency: 'monthly', interval: 1 }, label: 'Every Month' },
];

export function getRecurrenceLabel(pattern: RecurrencePattern | null | undefined): string {
  if (!pattern) return '';
  const opt = RECURRENCE_OPTIONS.find(
    (o) =>
      o.value &&
      o.value.frequency === pattern.frequency &&
      o.value.interval === pattern.interval
  );
  return opt?.label ?? `${pattern.interval} ${pattern.frequency}`;
}

function toDateOnly(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function parseDateOnly(s: string): Date {
  const d = new Date(s);
  d.setHours(0, 0, 0, 0);
  return d;
}

function sameDayOfWeek(d1: Date, d2: Date): boolean {
  return d1.getDay() === d2.getDay();
}

function sameDayOfMonth(d1: Date, d2: Date): boolean {
  return d1.getDate() === d2.getDate();
}

export function isEventOnDate(
  event: {
    start_datetime: string;
    is_recurring?: boolean;
    recurrence_pattern?: RecurrencePattern | null;
  },
  date: Date
): boolean {
  const start = new Date(event.start_datetime);
  const checkDate = new Date(date);
  checkDate.setHours(0, 0, 0, 0);
  const checkStart = new Date(start);
  checkStart.setHours(0, 0, 0, 0);

  if (!event.is_recurring || !event.recurrence_pattern) {
    return toDateOnly(checkStart) === toDateOnly(checkDate);
  }

  const pattern = event.recurrence_pattern;
  const endDate = pattern.endDate ? parseDateOnly(pattern.endDate) : null;

  if (checkDate < checkStart) return false;
  if (endDate && checkDate > endDate) return false;

  const startDay = checkStart.getTime();
  const checkDay = checkDate.getTime();
  const diffDays = Math.floor((checkDay - startDay) / (24 * 60 * 60 * 1000));

  switch (pattern.frequency) {
    case 'daily':
      return diffDays % pattern.interval === 0;
    case 'weekly':
      return sameDayOfWeek(start, checkDate) && Math.floor(diffDays / 7) % pattern.interval === 0;
    case 'monthly':
      return sameDayOfMonth(start, checkDate);
    default:
      return false;
  }
}

/** Get the next N occurrence dates for a recurring event, starting from today */
export function getNextOccurrences(
  event: {
    start_datetime: string;
    is_recurring?: boolean;
    recurrence_pattern?: RecurrencePattern | null;
  },
  maxCount: number = 5
): Date[] {
  if (!event.is_recurring || !event.recurrence_pattern) return [];

  const start = new Date(event.start_datetime);
  const pattern = event.recurrence_pattern;
  const endDate = pattern.endDate ? parseDateOnly(pattern.endDate) : null;

  const results: Date[] = [];
  const from = new Date();
  from.setHours(0, 0, 0, 0);

  for (let d = new Date(from); results.length < maxCount; d.setDate(d.getDate() + 1)) {
    if (d < parseDateOnly(toDateOnly(start))) continue;
    if (endDate && d > endDate) break;

    if (isEventOnDate(event, d)) {
      const occurrence = new Date(start);
      occurrence.setFullYear(d.getFullYear(), d.getMonth(), d.getDate());
      results.push(occurrence);
    }
  }
  return results;
}

export function filterEventsByDateRange<T extends { start_datetime: string; is_recurring?: boolean; recurrence_pattern?: RecurrencePattern | null }>(
  events: T[],
  startDate: Date,
  endDate: Date
): T[] {
  const result: T[] = [];
  const start = new Date(startDate);
  start.setHours(0, 0, 0, 0);
  const end = new Date(endDate);
  end.setHours(23, 59, 59, 999);

  for (const event of events) {
    for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
      if (isEventOnDate(event, d)) {
        result.push(event);
        break;
      }
    }
  }
  return result;
}
