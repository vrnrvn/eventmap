/**
 * True when an RPC failed because the function does not exist on this
 * backend yet (a prepared migration not applied): Postgres 42883
 * (undefined_function) or PostgREST PGRST202 (not in the schema cache).
 * Pure module (no supabase import) so node-run tests can import services
 * that only need this check.
 */
export type RpcError = { code?: string } | null;

export function isMissingDbFunction(error: RpcError): boolean {
  return !!error && (error.code === '42883' || error.code === 'PGRST202');
}

/**
 * Session-scoped registry of RPCs already found missing, so fallback paths
 * stop paying one failed round trip per call (services/calendar.ts had this
 * per-module; hostTools/analytics retried every time). The synthetic error
 * matches isMissingDbFunction, so callers' fallback branches are unchanged.
 */
const knownMissingRpcs = new Set<string>();

export const MISSING_RPC_ERROR = Object.freeze({
  code: '42883',
  message: 'RPC known missing on this backend (cached this session)',
});

export function isRpcKnownMissing(fn: string): boolean {
  return knownMissingRpcs.has(fn);
}

export function markRpcMissing(fn: string): void {
  knownMissingRpcs.add(fn);
}

/**
 * Registry key for one call shape: function name + the argument names
 * actually sent. Some callers probe a newer signature and retry the same
 * function with fewer arguments (host_remove_attendee without p_ban,
 * host_set_event_settings without approval mode); a missing NEWER signature
 * must not disable the older one for the session.
 */
export function rpcSignatureKey(fn: string, args: Record<string, unknown>): string {
  const names = Object.keys(args)
    .filter((k) => args[k] !== undefined)
    .sort();
  return `${fn}(${names.join(',')})`;
}
