import { createClient } from '@/lib/supabase/server';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { redirect } from 'next/navigation';
import { BannerForm } from '../BannerForm';

export default async function EditBannerPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();

  const { data: banner } = await supabase
    .from('app_banners')
    .select('*')
    .eq('id', id)
    .single();

  if (!banner) notFound();

  async function updateBanner(formData: FormData) {
    'use server';
    const supabaseServer = await createClient();
    const { error } = await supabaseServer
      .from('app_banners')
      .update({
        type: formData.get('type') as string,
        title: formData.get('title') as string,
        content: (formData.get('content') as string) || '',
        image_url: (formData.get('image_url') as string) || null,
        link_url: (formData.get('link_url') as string) || null,
        placement: (formData.get('placement') as string) || 'discover',
        is_active: formData.get('is_active') === 'on',
        sort_order: parseInt((formData.get('sort_order') as string) || '0', 10),
      })
      .eq('id', id);
    if (error) throw error;
    redirect('/banners');
  }

  return (
    <div>
      <Link href="/banners" className="mb-4 inline-block text-sm text-zinc-600 hover:text-zinc-900">
        ← Back to Banners
      </Link>
      <h1 className="mb-6 text-2xl font-semibold text-zinc-900">Edit Banner</h1>
      <BannerForm action={updateBanner} banner={banner} />
    </div>
  );
}
