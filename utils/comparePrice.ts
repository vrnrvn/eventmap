/**
 * Reading `events.price_label` well enough to rank it.
 *
 * Price is free text (one 60-character field, `components/EventExtrasFields`),
 * so it cannot be sorted the way a numeric column could. This module makes a
 * best effort and — this is the important part — reports how much it trusts
 * the result. The comparison screen always shows the host's own label; a
 * parse only ever decides whether a "Cheapest" mark is drawn, and the mark is
 * suppressed unless every event in the comparison parsed confidently and in
 * the same currency (`arePricesComparable`). Marking the wrong event cheapest
 * is worse than marking none.
 *
 * Replacing this with real columns (price_min / currency / is_free) is
 * decision D3 in docs/EVENT_COMPARISON_PLAN.md §3.3.
 *
 * Pure module (no React Native imports) so it is unit-tested under node.
 */

export type PriceKind = 'free' | 'paid' | 'unknown';

export type ParsedPrice = {
  kind: PriceKind;
  /** Lowest amount found. 0 for free, null when nothing numeric was read. */
  min: number | null;
  /** Highest amount when the label states a range ("€10–15"); null otherwise. */
  max: number | null;
  /** Currency as written ("€", "$", "USD"), uppercased for codes; null if absent. */
  currency: string | null;
  /**
   * Whether this parse may take part in a cheapest-of comparison. False when
   * the label mixes signals ("Free for members, €5 otherwise"), when nothing
   * numeric was found, or when the text carries a qualifier that changes what
   * the number means ("donation", "varies", "from TBC").
   */
  confident: boolean;
};

const UNKNOWN: ParsedPrice = { kind: 'unknown', min: null, max: null, currency: null, confident: false };

/**
 * Words that mean "costs nothing". English plus the handful of European
 * languages most likely to appear in a label; extend as the app's markets do.
 * Matched on word boundaries so "freestyle" and "gratismonat" never count.
 */
const FREE_WORDS =
  /(?:^|[^\p{L}])(free|gratis|gratuit|gratuite|gratuito|kostenlos|kostenfrei|libre entrada|no charge|free entry|free admission)(?:[^\p{L}]|$)/iu;

/**
 * Qualifiers that make a number unreliable as "the price": the amount is a
 * suggestion, a deposit, a per-unit rate or not settled yet.
 */
const VAGUE_WORDS =
  /(?:^|[^\p{L}])(donation|donations|pay what|suggested|tbc|tba|varies|variable|deposit|per hour|per person per|plus fees|\+ fees|approx|around|about)(?:[^\p{L}]|$)/iu;

/** Symbols and ISO codes we recognise. The symbol set covers the app's locales. */
const CURRENCY_SYMBOLS = ['€', '$', '£', '¥', '₹', '₽', '₺', '₪', '₩', 'R$', 'kr', 'zł', 'Kč', 'CHF'];
const CURRENCY_CODES =
  /(?:^|[^\p{L}])(EUR|USD|GBP|JPY|INR|RUB|TRY|ILS|KRW|BRL|SEK|NOK|DKK|PLN|CZK|CHF|CAD|AUD|NZD|MXN|ZAR)(?:[^\p{L}]|$)/iu;

/**
 * Numbers in a price label, with the decimal/thousands ambiguity resolved:
 * a comma or dot followed by exactly two digits at the end of the number is a
 * decimal separator ("1,50" = 1.5); otherwise it groups thousands
 * ("1,500" = 1500). Anything else is left to Number().
 */
function readNumbers(text: string): number[] {
  const out: number[] = [];
  const re = /\d[\d.,]*/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const raw = m[0];
    const decimal = /[.,]\d{2}$/.test(raw);
    let normalised: string;
    if (decimal) {
      const cut = raw.length - 3;
      normalised = `${raw.slice(0, cut).replace(/[.,]/g, '')}.${raw.slice(cut + 1)}`;
    } else {
      normalised = raw.replace(/[.,]/g, '');
    }
    const n = Number(normalised);
    if (Number.isFinite(n)) out.push(n);
  }
  return out;
}

function readCurrency(text: string): string | null {
  for (const symbol of CURRENCY_SYMBOLS) {
    if (text.includes(symbol)) return symbol;
  }
  const code = CURRENCY_CODES.exec(text);
  return code ? code[1].toUpperCase() : null;
}

/**
 * Classifies a host-written price label.
 *
 * Deliberate calls:
 *  - A label with both a free word and a paid amount ("Free drink, €12 entry")
 *    is `paid` but never confident: something is free and something is not,
 *    and guessing which is the admission is exactly the mistake to avoid.
 *  - "From $20" is confident. Comparing floors is what comparison UIs do, and
 *    a floor is still the number a person decides on.
 *  - A bare number with no currency ("12") parses as paid with
 *    `currency: null`. `arePricesComparable` then refuses to rank it against
 *    a label that does name a currency.
 */
export function parsePriceLabel(label: string | null | undefined): ParsedPrice {
  const text = (label ?? '').trim();
  if (!text) return UNKNOWN;

  const hasFreeWord = FREE_WORDS.test(text);
  const vague = VAGUE_WORDS.test(text);
  const currency = readCurrency(text);
  const numbers = readNumbers(text).filter((n) => Number.isFinite(n));
  const positives = numbers.filter((n) => n > 0);

  // "Free", "Free entry — no tickets needed", "0", "$0".
  if (positives.length === 0) {
    if (hasFreeWord || numbers.some((n) => n === 0)) {
      return { kind: 'free', min: 0, max: null, currency, confident: !vague };
    }
    return UNKNOWN;
  }

  const min = Math.min(...positives);
  const max = positives.length > 1 ? Math.max(...positives) : null;
  return {
    kind: 'paid',
    min,
    max,
    currency,
    // Mixed signals or a qualifier: show the label, rank nothing.
    confident: !hasFreeWord && !vague,
  };
}

/**
 * Whether a set of parsed prices may be ranked against each other. Requires
 * every parse to be confident and every *paid* entry to name the same
 * currency (all naming none is also consistent — a comparison between bare
 * numbers from one area is usually apples to apples). Free entries are exempt:
 * zero costs the same in any currency.
 */
export function arePricesComparable(prices: readonly ParsedPrice[]): boolean {
  if (prices.length < 2) return false;
  if (!prices.every((p) => p.confident && p.kind !== 'unknown')) return false;
  const currencies = new Set(prices.filter((p) => p.kind === 'paid').map((p) => p.currency ?? ''));
  return currencies.size <= 1;
}

/**
 * Comparable amount for ranking, or null when the parse cannot be ranked.
 * Callers must gate on `arePricesComparable` first; this is the per-entry key.
 */
export function priceRank(parsed: ParsedPrice): number | null {
  if (!parsed.confident) return null;
  if (parsed.kind === 'free') return 0;
  if (parsed.kind === 'paid' && parsed.min != null) return parsed.min;
  return null;
}
