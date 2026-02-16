import { supabase } from './supabase';
import { profilesService } from './profiles';
import { eventsService } from './events';
import { Business, BusinessLink, BusinessPhoto } from '@/types/database';

export const businessesService = {
  async getUserBusiness(): Promise<Business | null> {
    const { data, error } = await supabase.rpc('get_user_business');

    if (error) throw error;
    return data && data.length > 0 ? data[0] : null;
  },

  async getBusiness(businessId: string): Promise<Business | null> {
    const { data, error } = await supabase
      .from('businesses')
      .select('*')
      .eq('id', businessId)
      .maybeSingle();

    if (error) throw error;
    return data;
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
    const {
      data: { user },
    } = await supabase.auth.getUser();
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
    return data;
  },

  async updateBusiness(
    businessId: string,
    updates: Partial<Business>
  ): Promise<void> {
    const { error } = await supabase
      .from('businesses')
      .update(updates)
      .eq('id', businessId);

    if (error) throw error;
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

    const maxCount = business.subscription_tier === 'premium' ? 30 : 2;
    let currentCount = business.events_created_this_month;

    const now = new Date();
    const lastReset = business.last_reset_date
      ? new Date(business.last_reset_date)
      : null;
    if (
      lastReset &&
      (now.getMonth() !== lastReset.getMonth() ||
        now.getFullYear() !== lastReset.getFullYear())
    ) {
      currentCount = 0;
    }

    const canCreate = currentCount < maxCount;

    return {
      canCreate,
      currentCount,
      maxCount,
    };
  },

  async getFollowerCount(businessId: string): Promise<number> {
    const { count, error } = await supabase
      .from('follows')
      .select('*', { count: 'exact', head: true })
      .eq('business_id', businessId);

    if (error) throw error;
    return count || 0;
  },

  async getFollowers(businessId: string): Promise<Array<{ id: string; user_id: string; created_at: string; profile: { name: string; avatar_url: string | null } }>> {
    const { data, error } = await supabase
      .from('follows')
      .select(`
        id,
        user_id,
        created_at,
        profiles:user_id (name, avatar_url)
      `)
      .eq('business_id', businessId)
      .order('created_at', { ascending: false });

    if (error) throw error;

    return (data || []).map((row: any) => {
      const profile = Array.isArray(row.profiles) ? row.profiles[0] : row.profiles;
      return {
        id: row.id,
        user_id: row.user_id,
        created_at: row.created_at,
        profile: profile || { name: 'User', avatar_url: null },
      };
    });
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

  async deleteBusinessPhoto(photoId: string): Promise<void> {
    const { error } = await supabase
      .from('business_photos')
      .delete()
      .eq('id', photoId);

    if (error) throw error;
  },
};
