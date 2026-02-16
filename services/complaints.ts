import { supabase } from './supabase';

export type ComplaintTargetType = 'event' | 'business' | 'user' | 'review';

export const complaintsService = {
  async createComplaint(
    targetType: ComplaintTargetType,
    targetId: string,
    reason?: string
  ): Promise<void> {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) throw new Error('Not authenticated');

    const { error } = await supabase.from('complaints').insert({
      reporter_id: user.id,
      target_type: targetType,
      target_id: targetId,
      reason: reason ?? null,
    });

    if (error) throw error;
  },
};
