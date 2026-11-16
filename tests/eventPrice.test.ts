import { describe, expect, it } from 'vitest';
import {
  FREE_PRICE_LABEL,
  applyPriceChoice,
  priceChoice,
  showsPriceInput,
  splitExtrasErrors,
} from '@/utils/eventPrice';
import { parsePriceLabel } from '@/utils/comparePrice';

describe('priceChoice', () => {
  it('is nothing for a blank label until Paid is tapped', () => {
    expect(priceChoice('', false)).toBeNull();
    expect(priceChoice('   ', false)).toBeNull();
    expect(priceChoice('', true)).toBe('paid');
  });

  it('reads the chip from the label, canonical or not', () => {
    expect(priceChoice(FREE_PRICE_LABEL, false)).toBe('free');
    expect(priceChoice('free entry, donations welcome', false)).toBe('free');
    expect(priceChoice('€12 at the door', false)).toBe('paid');
    // A typed label wins over stale UI state.
    expect(priceChoice(FREE_PRICE_LABEL, true)).toBe('free');
  });
});

describe('applyPriceChoice', () => {
  it('Free writes the canonical word and the parser reads it back as free', () => {
    const label = applyPriceChoice('€12', 'free');
    expect(label).toBe('Free');
    expect(parsePriceLabel(label)).toMatchObject({ kind: 'free', confident: true });
  });

  it('Paid clears a free label and keeps a typed amount', () => {
    expect(applyPriceChoice('Free', 'paid')).toBe('');
    expect(applyPriceChoice('Gratis', 'paid')).toBe('');
    expect(applyPriceChoice('€12', 'paid')).toBe('€12');
    expect(applyPriceChoice('', 'paid')).toBe('');
  });
});

describe('showsPriceInput', () => {
  it('opens only for paid', () => {
    expect(showsPriceInput('', false)).toBe(false);
    expect(showsPriceInput('', true)).toBe(true);
    expect(showsPriceInput('Free', true)).toBe(false);
    expect(showsPriceInput('From $20', false)).toBe(true);
  });
});

describe('splitExtrasErrors', () => {
  it('routes ticket and price errors to the price card and the rest onward', () => {
    const { price, rest } = splitExtrasErrors({
      ticketUrl: 'bad link',
      accessibilityNotes: 'too long',
    });
    expect(price).toEqual({ ticketUrl: 'bad link' });
    expect(rest).toEqual({ accessibilityNotes: 'too long' });
  });

  it('is empty on both sides when nothing failed', () => {
    const { price, rest } = splitExtrasErrors({});
    expect(price).toEqual({});
    expect(rest).toEqual({});
  });
});
