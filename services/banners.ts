import { supabase } from './supabase';

export type AppBanner = {
  id: string;
  type: string;
  title: string;
  content: string;
  image_url: string | null;
  link_url: string | null;
  placement: string;
  is_active: boolean;
  sort_order: number;
};

export const bannersService = {
  async getActiveBanners(placement: string): Promise<AppBanner[]> {
    const { data, error } = await supabase
      .from('app_banners')
      .select('*')
      .eq('is_active', true)
      .eq('placement', placement)
      .order('sort_order', { ascending: true });

    if (error) throw error;
    return (data ?? []).map((banner) => ({ ...banner, content: banner.content ?? '' }));
  },
};
