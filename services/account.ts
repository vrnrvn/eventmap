/**
 * Account-level actions (deletion).
 *
 * delete_own_account() is a SECURITY DEFINER RPC added by migration
 * 20261030109000. Until that migration is applied, the function does not
 * exist and Supabase returns 42883 (undefined_function) or PGRST202
 * (function not in schema cache) — surfaced as a typed NOT_AVAILABLE error
 * so the UI can degrade gracefully.
 */

import { supabase } from './supabase';

export class AccountDeletionUnavailableError extends Error {
  readonly code = 'NOT_AVAILABLE' as const;

  constructor() {
    super('Account deletion is not available on this server yet.');
    this.name = 'AccountDeletionUnavailableError';
  }
}

/**
 * Permanently deletes the calling user's account and all associated data.
 * On success the auth session is invalid server-side; callers should clear
 * the local session afterwards.
 */
export async function deleteAccount(): Promise<void> {
  // Not in the generated types until migration 20261030109000 is applied.
  const { error } = await (supabase as any).rpc('delete_own_account');
  if (error) {
    if (error.code === '42883' || error.code === 'PGRST202') {
      throw new AccountDeletionUnavailableError();
    }
    throw error;
  }
}

export const accountService = { deleteAccount };
