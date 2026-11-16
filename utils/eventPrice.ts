/**
 * The Free / Paid choice on top of the free-text price label (review C4,
 * docs/EVENT_COMPARISON_PLAN.md §3.3).
 *
 * `events.price_label` stays a string — this is not the numeric-column
 * redesign (decision D3). It only gives the most common answer, "free", one
 * tap and one canonical spelling, so the label is machine-readable where it
 * matters most and the comparison's price parser has something reliable to
 * read. Paid events keep writing whatever the host wants ("€12 at the door").
 *
 * Pure module (no React Native imports) so it is unit-tested under node.
 */

import { parsePriceLabel } from '@/utils/comparePrice';

/** What the Free chip writes. Exactly this spelling, so it round-trips. */
export const FREE_PRICE_LABEL = 'Free';

export type PriceChoice = 'free' | 'paid';

/**
 * Which chip is selected. Derived from the label, with one piece of UI
 * state: a host who tapped Paid but hasn't typed an amount yet has an empty
 * label, and the chip must stay selected so the input stays open.
 */
export function priceChoice(label: string, paidChosen: boolean): PriceChoice | null {
  const text = label.trim();
  if (!text) return paidChosen ? 'paid' : null;
  return parsePriceLabel(text).kind === 'free' ? 'free' : 'paid';
}

/**
 * The label after tapping a chip. Free writes the canonical word (replacing
 * any typed amount — the chip *is* the answer). Paid clears a free label so
 * the input opens empty, and leaves a typed amount alone.
 */
export function applyPriceChoice(label: string, choice: PriceChoice): string {
  if (choice === 'free') return FREE_PRICE_LABEL;
  return parsePriceLabel(label).kind === 'free' ? '' : label;
}

/** Whether the amount input should be visible for this state. */
export function showsPriceInput(label: string, paidChosen: boolean): boolean {
  return priceChoice(label, paidChosen) === 'paid';
}

/**
 * Splits `validateExtras` output between the Price & tickets section and the
 * rest of More options, so a refused publish scrolls to the right card.
 */
export function splitExtrasErrors<T extends { ticketUrl?: string; priceLabel?: string }>(
  errors: T
): { price: Pick<T, 'ticketUrl' | 'priceLabel'>; rest: Omit<T, 'ticketUrl' | 'priceLabel'> } {
  const { ticketUrl, priceLabel, ...rest } = errors;
  const price: Pick<T, 'ticketUrl' | 'priceLabel'> = {} as Pick<T, 'ticketUrl' | 'priceLabel'>;
  if (ticketUrl !== undefined) price.ticketUrl = ticketUrl;
  if (priceLabel !== undefined) price.priceLabel = priceLabel;
  return { price, rest: rest as Omit<T, 'ticketUrl' | 'priceLabel'> };
}
