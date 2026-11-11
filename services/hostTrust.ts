import { supabase } from './supabase';
import { isMissingDbFunction } from '@/utils/rpcErrors';
import type { HostVerificationRequest } from '@/types/database';

/**
 * Host trust (HOST_ONBOARDING_PLAN.md §18): verification requests and
 * standing. Before 20261110140000 is applied the table and RPCs are missing;
 * reads then return 'unavailable' so the UI can say so instead of failing.
 */
const MISSING_TABLE = new Set(['42P01', 'PGRST205']);

export const hostTrustService = {
  /** Latest request for the caller's host profile (RLS scopes it to them). */
  async getLatestRequest(businessId: string): Promise<HostVerificationRequest | null | 'unavailable'> {
    const { data, error } = await supabase
      .from('host_verification_requests')
      .select('id, business_id, status, evidence_url, note, reviewer_note, reviewed_at, created_at, updated_at')
      .eq('business_id', businessId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) {
      if (MISSING_TABLE.has(error.code ?? '')) return 'unavailable';
      throw error;
    }
    return (data as HostVerificationRequest | null) ?? null;
  },

  /**
   * Stop hosting: cancels upcoming published events (attendees are notified)
   * and archives the host profile. Returns how many events were cancelled.
   */
  async archiveHost(): Promise<number> {
    const { data, error } = await supabase.rpc('archive_business');
    if (error) {
      if (isMissingDbFunction(error)) throw new Error('Stopping hosting is not available yet.');
      throw error;
    }
    return typeof data === 'number' ? data : 0;
  },

  async reopenHost(): Promise<void> {
    const { error } = await supabase.rpc('reopen_business');
    if (error) {
      if (isMissingDbFunction(error)) throw new Error('Reopening is not available yet.');
      throw error;
    }
  },

  /** Returns the request id (a needs_info request is reused). */
  async submitRequest(evidenceUrl: string, note: string | null): Promise<string> {
    const { data, error } = await supabase.rpc('submit_verification_request', {
      p_evidence_url: evidenceUrl,
      p_note: note ?? undefined,
    });
    if (error) {
      if (isMissingDbFunction(error)) throw new Error('Verification requests are not available yet.');
      throw error;
    }
    return data as string;
  },
};
