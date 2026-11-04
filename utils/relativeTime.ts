/**
 * Relative-timestamp label for notification rows ("Just now", "5m ago",
 * "Yesterday", "3 days ago", "Oct 12"). Pure — no React Native imports — so
 * it stays unit-testable (see vitest.config.mts).
 *
 * Notes on the shape of the output:
 * - "Yesterday" is elapsed-time based (24h–48h ago), not calendar based.
 * - Beyond 7 days the label is a short date without a year, even across a
 *   year boundary.
 * - Future timestamps (clock skew) clamp to "Just now": the negative minute
 *   diff falls through the `< 1` check, never a negative "-3m ago".
 */
export function formatRelativeLabel(date: Date | string, now: Date = new Date()): string {
  const d = typeof date === 'string' ? new Date(date) : date;
  const diffMs = now.getTime() - d.getTime();
  const diffMin = Math.floor(diffMs / 60000);
  const diffHr = Math.floor(diffMs / 3600000);
  const diffDay = Math.floor(diffMs / 86400000);

  if (diffMin < 1) return 'Just now';
  if (diffMin < 60) return `${diffMin}m ago`;
  if (diffHr < 24) return `${diffHr}h ago`;
  if (diffDay === 1) return 'Yesterday';
  if (diffDay < 7) return `${diffDay} days ago`;
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}
