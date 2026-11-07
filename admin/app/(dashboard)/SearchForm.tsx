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

export function escapeLike(value: string): string {
  // PostgREST also treats `*` as a `%` wildcard in like/ilike filters and has
  // no escape for it; turn it into a single-character wildcard so a typed
  // `*` matches a literal `*` (and, rarely, any one character) instead of
  // matching everything.
  return value.replace(/[%_\\]/g, '\\$&').replace(/\*/g, '_');
}
