import { createClient } from '@/lib/supabase/server';
import { UsersTable } from './UsersTable';
import { Pagination, pageFromParams, pageRange } from '../Pagination';
import { SearchForm, escapeLike } from '../SearchForm';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function UsersPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const params = await searchParams;
  const page = pageFromParams(params.page);
  const q = typeof params.q === 'string' ? params.q.trim() : '';
  const [from, to] = pageRange(page);

  const supabase = await createClient();
  let query = supabase
    .from('profiles')
    .select('id, name, avatar_url, created_at', { count: 'exact' })
    .order('created_at', { ascending: false })
    .order('id')
    .range(from, to);

  if (q) {
    // A pasted user id (from logs, reports) finds that user directly; the
    // old client-side filter matched ids too.
    query = UUID_RE.test(q) ? query.eq('id', q) : query.ilike('name', `%${escapeLike(q)}%`);
  }

  const { data: users, count } = await query;

  const userIds = (users ?? []).map((u) => u.id);
  const { data: bannedIds } = userIds.length
    ? await supabase.from('banned_users').select('user_id').in('user_id', userIds)
    : { data: [] };

  const bannedSet = new Set((bannedIds ?? []).map((b) => b.user_id));

  return (
    <div>
      <h1 className="mb-6 text-2xl font-semibold text-zinc-900">Users</h1>
      <SearchForm action="/users" placeholder="Search by name..." defaultValue={q} />
      <UsersTable key={`${page}:${q}`} users={users ?? []} bannedSet={bannedSet} />
      <Pagination page={page} count={count} basePath="/users" query={q ? { q } : undefined} />
    </div>
  );
}
