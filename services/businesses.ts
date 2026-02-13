import { supabase } from './supabase';
import { Business } from '@/types/database';

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
    const canCreate = business.events_created_this_month < maxCount;

    return {
      canCreate,
      currentCount: business.events_created_this_month,
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
};
