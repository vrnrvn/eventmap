import { createClient } from '@/lib/supabase/server';
import Link from 'next/link';
import { notFound } from 'next/navigation';

export default async function UserDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();

  const { data: profile } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', id)
    .single();

  if (!profile) notFound();

  const { data: business } = await supabase
    .from('businesses')
    .select('id, name, subscription_tier')
    .eq('owner_id', id)
    .maybeSingle();

  const { data: ban } = await supabase
    .from('banned_users')
    .select('reason, banned_at')
    .eq('user_id', id)
    .maybeSingle();

  return (
    <div>
      <Link href="/users" className="mb-4 inline-block text-sm text-zinc-600 hover:text-zinc-900">
        ← Back to Users
      </Link>
      <div className="rounded-lg border border-zinc-200 bg-white p-6">
        <h1 className="mb-6 text-2xl font-semibold text-zinc-900">{profile.name ?? '—'}</h1>
        <dl className="space-y-3">
          <div>
            <dt className="text-sm text-zinc-500">ID</dt>
            <dd className="font-mono text-sm">{profile.id}</dd>
          </div>
          <div>
            <dt className="text-sm text-zinc-500">Created</dt>
            <dd>{new Date(profile.created_at).toLocaleString()}</dd>
          </div>
          {business && (
            <div>
              <dt className="text-sm text-zinc-500">Business</dt>
              <dd>
                <Link href={`/businesses/${business.id}`} className="text-blue-600 hover:underline">
                  {business.name}
                </Link>{' '}
                ({business.subscription_tier})
              </dd>
            </div>
          )}
          {ban && (
            <div>
              <dt className="text-sm text-zinc-500">Banned</dt>
              <dd>
                {new Date(ban.banned_at).toLocaleString()}
                {ban.reason && ` — ${ban.reason}`}
              </dd>
            </div>
          )}
        </dl>
      </div>
    </div>
  );
}
