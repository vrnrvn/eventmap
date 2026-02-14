const GEOCODE_URL = 'https://maps.googleapis.com/maps/api/geocode/json';

export type GeocodeResult = {
  lat: number;
  lng: number;
  formattedAddress: string;
};

export const geocodingService = {
  async search(query: string): Promise<GeocodeResult[]> {
    const key = process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY ?? '';
    if (!key) return [];

    const res = await fetch(
      `${GEOCODE_URL}?address=${encodeURIComponent(query)}&key=${key}`
    );
    const data = await res.json();

    if (data.status !== 'OK' && data.status !== 'ZERO_RESULTS') {
      throw new Error(data.error_message ?? 'Geocoding failed');
    }

    return (data.results ?? []).map((r: { geometry: { location: { lat: number; lng: number } }; formatted_address: string }) => ({
      lat: r.geometry.location.lat,
      lng: r.geometry.location.lng,
      formattedAddress: r.formatted_address,
    }));
  },

  async getFirst(query: string): Promise<GeocodeResult | null> {
    const results = await this.search(query);
    return results[0] ?? null;
  },

  async reverseGeocode(
    lat: number,
    lng: number,
    opts?: { preferAddress?: boolean }
  ): Promise<GeocodeResult | null> {
    const key = process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY ?? '';
    if (!key) return null;

    const fetchResult = (resultType?: string) => {
      let url = `${GEOCODE_URL}?latlng=${lat},${lng}&key=${key}`;
      if (resultType) url += `&result_type=${resultType}`;
      return fetch(url).then((r) => r.json());
    };

    let data = await fetchResult(
      opts?.preferAddress
        ? 'street_address|premise|subpremise|establishment'
        : undefined
    );

    if (data.status !== 'OK' && data.status !== 'ZERO_RESULTS') {
      throw new Error(data.error_message ?? 'Reverse geocoding failed');
    }

    if (opts?.preferAddress && (!data.results || data.results.length === 0)) {
      data = await fetchResult(undefined);
    }

    const first = data.results?.[0];
    if (!first) return null;

    return {
      lat: first.geometry.location.lat,
      lng: first.geometry.location.lng,
      formattedAddress: first.formatted_address,
    };
  },
};
