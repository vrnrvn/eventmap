import { describe, expect, it } from 'vitest';
import { fromRpcRows, toRpcSources, type CalendarRpcRow } from '@/utils/calendarRpc';

const row = (id: string, sources: CalendarRpcRow['sources']): CalendarRpcRow =>
  ({
    id,
    title: id,
    start_datetime: '2027-03-10T18:00:00.000Z',
    end_datetime: '2027-03-10T20:00:00.000Z',
    timezone: 'Europe/Lisbon',
    sources,
  }) as unknown as CalendarRpcRow;

describe('toRpcSources', () => {
  it('asks for pending requests whenever Going is on', () => {
    expect(toRpcSources(['going'])).toEqual(['going', 'requested']);
    expect(toRpcSources(['saved', 'interested'])).toEqual(['interested', 'saved']);
  });
});

describe('fromRpcRows', () => {
  it('lists a requested RSVP under Going as pending', () => {
    const out = fromRpcRows([row('a', ['requested'])], ['going']);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ source: 'going', pending: true });
  });

  it('emits one entry per wanted source and drops the rest', () => {
    const out = fromRpcRows([row('a', ['going', 'saved', 'hosting'])], ['going', 'saved']);
    expect(out.map((r) => [r.source, !!r.pending])).toEqual([
      ['going', false],
      ['saved', false],
    ]);
  });

  it('hides pending requests when Going is off', () => {
    expect(fromRpcRows([row('a', ['requested'])], ['saved'])).toEqual([]);
  });

  it('keeps the event zone for client-side expansion', () => {
    expect(fromRpcRows([row('a', ['going'])], ['going'])[0].event.timezone).toBe('Europe/Lisbon');
  });
});
