import { describe, expect, it } from 'vitest';
import {
  droppedFromLinkMessage,
  filterLinkedEvents,
  getCompareWebUrl,
  parseCompareIds,
  shareableCompareIds,
} from '@/utils/compareLink';
import type { EventDetails } from '@/types/database';

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const C = '33333333-3333-4333-8333-333333333333';
const D = '44444444-4444-4444-8444-444444444444';
const E = '55555555-5555-4555-8555-555555555555';

const details = (id: string, visibility: 'public' | 'unlisted' = 'public') =>
  ({ event: { id, visibility } }) as unknown as EventDetails;

describe('parseCompareIds', () => {
  it('splits, trims, de-duplicates and caps at four', () => {
    expect(parseCompareIds(` ${A}, ${B} ,${A},${C},${D},${E}`)).toEqual([A, B, C, D]);
  });

  it('ignores junk and empty input', () => {
    expect(parseCompareIds(undefined)).toEqual([]);
    expect(parseCompareIds('')).toEqual([]);
    expect(parseCompareIds(`${A},<script>,not an id!`)).toEqual([A]);
  });

  it('accepts a repeated query param', () => {
    expect(parseCompareIds([A, B])).toEqual([A, B]);
  });
});

describe('getCompareWebUrl', () => {
  it('builds the web route with the ids joined', () => {
    expect(getCompareWebUrl([A, B])).toMatch(new RegExp(`/compare\\?ids=${A},${B}$`));
  });
});

describe('shareableCompareIds', () => {
  it('leaves unlisted events out of a link and says how many', () => {
    const r = shareableCompareIds([
      { id: A, visibility: 'public' },
      { id: B, visibility: 'unlisted' },
      { id: C },
    ]);
    expect(r).toEqual({ ids: [A, C], excluded: 1 });
  });
});

describe('filterLinkedEvents', () => {
  it('drops what the server did not return', () => {
    const r = filterLinkedEvents([{ id: A, details: details(A) }, { id: B, details: null }], new Set());
    expect(r.keep.map((d) => d.event.id)).toEqual([A]);
    expect(r.dropped).toBe(1);
  });

  it('drops an unlisted event the viewer could not already see, keeps one they could', () => {
    const r = filterLinkedEvents(
      [
        { id: A, details: details(A, 'unlisted') },
        { id: B, details: details(B, 'unlisted') },
      ],
      new Set([B])
    );
    expect(r.keep.map((d) => d.event.id)).toEqual([B]);
    expect(r.dropped).toBe(1);
  });
});

describe('droppedFromLinkMessage', () => {
  it('counts', () => {
    expect(droppedFromLinkMessage(1)).toBe("1 event in this link isn't available.");
    expect(droppedFromLinkMessage(2)).toBe("2 events in this link aren't available.");
  });
});
