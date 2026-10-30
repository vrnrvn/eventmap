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
    return data as Profile | null;
  },

  async getCurrentUserProfile(): Promise<Profile | null> {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return null;

    return this.getProfile(user.id);
  },

  /**
   * Another user's profile through the privacy-aware RPC. The profiles table
   * itself is readable only by its owner (and admins), so this is the one way
   * to see someone else's name, bio, and socials.
   */
  async getPublicProfile(userId: string): Promise<PublicProfileResult | null> {
    const { data, error } = await supabase.rpc('get_public_profile', {
      user_id_param: userId,
    });

    if (error) throw error;
    if (!data) return null;

    const raw = data as { is_private: boolean; profile?: Partial<Profile> };
    if (raw.is_private || !raw.profile) {
      return { isPrivate: true };
    }
    return { isPrivate: false, profile: raw.profile as Profile };
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
