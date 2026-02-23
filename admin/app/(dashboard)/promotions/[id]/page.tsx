import { createClient } from '@/lib/supabase/server';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { redirect } from 'next/navigation';
import { PromotionForm } from '../PromotionForm';
import { DeletePromotionButton } from '../DeletePromotionButton';

function parseCities(val: string | null): string[] | null {
  if (!val || !val.trim()) return null;
  return val
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

function parseNum(val: string | null): number | null {
  if (val == null || val === '') return null;
  const n = parseFloat(val);
  return Number.isNaN(n) ? null : n;
}

export default async function EditPromotionPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();

  const { data: promotion } = await supabase
    .from('promotional_notifications')
    .select('*')
    .eq('id', id)
    .single();

  if (!promotion) notFound();

  async function updatePromotion(formData: FormData) {
    'use server';
    const supabaseServer = await createClient();

    const cities = parseCities(formData.get('target_cities') as string);
    let lat = parseNum(formData.get('target_lat') as string);
    let lng = parseNum(formData.get('target_lng') as string);
    let radius = parseNum(formData.get('target_radius_km') as string);

    const hasCity = cities && cities.length > 0;
    if (!hasCity) {
      if (lat == null && lng == null) {
        lat = 13.7563;
        lng = 100.5018;
      }
      if (radius == null) radius = 50;
    }
    const hasRadius = lat != null && lng != null && radius != null;
    if (!hasCity && !hasRadius) {
      throw new Error('Provide at least one targeting option: cities or lat/lng/radius');
    }

    const promotionType = (formData.get('promotion_type') as string) || 'generic';
    const businessId = (formData.get('business_id') as string) || null;
    const eventId = (formData.get('event_id') as string) || null;

    if (promotionType === 'business' && !businessId) {
      throw new Error('Business is required when promoting a business');
    }
    if (promotionType === 'event' && !eventId) {
      throw new Error('Event is required when promoting an event');
    }

    const { error } = await supabaseServer
      .from('promotional_notifications')
      .update({
        title: formData.get('title') as string,
        body: formData.get('body') as string,
        link_url: (formData.get('link_url') as string) || null,
        promotion_type: promotionType,
        business_id: promotionType === 'business' ? businessId : null,
        event_id: promotionType === 'event' ? eventId : null,
        target_cities: cities,
        target_lat: lat,
        target_lng: lng,
        target_radius_km: radius,
        is_active: formData.get('is_active') === 'on',
      })
      .eq('id', id);

    if (error) throw error;
    redirect('/promotions');
  }

  async function sendPromotion() {
    'use server';
    const supabaseServer = await createClient();
    const { data, error } = await supabaseServer.rpc('send_promotional_notification', {
      p_promotion_id: id,
    });
    if (error) throw error;
    redirect(`/promotions/${id}?sent=${data}`);
  }

  return (
    <div>
      <Link
        href="/promotions"
        className="mb-4 inline-block text-sm text-zinc-600 hover:text-zinc-900"
      >
        ← Back to Promotions
      </Link>
      <h1 className="mb-6 text-2xl font-semibold text-zinc-900">Edit Promotion</h1>
      <PromotionForm action={updatePromotion} promotion={promotion} />
      <div className="mt-8 flex flex-wrap items-center gap-4">
        <form action={sendPromotion}>
          <button
            type="submit"
            className="rounded-md bg-green-600 px-4 py-2 text-sm font-medium text-white hover:bg-green-700"
          >
            Send Now
          </button>
        </form>
        <DeletePromotionButton
          promotionId={id}
          promotionTitle={promotion.title}
          variant="button"
        />
        <p className="text-xs text-zinc-500">
          Sends push notifications to all users matching the target (city and/or radius).
        </p>
      </div>
    </div>
  );
}
