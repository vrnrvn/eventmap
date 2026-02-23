import { createClient } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';
import { PromotionForm } from '../PromotionForm';

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

export default async function NewPromotionPage() {
  const supabase = await createClient();

  async function createPromotion(formData: FormData) {
    'use server';
    const supabaseServer = await createClient();
    const {
      data: { user },
    } = await supabaseServer.auth.getUser();
    if (!user) throw new Error('Not authenticated');

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

    const { data, error } = await supabaseServer
      .from('promotional_notifications')
      .insert({
        title: formData.get('title') as string,
        body: formData.get('body') as string,
        link_url: (formData.get('link_url') as string) || null,
        promotion_type: promotionType,
        business_id: businessId,
        event_id: eventId,
        target_cities: cities,
        target_lat: lat,
        target_lng: lng,
        target_radius_km: radius,
        created_by: user.id,
        is_active: formData.get('is_active') === 'on',
      })
      .select('id')
      .single();

    if (error) throw error;
    redirect(`/promotions/${data.id}`);
  }

  return (
    <div>
      <h1 className="mb-6 text-2xl font-semibold text-zinc-900">New Promotion</h1>
      <PromotionForm action={createPromotion} />
    </div>
  );
}
