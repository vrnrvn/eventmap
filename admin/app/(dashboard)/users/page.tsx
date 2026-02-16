import { createClient } from '@/lib/supabase/server';
import Link from 'next/link';
import { UsersTable } from './UsersTable';

export default async function UsersPage() {
  const supabase = await createClient();
  const { data: users } = await supabase
    .from('profiles')
    .select('id, name, avatar_url, created_at')
    .order('created_at', { ascending: false });

  const { data: bannedIds } = await supabase
    .from('banned_users')
    .select('user_id');

  const bannedSet = new Set((bannedIds ?? []).map((b) => b.user_id));

  return (
    <div>
      <h1 className="mb-6 text-2xl font-semibold text-zinc-900">Users</h1>
      <UsersTable users={users ?? []} bannedSet={bannedSet} />
    </div>
  );
}
