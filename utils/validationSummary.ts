/**
 * One sentence for a screen reader when a form is refused: how many fields
 * need attention and the first message, e.g. "2 fields need attention.
 * Title is required." Pure, so it is unit-tested.
 */
export function validationSummary(errors: Record<string, string | undefined>): string {
  const messages = Object.values(errors).filter((m): m is string => !!m && m.trim().length > 0);
  if (messages.length === 0) return '';
  const head = messages.length === 1 ? '1 field needs attention.' : `${messages.length} fields need attention.`;
  const first = messages[0].trim();
  return `${head} ${/[.!?]$/.test(first) ? first : `${first}.`}`;
}
