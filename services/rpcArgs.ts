import type { Database } from '@/types/supabase.generated';

type Fns = Database['public']['Functions'];
type Args<F extends keyof Fns> = Fns[F]['Args'];

/**
 * `supabase gen types` never marks RPC arguments as nullable, but SQL accepts
 * NULL (e.g. p_max_attendees NULL = unlimited, p_reason NULL = no note).
 * Wrap the args to keep name/shape checking while allowing explicit nulls.
 */
export function rpcArgs<F extends keyof Fns>(
  _fn: F,
  args: { [K in keyof Args<F>]: Args<F>[K] | null }
): Args<F> {
  return args as Args<F>;
}
