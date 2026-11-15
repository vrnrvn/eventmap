export function SearchForm({
  action,
  placeholder,
  defaultValue,
}: {
  action: string;
  placeholder: string;
  defaultValue?: string;
}) {
  return (
    <form action={action} method="GET" className="mb-4 flex max-w-md gap-2">
      <input
        type="search"
        name="q"
        placeholder={placeholder}
        defaultValue={defaultValue}
        className="w-full rounded-md border border-zinc-300 px-3 py-2 text-sm"
      />
      <button
        type="submit"
        className="rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-700 hover:bg-zinc-50"
      >
        Search
      </button>
    </form>
  );
}

/**
 * One ilike pattern for a PostgREST `.or()` list. Commas, parentheses and
 * quotes are syntax there, so they become single-character wildcards
 * (same trade-off as `*` in escapeLike).
 */
export function orIlike(columns: string[], value: string): string {
  const pattern = `%${escapeLike(value).replace(/[,()"]/g, '_')}%`;
  return columns.map((c) => `${c}.ilike.${pattern}`).join(',');
}

export function escapeLike(value: string): string {
  // PostgREST also treats `*` as a `%` wildcard in like/ilike filters and has
  // no escape for it; turn it into a single-character wildcard so a typed
  // `*` matches a literal `*` (and, rarely, any one character) instead of
  // matching everything.
  return value.replace(/[%_\\]/g, '\\$&').replace(/\*/g, '_');
}

/**
 * A pasted id prefix (from logs, a report, a URL) as a uuid range. Postgres
 * has no LIKE for uuid, so instead of casting we pad the hex prefix to the
 * lowest and highest ids that start with it and let the caller use
 * `.gte('id', lo).lte('id', hi)` — plain uuid comparisons PostgREST supports.
 * Dashes may be omitted or partial. Returns null when the text is not a hex
 * prefix, is shorter than 4 hex digits (a range too wide to be useful), or is
 * already a complete uuid (use `.eq`).
 */
export function uuidPrefixRange(value: string): { lo: string; hi: string } | null {
  const hex = value.trim().toLowerCase().replace(/-/g, '');
  if (!/^[0-9a-f]{4,31}$/.test(hex)) return null;
  const dash = (h: string) =>
    `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
  return { lo: dash(hex.padEnd(32, '0')), hi: dash(hex.padEnd(32, 'f')) };
}
