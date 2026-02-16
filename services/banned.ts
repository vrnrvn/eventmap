import { supabase } from './supabase';

export const bannedService = {
  async isUserBanned(userId: string): Promise<boolean> {
    const { data, error } = await supabase
      .from('banned_users')
      .select('id')
      .eq('user_id', userId)
      .maybeSingle();

    if (error) throw error;
    return !!data;
  },
};
