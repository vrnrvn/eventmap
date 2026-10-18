// Synthetic destinations and explicit coordinates keep local testing key-free.
const destinations = [
  { formattedAddress: 'San Francisco', lat: 37.7749, lng: -122.4194 },
  { formattedAddress: 'Demo venue, San Francisco', lat: 37.7749, lng: -122.4194 },
  { formattedAddress: 'New York', lat: 40.7128, lng: -74.006 },
  { formattedAddress: 'London', lat: 51.5074, lng: -0.1278 },
];

export function searchLocalPlaces(query: string) {
  const match = query.trim().match(/^(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)$/);
  if (match) {
    const lat = Number(match[1]);
    const lng = Number(match[2]);
    if (Math.abs(lat) <= 90 && Math.abs(lng) <= 180) return [{ formattedAddress: `${lat}, ${lng}`, lat, lng }];
    return [];
  }
  return destinations.filter((place) => place.formattedAddress.toLowerCase().includes(query.trim().toLowerCase()));
}
