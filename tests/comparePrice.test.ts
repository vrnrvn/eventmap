import { describe, expect, it } from 'vitest';
import {
  arePricesComparable,
  parsePriceLabel,
  priceRank,
  type ParsedPrice,
} from '@/utils/comparePrice';

describe('parsePriceLabel', () => {
  it('reads an empty or missing label as unknown', () => {
    for (const label of [null, undefined, '', '   ']) {
      const p = parsePriceLabel(label);
      expect(p.kind).toBe('unknown');
      expect(p.confident).toBe(false);
    }
  });

  it('recognises free in several languages and as zero', () => {
    for (const label of ['Free', 'free entry', 'Gratis', 'Kostenlos', 'Entrée gratuite', '$0', '0']) {
      const p = parsePriceLabel(label);
      expect(p.kind, label).toBe('free');
      expect(p.confident, label).toBe(true);
      expect(priceRank(p), label).toBe(0);
    }
  });

  it('does not find "free" inside another word', () => {
    expect(parsePriceLabel('Freestyle battle').kind).toBe('unknown');
  });

  it('reads an amount and its currency', () => {
    const p = parsePriceLabel('€12 at the door');
    expect(p).toMatchObject({ kind: 'paid', min: 12, max: null, currency: '€', confident: true });
  });

  it('reads a range as min and max, ranking on the floor', () => {
    const p = parsePriceLabel('€10–15');
    expect(p).toMatchObject({ kind: 'paid', min: 10, max: 15, currency: '€' });
    expect(priceRank(p)).toBe(10);
  });

  it('treats "From $20" as a confident floor', () => {
    const p = parsePriceLabel('From $20');
    expect(p).toMatchObject({ kind: 'paid', min: 20, currency: '$', confident: true });
  });

  it('resolves decimal commas and thousands separators', () => {
    expect(parsePriceLabel('€1,50').min).toBe(1.5);
    expect(parsePriceLabel('$1.50').min).toBe(1.5);
    expect(parsePriceLabel('HUF 1,500').min).toBe(1500);
    expect(parsePriceLabel('1.500 Ft').min).toBe(1500);
  });

  it('reads an ISO code as the currency', () => {
    expect(parsePriceLabel('USD 25').currency).toBe('USD');
    expect(parsePriceLabel('25 eur').currency).toBe('EUR');
  });

  it('keeps a bare number but without a currency', () => {
    expect(parsePriceLabel('12')).toMatchObject({ kind: 'paid', min: 12, currency: null, confident: true });
  });

  it('refuses to trust a label that mixes free with a price', () => {
    const p = parsePriceLabel('Free for members, €5 otherwise');
    expect(p.kind).toBe('paid');
    expect(p.confident).toBe(false);
    expect(priceRank(p)).toBeNull();
  });

  it('refuses to trust a qualifier that changes what the number means', () => {
    for (const label of ['Donation, suggested €5', '€10 deposit', 'Around $20', 'Price TBC']) {
      expect(parsePriceLabel(label).confident, label).toBe(false);
    }
  });
});

describe('arePricesComparable', () => {
  const parse = (labels: string[]): ParsedPrice[] => labels.map((l) => parsePriceLabel(l));

  it('needs at least two entries', () => {
    expect(arePricesComparable(parse(['€10']))).toBe(false);
  });

  it('accepts one currency across confident parses', () => {
    expect(arePricesComparable(parse(['€10', '€12', 'Free']))).toBe(true);
  });

  it('refuses mixed currencies', () => {
    expect(arePricesComparable(parse(['€10', '$12']))).toBe(false);
  });

  it('refuses a stated currency next to a bare number', () => {
    expect(arePricesComparable(parse(['€10', '12']))).toBe(false);
  });

  it('accepts bare numbers that are all bare', () => {
    expect(arePricesComparable(parse(['10', '12']))).toBe(true);
  });

  it('refuses when any parse is unconfident or unknown', () => {
    expect(arePricesComparable(parse(['€10', 'Donation']))).toBe(false);
    expect(arePricesComparable(parse(['€10', '']))).toBe(false);
  });

  it('compares free against paid in any currency', () => {
    expect(arePricesComparable(parse(['Free', '€12']))).toBe(true);
  });
});
