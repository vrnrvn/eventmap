import { createClient } from '@/lib/supabase/server';
import { VerificationTable, type VerificationRequestRow } from './VerificationTable';

/**
 * Host verification queue (HOST_ONBOARDING_PLAN.md §18). Oldest pending
 * first, so nobody waits behind newer requests. The table and its RPCs come
 * from migration 20261110140000; before it is applied the page says so.
 */
export default async function VerificationPage() {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('host_verification_requests')
    .select(
      `
      id,
      status,
      evidence_url,
      note,
      reviewer_note,
      created_at,
      businesses:business_id (id, name, host_type, description)
    `
    )
    .in('status', ['pending', 'needs_info'])
    .order('created_at', { ascending: true })
    .limit(100);

  const missing = error && ['42P01', 'PGRST205'].includes(error.code ?? '');

  return (
    <div>
      <h1 className="mb-2 text-2xl font-semibold text-zinc-900">Host verification</h1>
      <p className="mb-6 text-sm text-zinc-600">
        Check the link proves the host is who they say they are. Asking for more information keeps the request open; the
        host sees your note in Settings.
      </p>
      {missing ? (
        <p className="rounded border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
          Verification requests need migration 20261110140000, which is not applied on this database yet.
        </p>
      ) : error ? (
        <p className="rounded border border-red-200 bg-red-50 p-4 text-sm text-red-800">Could not load requests: {error.message}</p>
      ) : (
        <VerificationTable requests={(data ?? []) as unknown as VerificationRequestRow[]} />
      )}
    </div>
  );
}
