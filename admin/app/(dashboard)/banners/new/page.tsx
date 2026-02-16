import { createClient } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';
import { BannerForm } from '../BannerForm';

export default async function NewBannerPage() {
  const supabase = await createClient();

  async function createBanner(formData: FormData) {
    'use server';
    const supabaseServer = await createClient();
    const { error } = await supabaseServer.from('app_banners').insert({
      type: formData.get('type') as string,
      title: formData.get('title') as string,
      content: (formData.get('content') as string) || '',
      image_url: (formData.get('image_url') as string) || null,
      link_url: (formData.get('link_url') as string) || null,
      placement: (formData.get('placement') as string) || 'discover',
      is_active: formData.get('is_active') === 'on',
      sort_order: parseInt((formData.get('sort_order') as string) || '0', 10),
    });
    if (error) throw error;
    redirect('/banners');
  }

  return (
    <div>
      <h1 className="mb-6 text-2xl font-semibold text-zinc-900">New Banner</h1>
      <BannerForm action={createBanner} />
    </div>
  );
}
