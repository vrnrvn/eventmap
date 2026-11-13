import { useEffect, useState } from 'react';
import * as Location from 'expo-location';
import { useAuth } from '@/contexts/AuthContext';

export type BrowseCenter = { lat: number; lng: number; precise: boolean };

/** Discover's default centre, used when there is no profile area or device fix. */
export const DEFAULT_BROWSE_CENTER = { lat: 37.7749, lng: -122.4194 };
export const DEFAULT_BROWSE_RADIUS_KM = 25;
/** Second try for sparse areas (Category Browse offers it; the rail does it on its own). */
export const WIDE_BROWSE_RADIUS_KM = 100;

/**
 * Where "near you" looks for the browse surfaces (Category Browse, the smart
 * collection rail): the device's last known fix if permission was already
 * granted (never prompts), else the profile's home area, else the default.
 * Extracted from screens/CategoryBrowse.tsx so both read the same place.
 */
export function useBrowseCenter(): BrowseCenter | null {
  const { profile } = useAuth();
  const [center, setCenter] = useState<BrowseCenter | null>(null);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const perm = await Location.getForegroundPermissionsAsync();
        if (perm.granted) {
          const last = await Location.getLastKnownPositionAsync();
          if (last && !cancelled) {
            setCenter({ lat: last.coords.latitude, lng: last.coords.longitude, precise: true });
            return;
          }
        }
      } catch {
        // Fall through to the profile area / default.
      }
      if (cancelled) return;
      if (profile?.lat != null && profile?.lng != null) {
        setCenter({ lat: profile.lat, lng: profile.lng, precise: false });
      } else {
        setCenter({ ...DEFAULT_BROWSE_CENTER, precise: false });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [profile?.lat, profile?.lng]);
  return center;
}
