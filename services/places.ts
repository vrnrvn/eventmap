const AUTOCOMPLETE_URL = 'https://maps.googleapis.com/maps/api/place/autocomplete/json';

export type AutocompletePrediction = {
  description: string;
  placeId: string;
};

export type AutocompleteTypes = 'geocode' | 'address' | 'establishment' | 'cities' | 'regions';

export const placesService = {
  async autocomplete(
    input: string,
    opts?: { types?: AutocompleteTypes }
  ): Promise<AutocompletePrediction[]> {
    const key = process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY ?? '';
    if (!key || !input.trim()) return [];

    const types = opts?.types ?? 'geocode';
    const typesParam = types === 'cities' ? '(cities)' : types === 'regions' ? '(regions)' : types;
    const res = await fetch(
      `${AUTOCOMPLETE_URL}?input=${encodeURIComponent(input.trim())}&key=${key}&types=${typesParam}`
    );
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
};
