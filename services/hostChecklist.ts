import { supabase } from './supabase';
import { isMissingDbFunction } from '@/utils/rpcErrors';
import { UNKNOWN_STATUS, parseHostStatus, type HostStatus } from '@/utils/hostChecklist';
import type { Business } from '@/types/database';

/**
 * Server half of the getting-started checklist.
 *
 * Uses get_host_onboarding_status (20261110130000). Until that migration is
 * applied it falls back to what the client can already read: the profile
 * fields from the business row and a published-event count. Everything else
 * stays unknown, and unknown items are hidden by buildHostChecklist rather
 * than shown as not done.
 */
export const hostChecklistService = {
  async getStatus(business: Pick<Business, 'id' | 'logo_url' | 'description' | 'notifications_enabled'>): Promise<HostStatus> {
    const { data, error } = await supabase.rpc('get_host_onboarding_status');
    if (!error) return parseHostStatus(data);
    if (!isMissingDbFunction(error)) throw error;
    return this.fallbackStatus(business);
  },

  async fallbackStatus(
    business: Pick<Business, 'id' | 'logo_url' | 'description' | 'notifications_enabled'>
  ): Promise<HostStatus> {
    let publishedEvents: number | null = null;
    try {
      const { count, error } = await supabase
        .from('events')
        .select('id', { count: 'exact', head: true })
        .eq('business_id', business.id)
        .eq('publish_state', 'published');
      if (!error) publishedEvents = count ?? 0;
    } catch {
      // Unknown stays unknown.
    }
    return {
      ...UNKNOWN_STATUS,
      hasLogo: !!business.logo_url?.trim(),
      hasDescription: !!business.description?.trim(),
      notificationsEnabled: business.notifications_enabled ?? true,
      publishedEvents,
    };
  },
};
