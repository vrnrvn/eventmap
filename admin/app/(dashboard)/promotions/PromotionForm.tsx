'use client';

import { useState } from 'react';
import dynamic from 'next/dynamic';
import { MapPicker } from './MapPicker';
import { BusinessSelector } from './BusinessSelector';
import { EventSelector } from './EventSelector';

export type PromotionType = 'business' | 'event' | 'generic';

type PromotionFormProps = {
  action: (formData: FormData) => Promise<void>;
  promotion?: {
    title: string;
    body: string;
    link_url: string | null;
    target_cities: string[] | null;
    target_lat: number | null;
    target_lng: number | null;
    target_radius_km: number | null;
    is_active: boolean;
    promotion_type: PromotionType | null;
    business_id: string | null;
    event_id: string | null;
  };
};

const MapPickerClient = dynamic(
  () => Promise.resolve({ default: MapPicker }),
  { ssr: false }
);

export function PromotionForm({ action, promotion }: PromotionFormProps) {
  const [promotionType, setPromotionType] = useState<PromotionType>(
    promotion?.promotion_type ?? 'generic'
  );
  const [businessId, setBusinessId] = useState<string | null>(
    promotion?.business_id ?? null
  );
  const [eventId, setEventId] = useState<string | null>(
    promotion?.event_id ?? null
  );

  const handleMapSelect = (lat: number, lng: number) => {
    const latInput = document.getElementById('target_lat') as HTMLInputElement | null;
    const lngInput = document.getElementById('target_lng') as HTMLInputElement | null;
    if (latInput) latInput.value = String(lat);
    if (lngInput) lngInput.value = String(lng);
  };

  return (
    <form action={action} className="max-w-xl space-y-4">
      <div>
        <label className="mb-2 block text-sm font-medium text-zinc-700">
          Promotion type
        </label>
        <div className="flex gap-4">
          <label className="flex items-center gap-2">
            <input
              type="radio"
              name="promotion_type"
              value="business"
              checked={promotionType === 'business'}
              onChange={() => setPromotionType('business')}
              className="h-4 w-4"
            />
            <span className="text-sm">Promote a business</span>
          </label>
          <label className="flex items-center gap-2">
            <input
              type="radio"
              name="promotion_type"
              value="event"
              checked={promotionType === 'event'}
              onChange={() => setPromotionType('event')}
              className="h-4 w-4"
            />
            <span className="text-sm">Promote an event</span>
          </label>
          <label className="flex items-center gap-2">
            <input
              type="radio"
              name="promotion_type"
              value="generic"
              checked={promotionType === 'generic'}
              onChange={() => setPromotionType('generic')}
              className="h-4 w-4"
            />
            <span className="text-sm">Generic link</span>
          </label>
        </div>
      </div>

      {promotionType === 'business' && (
        <div>
          <label htmlFor="business_id" className="mb-1 block text-sm font-medium text-zinc-700">
            Business (required)
          </label>
          <BusinessSelector
            value={businessId}
            onChange={setBusinessId}
            required
          />
        </div>
      )}

      {promotionType === 'event' && (
        <div>
          <label htmlFor="event_id" className="mb-1 block text-sm font-medium text-zinc-700">
            Event (required)
          </label>
          <EventSelector
            value={eventId}
            onChange={setEventId}
            required
          />
        </div>
      )}

      {promotionType === 'generic' && (
        <div>
          <label htmlFor="link_url" className="mb-1 block text-sm font-medium text-zinc-700">
            Link URL (optional)
          </label>
          <input
            id="link_url"
            name="link_url"
            type="url"
            defaultValue={promotion?.link_url ?? ''}
            className="w-full rounded-md border border-zinc-300 px-3 py-2 text-sm"
          />
        </div>
      )}

      {promotionType !== 'generic' && (
        <div>
          <label htmlFor="link_url_fallback" className="mb-1 block text-sm font-medium text-zinc-700">
            Link URL (optional, fallback)
          </label>
          <input
            id="link_url_fallback"
            name="link_url"
            type="url"
            defaultValue={promotion?.link_url ?? ''}
            className="w-full rounded-md border border-zinc-300 px-3 py-2 text-sm"
          />
        </div>
      )}

      <div>
        <label htmlFor="title" className="mb-1 block text-sm font-medium text-zinc-700">
          Title
        </label>
        <input
          id="title"
          name="title"
          type="text"
          required
          defaultValue={promotion?.title ?? ''}
          className="w-full rounded-md border border-zinc-300 px-3 py-2 text-sm"
        />
      </div>
      <div>
        <label htmlFor="body" className="mb-1 block text-sm font-medium text-zinc-700">
          Body
        </label>
        <textarea
          id="body"
          name="body"
          rows={3}
          required
          defaultValue={promotion?.body ?? ''}
          className="w-full rounded-md border border-zinc-300 px-3 py-2 text-sm"
        />
      </div>

      {promotionType !== 'generic' && (
        <div>
          <label htmlFor="link_url" className="mb-1 block text-sm font-medium text-zinc-700">
            Link URL (optional, for generic fallback)
          </label>
          <input
            id="link_url"
            name="link_url"
            type="url"
            defaultValue={promotion?.link_url ?? ''}
            className="w-full rounded-md border border-zinc-300 px-3 py-2 text-sm"
          />
        </div>
      )}

      <div>
        <label htmlFor="target_cities" className="mb-1 block text-sm font-medium text-zinc-700">
          Target cities (comma-separated, e.g. BKK, Bangkok, Bangkok Metropolitan)
        </label>
        <input
          id="target_cities"
          name="target_cities"
          type="text"
          placeholder="BKK, Bangkok"
          defaultValue={
            promotion?.target_cities?.length
              ? promotion.target_cities.join(', ')
              : ''
          }
          className="w-full rounded-md border border-zinc-300 px-3 py-2 text-sm"
        />
      </div>
      <div>
        <label className="mb-1 block text-sm font-medium text-zinc-700">
          Map – pick center for radius targeting
        </label>
        <MapPickerClient
          initialLat={promotion?.target_lat ?? undefined}
          initialLng={promotion?.target_lng ?? undefined}
          onSelect={handleMapSelect}
          height={280}
        />
      </div>
      <div className="grid grid-cols-3 gap-4">
        <div>
          <label htmlFor="target_lat" className="mb-1 block text-sm font-medium text-zinc-700">
            Lat (radius mode)
          </label>
          <input
            id="target_lat"
            name="target_lat"
            type="number"
            step="any"
            defaultValue={promotion?.target_lat ?? ''}
            placeholder="13.7563"
            className="w-full rounded-md border border-zinc-300 px-3 py-2 text-sm"
          />
        </div>
        <div>
          <label htmlFor="target_lng" className="mb-1 block text-sm font-medium text-zinc-700">
            Lng (radius mode)
          </label>
          <input
            id="target_lng"
            name="target_lng"
            type="number"
            step="any"
            defaultValue={promotion?.target_lng ?? ''}
            placeholder="100.5018"
            className="w-full rounded-md border border-zinc-300 px-3 py-2 text-sm"
          />
        </div>
        <div>
          <label htmlFor="target_radius_km" className="mb-1 block text-sm font-medium text-zinc-700">
            Radius (km)
          </label>
          <input
            id="target_radius_km"
            name="target_radius_km"
            type="number"
            step="any"
            min="0"
            defaultValue={promotion?.target_radius_km ?? 50}
            placeholder="50"
            className="w-full rounded-md border border-zinc-300 px-3 py-2 text-sm"
          />
        </div>
      </div>
      <p className="text-xs text-zinc-500">
        City names (e.g. Bangkok) and/or map + radius. Defaults to Bangkok 50 km if left empty.
      </p>
      <div className="flex items-center gap-2">
        <input
          id="is_active"
          name="is_active"
          type="checkbox"
          defaultChecked={promotion?.is_active ?? true}
          className="h-4 w-4 rounded border-zinc-300"
        />
        <label htmlFor="is_active" className="text-sm text-zinc-700">
          Active
        </label>
      </div>
      <button
        type="submit"
        className="rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800"
      >
        {promotion ? 'Update' : 'Create'}
      </button>
    </form>
  );
}
