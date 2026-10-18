import { usesGoogleMaps } from './runtime';
import { searchLocalPlaces } from './localPlaces';

const AUTOCOMPLETE_URL = 'https://maps.googleapis.com/maps/api/place/autocomplete/json';
const PLACE_DETAILS_URL = 'https://maps.googleapis.com/maps/api/place/details/json';

export type AutocompletePrediction = {
  description: string;
  placeId: string;
};

export type AutocompleteTypes = 'geocode' | 'address' | 'establishment' | 'cities' | 'regions';

export type PlaceDetailsResult = {
  formattedAddress: string;
  lat: number;
  lng: number;
  name?: string;
};

export const placesService = {
  async autocomplete(
    input: string,
    opts?: { types?: AutocompleteTypes; /** Omit types filter for Google Maps–like results (addresses + businesses) */ allTypes?: boolean }
  ): Promise<AutocompletePrediction[]> {
    if (!usesGoogleMaps) return input.trim() ? searchLocalPlaces(input).map((place) => ({
      description: place.formattedAddress, placeId: place.formattedAddress,
    })) : [];
    const key = process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY ?? '';
    if (!key || !input.trim()) return [];

    const types = opts?.types;
    const allTypes = opts?.allTypes;
    const typesParam =
      allTypes || types == null
        ? null
        : types === 'cities'
          ? '(cities)'
          : types === 'regions'
            ? '(regions)'
            : types;
    const baseUrl = `${AUTOCOMPLETE_URL}?input=${encodeURIComponent(input.trim())}&key=${key}`;
    const url = typesParam != null ? `${baseUrl}&types=${typesParam}` : baseUrl;
    const res = await fetch(url);
    const data = await res.json();

    if (data.status !== 'OK' && data.status !== 'ZERO_RESULTS') {
      throw new Error(data.error_message ?? 'Autocomplete failed');
    }

    return (data.predictions ?? []).map(
      (p: { description: string; place_id: string }) => ({
        description: p.description,
        placeId: p.place_id,
      })
    );
  },

  async getPlaceDetails(placeId: string): Promise<PlaceDetailsResult | null> {
    if (!usesGoogleMaps) return searchLocalPlaces(placeId)[0] ?? null;
    const key = process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY ?? '';
    if (!key || !placeId) return null;

    const res = await fetch(
      `${PLACE_DETAILS_URL}?place_id=${encodeURIComponent(placeId)}&fields=formatted_address,geometry,name&key=${key}`
    );
    const data = await res.json();

    if (data.status !== 'OK') {
      throw new Error(data.error_message ?? 'Place details failed');
    }

    const result = data.result;
    if (!result?.geometry?.location) return null;

    return {
      formattedAddress: result.formatted_address ?? '',
      lat: result.geometry.location.lat,
      lng: result.geometry.location.lng,
      name: result.name,
    };
  },
};
