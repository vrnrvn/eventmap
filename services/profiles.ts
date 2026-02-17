import { supabase } from './supabase';
import { Profile } from '@/types/database';

export type PublicProfileResult =
  | { isPrivate: true }
  | { isPrivate: false; profile: Profile };

export const profilesService = {
  async ensureProfileExists(userId: string, name?: string): Promise<void> {
    const { error } = await supabase.rpc('ensure_profile_exists', {
      p_user_id: userId,
      p_name: name ?? '',
    });
    if (error) throw error;
  },

  async getProfile(userId: string): Promise<Profile | null> {
    const { data, error } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', userId)
      .maybeSingle();

    if (error) throw error;
    return data;
  },

  async getCurrentUserProfile(): Promise<Profile | null> {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return null;

    return this.getProfile(user.id);
  },

  async getPublicProfile(userId: string): Promise<PublicProfileResult | null> {
    const { data: check, error: checkErr } = await supabase
      .from('profiles')
      .select('id, is_profile_private, show_future_events')
      .eq('id', userId)
      .maybeSingle();

    if (checkErr) throw checkErr;
    if (!check) return null;

    if (check.is_profile_private) {
      return { isPrivate: true };
    }

    const { data: full, error } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', userId)
      .maybeSingle();

    if (error) throw error;
    if (!full) return null;

    return {
      isPrivate: false,
      profile: full as Profile,
    };
  },

  async updateProfile(
    userId: string,
    updates: Partial<Profile>
  ): Promise<void> {
    const { error } = await supabase
      .from('profiles')
      .update(updates)
      .eq('id', userId);

    if (error) throw error;
  },

  async uploadAvatar(file: {
    uri: string;
    name: string;
    type: string;
  }): Promise<string> {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) throw new Error('Not authenticated');

    const fileExt = file.name.split('.').pop();
    const filePath = `${user.id}/avatar.${fileExt}`;

    const formData = new FormData();
    formData.append('file', {
      uri: file.uri,
      name: file.name,
      type: file.type,
    } as any);

    const { data, error } = await supabase.storage
      .from('avatars')
      .upload(filePath, formData, {
        upsert: true,
      });

    if (error) throw error;

    const {
      data: { publicUrl },
    } = supabase.storage.from('avatars').getPublicUrl(data.path);

    return publicUrl;
  },
};
