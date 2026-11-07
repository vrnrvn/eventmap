import Link from 'next/link';
import { redirect } from 'next/navigation';

export const PAGE_SIZE = 50;

export function pageFromParams(value: string | string[] | undefined): number {
  const n = Number(Array.isArray(value) ? value[0] : value);
  return Number.isInteger(n) && n > 0 ? n : 1;
}

export function pageRange(page: number): [number, number] {
  const from = (page - 1) * PAGE_SIZE;
  return [from, from + PAGE_SIZE - 1];
}

export function Pagination({
  page,
  count,
  basePath,
  query,
}: {
  page: number;
  count: number | null;
  basePath: string;
  query?: Record<string, string>;
}) {
  const total = count ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const href = (p: number) => {
    const params = new URLSearchParams(query);
    params.set('page', String(p));
    return `${basePath}?${params.toString()}`;
  };
  // A page past the end (stale link, rows deleted, narrower search):
  // PostgREST answers PGRST103 and the count comes back null, which used to
  // render as an empty "0 total" page. Send it to the last real page (page 1
  // when the count is unknown). Page 1 never redirects, so this can't loop.
  if (page > 1 && (count === null || page > totalPages)) {
    redirect(href(count === null ? 1 : totalPages));
  }
  const linkClass =
    'rounded-md border border-zinc-300 bg-white px-3 py-1.5 text-sm text-zinc-700 hover:bg-zinc-50';
  const disabledClass =
    'rounded-md border border-zinc-200 bg-zinc-50 px-3 py-1.5 text-sm text-zinc-400';

  return (
    <div className="mt-4 flex items-center justify-between">
      <p className="text-sm text-zinc-600">
        Page {page} of {totalPages} ({total} total)
      </p>
      <div className="flex gap-2">
        {page > 1 ? (
          <Link href={href(page - 1)} className={linkClass}>
            Previous
          </Link>
        ) : (
          <span className={disabledClass}>Previous</span>
        )}
        {page < totalPages ? (
          <Link href={href(page + 1)} className={linkClass}>
            Next
          </Link>
        ) : (
          <span className={disabledClass}>Next</span>
        )}
      </div>
    </div>
  );
}
