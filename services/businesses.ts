import { supabase, getSessionUser } from './supabase';
import { imageCleanupMayRun, releaseEventImages } from './storageCleanup';
import { sameUtcMonth } from '@/utils/premiumState';
import { profilesService } from './profiles';
import { Business, BusinessLink, BusinessPhoto } from '@/types/database';
import { HOST_TERMS_VERSION, HostInsert, buildHostShapeUpdate, legacyHostInsert } from '@/utils/hostSetup';
import { isMissingColumnError } from '@/utils/hostIntent';

/** The backend cannot store this host shape yet (migration not applied). */
export class HostSetupUnsupportedError extends Error {
  readonly code = 'host_setup_unsupported';
}

export const businessesService = {
  async getUserBusiness(): Promise<Business | null> {
    const { data, error } = await supabase.rpc('get_user_business');

    if (error) throw error;
    return data && data.length > 0 ? data[0] as Business : null;
  },

  async getBusiness(businessId: string): Promise<Business | null> {
    const { data, error } = await supabase
      .from('businesses')
      .select('*')
      .eq('id', businessId)
      .maybeSingle();

    if (error) throw error;
    return data as Business | null;
  },

  async createBusiness(businessData: {
    name: string;
    description: string;
    category: string;
    address: string;
    lat: number;
    lng: number;
    logoUrl?: string | null;
  }): Promise<Business> {
    const user = await getSessionUser();
    if (!user) throw new Error('Not authenticated');

    await profilesService.ensureProfileExists(user.id, user.user_metadata?.name ?? user.email ?? '');

    const { data, error } = await supabase
      .from('businesses')
      .insert({
        owner_id: user.id,
        name: businessData.name,
        description: businessData.description,
        category: businessData.category,
        address: businessData.address,
        lat: businessData.lat,
        lng: businessData.lng,
        logo_url: businessData.logoUrl || null,
        verified: false,
        subscription_tier: 'free',
      })
      .select()
      .single();

    if (error) throw error;
    return data as Business;
  },

  /**
   * Host setup insert (HOST_ONBOARDING_PLAN.md Stage 2). Sends the new host
   * columns; on a backend without 20261110110000 (missing column) it retries
   * with the original columns, which only works when the host has a pin.
   * Returns which schema was used so the UI can say what was not saved.
   */
  async createHost(insert: HostInsert & { logo_url: string | null }): Promise<{ business: Business; schema: 'host' | 'legacy' }> {
    const user = await getSessionUser();
    if (!user) throw new Error('Not authenticated');
    await profilesService.ensureProfileExists(user.id, user.user_metadata?.name ?? user.email ?? '');

    const first = await supabase
      .from('businesses')
      .insert({ ...insert, owner_id: user.id })
      .select()
      .single();
    if (!first.error) return { business: first.data as Business, schema: 'host' };
    if (!isMissingColumnError(first.error)) throw first.error;

    const legacy = legacyHostInsert(insert);
    if (!legacy) {
      throw new HostSetupUnsupportedError(
        'Hosting without a location is not available yet. Add a home area to continue.'
      );
    }
    const second = await supabase
      .from('businesses')
      .insert({ ...legacy, logo_url: insert.logo_url, owner_id: user.id })
      .select()
      .single();
    if (second.error) throw second.error;
    return { business: second.data as Business, schema: 'legacy' };
  },

  async updateBusiness(
    businessId: string,
    updates: Partial<Business>
  ): Promise<void> {
    // A replaced logo may leave its file unused (services/storageCleanup).
    let previousLogo: string | null = null;
    if ('logo_url' in updates && imageCleanupMayRun()) {
      const { data } = await supabase.from('businesses').select('logo_url').eq('id', businessId).maybeSingle();
      previousLogo = (data as { logo_url?: string | null } | null)?.logo_url ?? null;
    }
    const { error } = await supabase
      .from('businesses')
      .update(updates)
      .eq('id', businessId);

    if (error) throw error;
    if (previousLogo && previousLogo !== updates.logo_url) releaseEventImages([previousLogo]);
  },

  async deleteBusiness(businessId: string): Promise<void> {
    const { error } = await supabase
      .from('businesses')
      .delete()
      .eq('id', businessId);

    if (error) throw error;
  },

  async checkEventLimit(businessId: string): Promise<{
    canCreate: boolean;
    currentCount: number;
    maxCount: number;
  }> {
    const business = await this.getBusiness(businessId);
    if (!business) throw new Error('Business not found');

    // Same rule as the server's business_has_premium(): tier + unexpired.
    const premium =
      business.subscription_tier === 'premium' &&
      (!business.subscription_expires_at || new Date(business.subscription_expires_at).getTime() > Date.now());
    const maxCount = premium ? 30 : 2;
    let currentCount = business.events_created_this_month;

    // UTC month, like the server's reset (see utils/premiumState).
    if (business.last_reset_date && !sameUtcMonth(new Date(business.last_reset_date), new Date())) {
      currentCount = 0;
    }

    const canCreate = currentCount < maxCount;

    return {
      canCreate,
      currentCount,
      maxCount,
    };
  },

  /**
   * Sends an in-app notification about the event to every follower of the
   * owning business (server-side deduped per follower+event, so repeat calls
   * cannot spam). SECURITY DEFINER RPC from migration 20261030112000; until
   * it is applied the call fails with 42883/PGRST202 (missing function) and
   * callers should surface a "not enabled yet" message.
   * Returns the number of notifications inserted.
   */
  async notifyFollowersAboutEvent(eventId: string): Promise<number> {
    // Not in the generated types until migration 20261030112000 is applied.
    const { data, error } = await (supabase as any).rpc(
      'notify_followers_about_event',
      { p_event_id: eventId }
    );
    if (error) throw error;
    return typeof data === 'number' ? data : 0;
  },

  async getFollowerCount(businessId: string): Promise<number> {
    const { count, error } = await supabase
      .from('follows')
      .select('*', { count: 'exact', head: true })
      .eq('business_id', businessId);

    if (error) throw error;
    return count || 0;
  },

  async getFollowers(businessId: string): Promise<{ id: string; user_id: string; created_at: string; profile: { name: string; avatar_url: string | null } }[]> {
    const { data, error } = await supabase
      .from('follows')
      .select('id, user_id, created_at')
      .eq('business_id', businessId)
      .order('created_at', { ascending: false });

    if (error) throw error;

    const rows = data || [];
    const profiles = await fetchDisplayProfiles(rows.map((row) => row.user_id));
    return rows.map((row) => ({
      id: row.id,
      user_id: row.user_id,
      created_at: row.created_at,
      profile: profiles.get(row.user_id) || { name: 'User', avatar_url: null },
    }));
  },

  /** Host type / location change from Settings → Host profile. */
  async updateHostShape(businessId: string, patch: ReturnType<typeof buildHostShapeUpdate>): Promise<void> {
    const { error } = await supabase.from('businesses').update(patch).eq('id', businessId);
    if (error) throw error;
  },

  /** Accept the current host guidelines; the server stamps the time. */
  async acceptHostTerms(businessId: string): Promise<void> {
    const { error } = await supabase
      .from('businesses')
      .update({ host_terms_version: HOST_TERMS_VERSION })
      .eq('id', businessId);
    if (error) throw error;
  },

  async deleteBusinessLink(linkId: string): Promise<void> {
    const { error } = await supabase.from('business_links').delete().eq('id', linkId);
    if (error) throw error;
  },

  async addBusinessLink(businessId: string, url: string, label: string | null = null, sortOrder = 0): Promise<void> {
    const { error } = await supabase
      .from('business_links')
      .insert({ business_id: businessId, url, label, sort_order: sortOrder });
    if (error) throw error;
  },

  async getBusinessLinks(businessId: string): Promise<BusinessLink[]> {
    const { data, error } = await supabase
      .from('business_links')
      .select('*')
      .eq('business_id', businessId)
      .order('sort_order', { ascending: true });

    if (error) throw error;
    return data || [];
  },

  async getBusinessPhotos(businessId: string): Promise<BusinessPhoto[]> {
    const { data, error } = await supabase
      .from('business_photos')
      .select('*')
      .eq('business_id', businessId)
      .order('sort_order', { ascending: true });

    if (error) throw error;
    return data || [];
  },

  async addBusinessPhoto(businessId: string, imageUrl: string, sortOrder: number): Promise<void> {
    const { error } = await supabase.from('business_photos').insert({
      business_id: businessId,
      image_url: imageUrl,
      sort_order: sortOrder,
    });

    if (error) throw error;
  },

  async updateBusinessPhotoOrder(photoId: string, sortOrder: number): Promise<void> {
    const { error } = await supabase
      .from('business_photos')
      .update({ sort_order: sortOrder })
      .eq('id', photoId);

    if (error) throw error;
  },

  async deleteBusinessPhoto(photoId: string): Promise<void> {
    const { data: row } = imageCleanupMayRun()
      ? await supabase.from('business_photos').select('image_url').eq('id', photoId).maybeSingle()
      : { data: null };
    const { error } = await supabase
      .from('business_photos')
      .delete()
      .eq('id', photoId);

    if (error) throw error;
    releaseEventImages([(row as { image_url?: string } | null)?.image_url]);
  },
};

// Display identities come from an RPC because the profiles table is readable
// only by its owner.
async function fetchDisplayProfiles(
  userIds: string[]
): Promise<Map<string, { name: string; avatar_url: string | null }>> {
  const unique = Array.from(new Set(userIds));
  if (unique.length === 0) return new Map();
  const { data, error } = await supabase.rpc('get_profiles_display', { user_ids: unique });
  if (error) throw error;
  const rows = (data as unknown as { id: string; name: string; avatar_url: string | null }[]) || [];
  return new Map(rows.map((row) => [row.id, { name: row.name, avatar_url: row.avatar_url }]));
}
