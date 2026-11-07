import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Pressable,
  ActivityIndicator,
  useWindowDimensions,
  Platform,
  Image,
  ScrollView,
  Modal,
  Linking,
} from 'react-native';
import { Image as ExpoImage } from 'expo-image';
import { router, useFocusEffect } from 'expo-router';
import * as Location from 'expo-location';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import BottomSheet, { BottomSheetFlatList } from '@gorhom/bottom-sheet';
import { useAuth } from '@/contexts/AuthContext';
import { useApp } from '@/contexts/AppContext';
import { useSearch, type SearchDateRange } from '@/contexts/SearchContext';
import { eventsService } from '@/services/events';
import { useIsRestoring, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { PERSISTED_QUERY } from '@/utils/queryPersistence';
import { queryKeys } from '@/hooks/queryKeys';
import { useCategories } from '@/hooks/useCategories';
import { useConnectivity } from '@/services/connectivity';
import { freshnessNote } from '@/utils/screenState';
import { FreshnessNote } from '@/components/ui/QueryStates';
import { isUnfiltered, makeDiscoverSnapshot, parseDiscoverSnapshot } from '@/utils/discoverSnapshot';
import { getConnectivity, subscribeConnectivity } from '@/utils/connectivity';
import { RankedEvent } from '@/types/database';
import { Colors, Spacing, Typography, BorderRadius, Shadows } from '@/constants/theme';
import { getCategoryIconColor } from '@/constants/categoryIcons';
import { CategoryIcon } from '@/components/CategoryIcon';
import { X, Search, SlidersHorizontal, Plus, MapPin, Flame } from '@/components/icons.generated';
import { EventmapFilter, EventmapMapPin, EventmapCalendar } from '@/components/icons/EventmapIcons';
import { GoogleMapView, type GoogleMapHandle } from '@/components/GoogleMapView';
import { SearchOverlay } from '@/components/SearchOverlay';
import { filterEventsByDateRange, getNextOccurrences } from '@/utils/recurrence';
import { centroidOf, isInBounds, radiusKmFromBounds, zoomForPoints } from '@/utils/geoBounds';
import { bannersService, type AppBanner } from '@/services/banners';
import { AppBannerCarousel } from '@/components/AppBannerCarousel';
import { ErrorState } from '@/components/ui/ErrorState';
import { notify } from '@/utils/notify';
import { Button } from '@/components/ui/Button';
import { DiscoverEventCard } from '@/components/DiscoverEventCard';
import {
  DATE_PRESETS,
  matchDatePreset,
  type DatePresetKey,
} from '@/utils/datePresets';

/** Collapsed sheet peek, as a share of window height. */
const SHEET_PEEK_RATIO = 0.13;
/** Matches listContent/sheetHeader paddingHorizontal (24pt per side). */
const LIST_HORIZONTAL_PADDING = 24;

const DEFAULT_CENTER = { lat: 37.7749, lng: -122.4194 };
const REGION_DEBOUNCE_MS = 500;
const HEADER_HEIGHT_PX = 170;
// Smaller pages scroll in smoothly; pre-apply (20261030110000) the service
// falls back to one legacy 100-event fetch and reports no further pages.
const EVENTS_PAGE_SIZE = 50;

/** Chips sit ~30pt tall over the map; this lifts the tap target past 44pt. */
const CHIP_HIT_SLOP = { top: 8, bottom: 8, left: 4, right: 4 };

const GPS_TIMEOUT_MS = 8000;

/**
 * Current position, or the last known one if a fresh fix fails or takes
 * longer than GPS_TIMEOUT_MS (a cold fix with no data connection can take
 * much longer). Null when neither is available; never throws.
 */
async function getPositionWithTimeout(): Promise<Location.LocationObject | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const fresh = await Promise.race([
      Location.getCurrentPositionAsync({}),
      new Promise<null>((resolve) => {
        timer = setTimeout(() => resolve(null), GPS_TIMEOUT_MS);
      }),
    ]);
    if (fresh) return fresh;
  } catch {
    // Fall through to the last known position.
  } finally {
    clearTimeout(timer);
  }
  return Location.getLastKnownPositionAsync().catch(() => null);
}

const NO_BANNERS: AppBanner[] = [];

/** Discover's saved last area, if any (see the screen's `lastArea`). */
function readLastArea(queryClient: QueryClient) {
  const key = queryKeys.discoverLastArea();
  const snapshot = parseDiscoverSnapshot<RankedEvent>(queryClient.getQueryData(key));
  if (!snapshot || snapshot.items.length === 0) return null;
  return { ...snapshot, updatedAt: queryClient.getQueryState(key)?.dataUpdatedAt ?? 0 };
}

function truncateText(text: string, limit = 50): string {
  if (!text || text.length <= limit) return text;
  return text.slice(0, limit).trim() + '...';
}

export default function DiscoverScreen() {
  const insets = useSafeAreaInsets();
  // Measured per render: card width, sheet snap points and the FAB offset all
  // depend on it, and a module-level Dimensions.get() froze them at import.
  const { width: windowWidth, height: windowHeight } = useWindowDimensions();
  const eventCardWidth = windowWidth - LIST_HORIZONTAL_PADDING * 2;
  const { profile } = useAuth();
  const { hasBusiness, loading: appLoading } = useApp();
  const { location: searchLocation, dateRange, setDateRange } = useSearch();
  const queryClient = useQueryClient();
  const connectivity = useConnectivity();
  // The last unfiltered area this device loaded (utils/discoverSnapshot):
  // Discover opens on it with its pins and list, offline included, while the
  // real location loads (docs/OFFLINE_PLAN.md §3.5).
  const [lastArea] = useState(() => readLastArea(queryClient));
  const [events, setEvents] = useState<RankedEvent[]>(lastArea?.items ?? []);
  // When the events on screen were fetched; drives the freshness note.
  const [eventsUpdatedAt, setEventsUpdatedAt] = useState(lastArea?.updatedAt ?? 0);
  // Category chips load on their own (shared, cached query): a failure keeps
  // the chips already shown and never stops the events request.
  const { categories, refetch: refetchCategories } = useCategories();
  const [loading, setLoading] = useState(!lastArea);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategories, setSelectedCategories] = useState<string[]>([]);
  const [showSearchOverlay, setShowSearchOverlay] = useState(false);
  const [showFilters, setShowFilters] = useState(false);
  const [center, setCenter] = useState(lastArea?.center ?? DEFAULT_CENTER);
  // Where the map actually sits. A ref, not state: it changes on every pan
  // moveend, and nothing renders from it — render-side code uses
  // `centerForMap` (set only on explicit moves) or reads the ref in handlers.
  // As state it re-rendered this whole screen once per pan for nothing.
  const mapCenterRef = useRef(lastArea?.center ?? DEFAULT_CENTER);
  const setMapCenter = (loc: { lat: number; lng: number }) => {
    mapCenterRef.current = loc;
  };
  // The center the map component is told to show; only explicit moves
  // (search, locate-me, restore) update it — user pans must not fight it.
  const [centerForMap, setCenterForMap] = useState(lastArea?.center ?? DEFAULT_CENTER);
  const [mapBounds, setMapBounds] = useState<{
    ne: { lat: number; lng: number };
    sw: { lat: number; lng: number };
  } | null>(null);
  const [sheetIndex, setSheetIndex] = useState(0);
  const [activeMarkerId, setActiveMarkerId] = useState<string | null>(null);
  const [showFloatingCard, setShowFloatingCard] = useState(false);
  const [userLocation, setUserLocation] = useState<{ lat: number; lng: number } | null>(null);
  // Kept on the device like the rest of Discover; hidden if none ever loaded.
  const { data: banners = NO_BANNERS } = useQuery({
    queryKey: queryKeys.banners('discover'),
    ...PERSISTED_QUERY,
    queryFn: () => bannersService.getActiveBanners('discover'),
    staleTime: 10 * 60 * 1000,
  });
  const [locationDenied, setLocationDenied] = useState(false);
  const [locationBannerDismissed, setLocationBannerDismissed] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMoreEvents, setHasMoreEvents] = useState(lastArea?.hasMore ?? false);
  const [refreshing, setRefreshing] = useState(false);
  const [loadError, setLoadError] = useState(false);

  const bottomSheetRef = useRef<BottomSheet>(null);
  const mapRef = useRef<GoogleMapHandle>(null);
  const flatListRef = useRef<any>(null);
  const isScrollingFromMapRef = useRef(false);
  const lastViewedIndexRef = useRef<number>(0);
  const hasInitializedMapRef = useRef(false);

  const isProgrammaticMoveRef = useRef(false);
  const programmaticMoveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const beginProgrammaticMove = useCallback((durationMs = 800) => {
    isProgrammaticMoveRef.current = true;
    if (programmaticMoveTimerRef.current) {
      clearTimeout(programmaticMoveTimerRef.current);
    }
    programmaticMoveTimerRef.current = setTimeout(() => {
      isProgrammaticMoveRef.current = false;
      programmaticMoveTimerRef.current = null;
    }, durationMs);
  }, []);

  useEffect(() => {
    loadInitialData();
  }, [profile]);


  useEffect(() => {
    return () => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }
      if (programmaticMoveTimerRef.current) {
        clearTimeout(programmaticMoveTimerRef.current);
      }
    };
  }, []);

  // One fetch per genuine filter change. The effect used to re-run for any
  // identity change (and on mount, against the default centre) while
  // handleSearchFromOverlay issued its own load — up to three requests per
  // search. Comparing a signature makes the programmatic path and this effect
  // mutually exclusive.
  const filterSignature = useMemo(
    () =>
      JSON.stringify({
        q: searchQuery,
        c: [...selectedCategories].sort(),
        d: dateRange ? [dateRange.start.getTime(), dateRange.end.getTime()] : null,
      }),
    [searchQuery, selectedCategories, dateRange]
  );
  // Seeded with the initial signature so mount doesn't duplicate
  // loadInitialData's fetch.
  const lastFilterSignatureRef = useRef(filterSignature);

  useEffect(() => {
    if (lastFilterSignatureRef.current === filterSignature) return;
    lastFilterSignatureRef.current = filterSignature;
    loadEventsWithCenter(center.lat, center.lng);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filterSignature]);

  const mapBoundsRef = useRef(mapBounds);
  mapBoundsRef.current = mapBounds;
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // A map pan skipped its reload while offline.
  const missedReloadRef = useRef(false);
  // Opened on the saved area and the real location hasn't loaded yet.
  const pendingInitialRef = useRef<{ lat: number; lng: number } | null>(null);
  const loadErrorRef = useRef(false);
  loadErrorRef.current = loadError;
  const loadEventsWithCenterRef = useRef<
    (lat: number, lng: number) => Promise<boolean>
  >(() => Promise.resolve(false));

  const loadInitialData = async () => {
    try {
      let fetchLat = center.lat;
      let fetchLng = center.lng;
      const profileLocation =
        profile?.lat != null && profile?.lng != null
          ? { lat: profile.lat, lng: profile.lng }
          : null;
      let hasRealLocation = false;
      if (profileLocation) {
        fetchLat = profileLocation.lat;
        fetchLng = profileLocation.lng;
        hasRealLocation = true;
      } else {
        const { status } = await Location.requestForegroundPermissionsAsync();
        if (status === 'granted') {
          // A failed or slow fix (services off, no signal) falls back to the
          // default center rather than skipping the events load.
          const loc = await getPositionWithTimeout();
          if (loc) {
            fetchLat = loc.coords.latitude;
            fetchLng = loc.coords.longitude;
            hasRealLocation = true;
          }
        } else {
          // Keep userLocation null (the SF fallback is a map center, not the
          // user's location) and surface the banner instead.
          setLocationDenied(true);
        }
      }
      // Only a real location (saved profile location or GPS fix) counts as
      // "my location" for the search overlay; the SF default never does.
      if (hasRealLocation) {
        setUserLocation({ lat: fetchLat, lng: fetchLng });
      }
      if (!hasInitializedMapRef.current && lastArea) {
        // Opened on the saved area: load the real location first and only
        // move there if that worked. Otherwise the map stays on the saved
        // area, so its pins and list keep matching what's shown.
        hasInitializedMapRef.current = true;
        const loaded = await loadEventsWithCenter(fetchLat, fetchLng);
        // Retried on reconnect (effect below).
        pendingInitialRef.current = loaded ? null : { lat: fetchLat, lng: fetchLng };
        if (loaded) {
          const loc = { lat: fetchLat, lng: fetchLng };
          setCenter(loc);
          setMapCenter(loc);
          beginProgrammaticMove(1200);
          setCenterForMap(loc);
          mapRef.current?.animateTo(loc.lat, loc.lng);
        }
      } else if (!hasInitializedMapRef.current) {
        const loc = { lat: fetchLat, lng: fetchLng };
        setCenter(loc);
        setMapCenter(loc);
        beginProgrammaticMove(1200);
        setCenterForMap(loc);
        hasInitializedMapRef.current = true;
        await loadEventsWithCenter(fetchLat, fetchLng);
      } else if (
        profileLocation &&
        center.lat === DEFAULT_CENTER.lat &&
        center.lng === DEFAULT_CENTER.lng
      ) {
        setCenter(profileLocation);
        setMapCenter(profileLocation);
        beginProgrammaticMove(1200);
        setCenterForMap(profileLocation);
        mapRef.current?.animateTo(profileLocation.lat, profileLocation.lng);
        await loadEventsWithCenter(profileLocation.lat, profileLocation.lng);
      }
    } catch (err) {
      console.error('Failed to load initial data:', err);
    } finally {
      setLoading(false);
    }
  };

  // Paging state: offset counts raw fetched rows (date filtering happens
  // client-side, so the displayed list can be shorter than the offset).
  const fetchOffsetRef = useRef(0);
  // Mirrors `events` so async pagination can de-dupe without stale closures.
  const eventsRef = useRef<RankedEvent[]>([]);
  useEffect(() => {
    eventsRef.current = events;
  }, [events]);
  const loadRequestIdRef = useRef(0);
  const loadingMoreRef = useRef(false);

  /**
   * Filters that haven't been committed to state yet. The overlay search sets
   * keyword + dates and loads in the same tick; without passing them through,
   * the load would read the pre-search values from this render's closure.
   */
  type FilterOverride = { searchQuery?: string; dateRange?: SearchDateRange | null };
  const rangeFor = (override?: FilterOverride) =>
    override && 'dateRange' in override ? (override.dateRange ?? null) : dateRange;

  const currentFilters = (override?: FilterOverride) => {
    const range = rangeFor(override);
    return {
      // Read through a ref: pagination and debounced region loads call this from
      // closures that may hold a stale `mapBounds` render value.
      radiusKm: radiusKmFromBounds(mapBoundsRef.current),
      searchQuery: (override?.searchQuery ?? searchQuery) || undefined,
      categories: selectedCategories.length > 0 ? selectedCategories : undefined,
      startDate: range?.start ?? null,
      endDate: range?.end ?? null,
    };
  };

  const applyDateFilter = (data: RankedEvent[], range: SearchDateRange | null = dateRange) =>
    range != null ? filterEventsByDateRange(data, range.start, range.end) : data;

  // First page: resets paging. Any filter or region change routes through
  // here, so paging always restarts from offset 0 for the new query.
  /** First page for a centre; resolves true when it loaded (and is current). */
  const loadEventsWithCenter = async (lat: number, lng: number, override?: FilterOverride): Promise<boolean> => {
    const requestId = ++loadRequestIdRef.current;
    try {
      setLoading(true);
      const filters = currentFilters(override);
      const { items, hasMore } = await eventsService.getRankedEventsPage(
        lat,
        lng,
        filters,
        { limit: EVENTS_PAGE_SIZE, offset: 0 }
      );
      if (requestId !== loadRequestIdRef.current) return false;
      fetchOffsetRef.current = items.length;
      setHasMoreEvents(hasMore);
      setEvents(applyDateFilter(items, rangeFor(override)));
      setEventsUpdatedAt(Date.now());
      setLoadError(false);
      if (isUnfiltered(filters)) {
        queryClient.setQueryData(queryKeys.discoverLastArea(), makeDiscoverSnapshot(lat, lng, items, hasMore));
      }
      return true;
    } catch (err) {
      console.error('Failed to load events:', err);
      if (requestId === loadRequestIdRef.current) {
        setLoadError(true);
        // With stale events still on screen the ErrorState (empty-list only)
        // never shows, so surface the failure explicitly.
        if (eventsRef.current.length > 0) notify.backgroundError("Couldn't refresh events.");
      }
    } finally {
      if (requestId === loadRequestIdRef.current) setLoading(false);
    }
    return false;
  };
  loadEventsWithCenterRef.current = loadEventsWithCenter;

  // Next page, appended on list end. De-duped by id (page boundaries can
  // shift if RSVPs change the premium/distance ordering between fetches).
  // If a page nets zero new items (all duplicates / date-filtered out) the
  // list size doesn't change, so onEndReached never re-fires; auto-fetch the
  // next page, capped at MAX_CONSECUTIVE_EMPTY_PAGES so we can't loop forever.
  const MAX_CONSECUTIVE_EMPTY_PAGES = 5;
  const loadMoreEvents = async (consecutiveEmptyPages = 0) => {
    if (loading || loadingMoreRef.current || !hasMoreEvents) return;
    const requestId = loadRequestIdRef.current;
    loadingMoreRef.current = true;
    setLoadingMore(true);
    let shouldChain = false;
    try {
      const { items, hasMore } = await eventsService.getRankedEventsPage(
        center.lat,
        center.lng,
        currentFilters(),
        { limit: EVENTS_PAGE_SIZE, offset: fetchOffsetRef.current }
      );
      // A filter/region change superseded this page; drop it.
      if (requestId !== loadRequestIdRef.current) return;
      fetchOffsetRef.current += items.length;
      setHasMoreEvents(hasMore);
      const filtered = applyDateFilter(items);
      const seen = new Set(eventsRef.current.map((e) => e.id));
      const fresh = filtered.filter((e) => !seen.has(e.id));
      if (fresh.length > 0) {
        setEvents((prev) => {
          const prevIds = new Set(prev.map((e) => e.id));
          const toAdd = fresh.filter((e) => !prevIds.has(e.id));
          return toAdd.length > 0 ? [...prev, ...toAdd] : prev;
        });
      }
      shouldChain =
        hasMore &&
        fresh.length === 0 &&
        consecutiveEmptyPages + 1 < MAX_CONSECUTIVE_EMPTY_PAGES;
    } catch (err) {
      console.error('Failed to load more events:', err);
    } finally {
      loadingMoreRef.current = false;
      setLoadingMore(false);
    }
    if (shouldChain && requestId === loadRequestIdRef.current) {
      void loadMoreEvents(consecutiveEmptyPages + 1);
    }
  };

  // Pull-to-refresh on the bottom-sheet list: re-run the first page for the
  // current center/filters (@gorhom/bottom-sheet v5 scrollables support the
  // refreshing/onRefresh pair natively).
  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    void refetchCategories();
    try {
      const target = mapCenterRef.current;
      await loadEventsWithCenterRef.current(target.lat, target.lng);
    } finally {
      setRefreshing(false);
    }
  }, [refetchCategories]);

  // Clear the location banner once the user grants permission in Settings:
  // re-check on every focus, and recenter on their real position when granted.
  useFocusEffect(
    useCallback(() => {
      if (!locationDenied) return;
      let cancelled = false;
      (async () => {
        try {
          const { status } = await Location.getForegroundPermissionsAsync();
          if (cancelled || status !== 'granted') return;
          // Fetch the position BEFORE touching state: setLocationDenied(false)
          // changes a dep of this callback, which re-runs the effect and flips
          // `cancelled` — aborting this very fetch and never recentering.
          const loc = await Location.getCurrentPositionAsync({});
          if (cancelled) return;
          const target = { lat: loc.coords.latitude, lng: loc.coords.longitude };
          setLocationDenied(false);
          setLocationBannerDismissed(false);
          setUserLocation(target);
          beginProgrammaticMove(1200);
          setCenter(target);
          setMapCenter(target);
          setCenterForMap(target);
          mapRef.current?.animateTo(target.lat, target.lng);
          void loadEventsWithCenterRef.current(target.lat, target.lng);
        } catch {
          // Permission check/position fetch failed; banner stays until next focus.
        }
      })();
      return () => {
        cancelled = true;
      };
    }, [locationDenied, beginProgrammaticMove])
  );

  const toggleCategory = (categoryId: string) => {
    setSelectedCategories((prev) =>
      prev.includes(categoryId)
        ? prev.filter((id) => id !== categoryId)
        : [...prev, categoryId]
    );
  };

  const clearFilters = () => {
    setSelectedCategories([]);
    setSearchQuery('');
    setDateRange(null);
  };

  const handleSearchFromOverlay = useCallback(
    (
      location: { lat: number; lng: number; label: string } | null,
      keyword: string,
      range: SearchDateRange | null
    ) => {
      setSearchQuery(keyword);
      setDateRange(range);
      // Claim this filter combination so the effect above doesn't fire a
      // second request for the same state.
      lastFilterSignatureRef.current = JSON.stringify({
        q: keyword,
        c: [...selectedCategories].sort(),
        d: range ? [range.start.getTime(), range.end.getTime()] : null,
      });
      const target = location ?? userLocation ?? { lat: DEFAULT_CENTER.lat, lng: DEFAULT_CENTER.lng };
      beginProgrammaticMove(1200);
      setCenter(target);
      setMapCenter(target);
      setCenterForMap(target);
      mapRef.current?.animateTo(target.lat, target.lng);
      // Pass the new keyword/dates explicitly: this closure still holds the
      // pre-search state, and the signature claim above means the filter
      // effect won't issue a corrective fetch.
      loadEventsWithCenter(target.lat, target.lng, { searchQuery: keyword, dateRange: range });
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [userLocation, beginProgrammaticMove, selectedCategories, setDateRange]
  );

  const handleRegionChange = useCallback(
    (region: {
      lat: number;
      lng: number;
      bounds?: { ne: { lat: number; lng: number }; sw: { lat: number; lng: number } };
    }) => {
      setMapCenter({ lat: region.lat, lng: region.lng });
      if (region.bounds) {
        // Keep the ref in sync immediately so the debounced reload below (and
        // pagination) computes the radius from the freshest viewport.
        mapBoundsRef.current = region.bounds;
        setMapBounds(region.bounds);
      }

      if (!hasInitializedMapRef.current) return;
      if (isProgrammaticMoveRef.current) return;

      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }
      debounceTimerRef.current = setTimeout(() => {
        debounceTimerRef.current = null;
        if (isProgrammaticMoveRef.current) return;
        // The user picked an area; don't jump to their location on reconnect.
        pendingInitialRef.current = null;
        setCenter({ lat: region.lat, lng: region.lng });
        // Offline, a pan can't load anything: keep the current list and pins
        // and catch up once the connection returns (effect below).
        if (getConnectivity() === 'offline') {
          missedReloadRef.current = true;
          return;
        }
        loadEventsWithCenterRef.current(region.lat, region.lng);
      }, REGION_DEBOUNCE_MS);
    },
    []
  );

  // Back from offline (or out of a weak connection): if Discover opened on the
  // saved area and couldn't load the real location, try that again and move
  // there; otherwise reload the area the map shows now if a pan was skipped,
  // the last load failed, or nothing is listed.
  useEffect(() => {
    let previous = getConnectivity();
    return subscribeConnectivity((status) => {
      const wasImpaired = previous !== 'online';
      previous = status;
      if (!wasImpaired || status !== 'online' || !hasInitializedMapRef.current) return;
      const pending = pendingInitialRef.current;
      if (pending) {
        void loadEventsWithCenterRef.current(pending.lat, pending.lng).then((loaded) => {
          if (!loaded || pendingInitialRef.current !== pending) return;
          pendingInitialRef.current = null;
          setCenter(pending);
          setMapCenter(pending);
          beginProgrammaticMove(1200);
          setCenterForMap(pending);
          mapRef.current?.animateTo(pending.lat, pending.lng);
        });
        return;
      }
      if (!missedReloadRef.current && !loadErrorRef.current && eventsRef.current.length > 0) return;
      missedReloadRef.current = false;
      const target = mapCenterRef.current;
      void loadEventsWithCenterRef.current(target.lat, target.lng);
    });
  }, [beginProgrammaticMove]);

  // Mounted before the device cache finished restoring, and the first load
  // then failed with nothing listed: fall back to the saved area (moving the
  // map there so pins and list match) and retry the real location on
  // reconnect.
  const isRestoring = useIsRestoring();
  useEffect(() => {
    if (isRestoring || !loadError || eventsRef.current.length > 0) return;
    const area = readLastArea(queryClient);
    if (!area) return;
    pendingInitialRef.current = mapCenterRef.current;
    fetchOffsetRef.current = area.items.length;
    setEvents(area.items);
    setHasMoreEvents(area.hasMore);
    setEventsUpdatedAt(area.updatedAt);
    setCenter(area.center);
    setMapCenter(area.center);
    beginProgrammaticMove(1200);
    setCenterForMap(area.center);
    mapRef.current?.animateTo(area.center.lat, area.center.lng);
  }, [isRestoring, loadError, queryClient, beginProgrammaticMove]);

  const visibleEvents = useMemo(() => {
    if (!mapBounds) return events;
    return events.filter((e) => isInBounds(e.lat, e.lng, mapBounds));
  }, [events, mapBounds]);

  /**
   * Events we fetched for this area that fall outside the current viewport.
   * The list is bounds-filtered but the map is not (markers are injected from
   * the full set so a small pan doesn't rebuild the cluster group), so the
   * list can read "nothing here" while pins sit just off-screen. Rather than
   * dropping those markers — which would hide results the user could pan to —
   * the empty state says how many there are and offers to fit them.
   */
  const offscreenEvents = useMemo(() => {
    if (!mapBounds) return [];
    return events.filter((e) => !isInBounds(e.lat, e.lng, mapBounds));
  }, [events, mapBounds]);

  const showOffscreenEvents = useCallback(() => {
    const points = offscreenEvents.map((e) => ({ lat: e.lat, lng: e.lng }));
    const target = centroidOf(points);
    if (!target) return;
    beginProgrammaticMove(1200);
    setCenter(target);
    setMapCenter(target);
    setCenterForMap(target);
    mapRef.current?.animateTo(target.lat, target.lng, zoomForPoints(points));
  }, [offscreenEvents, beginProgrammaticMove]);

  // Looked up in the full fetched set, not the bounds-filtered list: a pin
  // can be tapped at the viewport edge (or while mapBounds is a step behind
  // an animated move) and still needs its preview.
  const activeEvent = useMemo(
    () => (activeMarkerId ? events.find((e) => e.id === activeMarkerId) ?? null : null),
    [activeMarkerId, events]
  );

  // The sheet is closed imperatively on marker press; if the preview
  // disappears for any reason other than the user dismissing it (the event
  // dropped out of a reloaded page), restore the sheet so the screen never
  // ends up as map-only with no way back.
  useEffect(() => {
    if (showFloatingCard && !activeEvent) {
      setShowFloatingCard(false);
      setActiveMarkerId(null);
      bottomSheetRef.current?.snapToIndex(0);
    }
  }, [showFloatingCard, activeEvent]);

  const handleMarkerPress = useCallback(
    (eventId: string) => {
      setActiveMarkerId(eventId);
      setShowFloatingCard(true);
      // Slide the list out of the way; its scroll position is preserved
      // because the sheet stays mounted.
      bottomSheetRef.current?.close();
      beginProgrammaticMove(1000);
    },
    [beginProgrammaticMove]
  );

  const dismissFloatingCard = useCallback(() => {
    setActiveMarkerId(null);
    setShowFloatingCard(false);
    bottomSheetRef.current?.snapToIndex(0);
  }, []);

  const viewabilityCallbackRef = useRef<
    (info: { viewableItems: Array<{ item: RankedEvent; index: number | null }> }) => void
  >(() => {});

  useEffect(() => {
    viewabilityCallbackRef.current = ({ viewableItems }) => {
      if (isScrollingFromMapRef.current || viewableItems.length === 0) return;
      const first = viewableItems[0];
      if (first?.index != null && first.index !== lastViewedIndexRef.current) {
        lastViewedIndexRef.current = first.index;
        const event = first.item;
        setActiveMarkerId(event.id);
        setShowFloatingCard(false);
        beginProgrammaticMove(800);
        mapRef.current?.animateTo(event.lat, event.lng);
      }
    };
  }, [beginProgrammaticMove]);

  const handleViewableItemsChanged = useRef(
    (info: { viewableItems: Array<{ item: RankedEvent; index: number | null }> }) => {
      viewabilityCallbackRef.current(info);
    }
  ).current;

  const viewabilityConfig = useRef({
    itemVisiblePercentThreshold: 50,
  }).current;

  // Next upcoming occurrence per recurring event, so cards date-badge the next
  // date in the series instead of the original (possibly long-past) start.
  // Display-only: filtering/sorting still uses the raw start_datetime.
  // Memoized per events array so the FlatList re-renders don't re-walk days.
  const nextOccurrenceById = useMemo(() => {
    const map = new Map<string, string>();
    for (const event of events) {
      if (!event.is_recurring || !event.recurrence_pattern) continue;
      const [next] = getNextOccurrences(event, 1);
      if (next) map.set(event.id, next.toISOString());
    }
    return map;
  }, [events]);

  const activeFilterCount =
    selectedCategories.length + (searchQuery.length > 0 ? 1 : 0) + (dateRange != null ? 1 : 0);

  /**
   * Date filtering used to live only inside the search overlay's "when" step,
   * which is reachable only after choosing a destination — so "what's on
   * tonight" had no discoverable path. These presets back both the Filters
   * sheet and the header chip.
   */
  const activeDatePreset = useMemo<DatePresetKey>(() => matchDatePreset(dateRange), [dateRange]);

  const applyDatePreset = useCallback(
    (key: DatePresetKey) => {
      const preset = DATE_PRESETS.find((p) => p.key === key);
      setDateRange(preset ? preset.build() : null);
    },
    [setDateRange]
  );

  const headerHeight = useMemo(
    () => HEADER_HEIGHT_PX,
    []
  );

  const snapPoints = useMemo(
    () => [
      // Tall enough at rest for the sheet title/count to peek above the tab bar.
      windowHeight * SHEET_PEEK_RATIO,
      windowHeight - headerHeight,
    ],
    [headerHeight, windowHeight]
  );

  const mapMarkers = useMemo(
    () =>
      events.map((e) => ({
        id: e.id,
        lat: e.lat,
        lng: e.lng,
        title: e.title,
        categorySlug: e.category_slug,
        coverImageUrl: e.cover_image_url,
        businessLogoUrl: e.business_logo_url,
        businessName: e.business_name,
      })),
    [events]
  );

  const openEvent = useCallback((eventId: string) => {
    router.push(`/event/${eventId}` as never);
  }, []);
  const openBusiness = useCallback((businessId: string) => {
    router.push(`/business/${businessId}` as never);
  }, []);

  // Memoised card + stable callbacks: a map pan updates mapCenter/mapBounds
  // on every moveend, which used to re-render every mounted card.
  const renderEventCard = useCallback(
    ({ item, index }: { item: RankedEvent; index: number }) => (
      <DiscoverEventCard
        item={item}
        index={index}
        width={eventCardWidth}
        displayDate={nextOccurrenceById.get(item.id) ?? item.start_datetime}
        onPress={openEvent}
        onBusinessPress={openBusiness}
      />
    ),
    [nextOccurrenceById, openEvent, openBusiness, eventCardWidth]
  );

  const eventCountLabel = loading
    ? 'Finding events near you...'
    : visibleEvents.length > 100
      ? '100+ events'
      : `${visibleEvents.length} event${visibleEvents.length !== 1 ? 's' : ''}`;

  // A stable element, not an inline render function: FlatList treats a new
  // function identity as a new component type and remounts the whole header —
  // every pan rebuilt the banner carousel (losing its failed-image state).
  // Outside the memo: the note reads the clock ("Updated 5 min ago"), so it
  // must refresh on every render like it did before the header was memoized.
  const freshnessText = freshnessNote({
    hasData: events.length > 0,
    dataUpdatedAt: eventsUpdatedAt,
    isError: loadError,
    connectivity,
  });
  const listHeader = useMemo(
    () => (
    <View style={styles.sheetHeader}>
      <View style={styles.sheetHeaderRow}>
        <View>
          <Text style={styles.sheetEyebrow}>Happening Nearby</Text>
          <Text style={styles.sheetTitle}>Discover</Text>
        </View>
        <TouchableOpacity
          onPress={() => bottomSheetRef.current?.snapToIndex(1)}
          activeOpacity={0.8}
          hitSlop={{ top: 12, bottom: 12, left: 16, right: 16 }}
          accessibilityRole="button"
          accessibilityLabel="Expand the event list"
        >
          <Text style={styles.seeAllText}>See all</Text>
        </TouchableOpacity>
      </View>
      {banners.length > 0 ? <AppBannerCarousel banners={banners} /> : null}
      <Text style={styles.sheetSummary}>{eventCountLabel}</Text>
      <FreshnessNote text={freshnessText} />
    </View>
    ),
    [banners, eventCountLabel, freshnessText]
  );

  return (
    <View style={styles.container}>
      <View style={styles.mapWrapper}>
        <GoogleMapView
          ref={mapRef}
          center={centerForMap}
          zoom={12}
          markers={mapMarkers}
          activeMarkerId={activeMarkerId}
          onMarkerPress={handleMarkerPress}
          onMarkerDetailsPress={openEvent}
          onRegionChange={handleRegionChange}
          style={styles.map}
        />
      </View>

      {activeEvent && showFloatingCard && (
        <>
          <Pressable
            style={styles.floatingCardBackdrop}
            onPress={dismissFloatingCard}
            accessibilityLabel="Close event preview"
          />
          <View
            style={[styles.floatingCardWrapper, { bottom: insets.bottom + 20 }]}
            pointerEvents="box-none"
          >
            <TouchableOpacity
              style={styles.floatingCard}
              onPress={() => router.push(`/event/${activeEvent.id}` as never)}
              activeOpacity={0.9}
            >
              <View style={styles.floatingCardImageSection}>
                {activeEvent.cover_image_url ? (
                  <ExpoImage
                    source={{ uri: activeEvent.cover_image_url }}
                    style={styles.floatingCardImage}
                    contentFit="cover"
                    cachePolicy="memory-disk"
                    recyclingKey={activeEvent.id}
                    transition={150}
                  />
                ) : (
                  <View style={[styles.floatingCardImage, styles.floatingCardPlaceholder]}>
                    <Image
                      source={require('@/assets/images/EMlogo.png')}
                      style={styles.floatingCardPlaceholderLogo}
                      resizeMode="contain"
                    />
                  </View>
                )}
                <View style={styles.floatingCardActionsOverlay}>
                  <View style={styles.floatingCardBadge}>
                    <Flame size={14} color={Colors.primary} />
                    <Text style={styles.floatingCardBadgeText}>
                      {activeEvent.rsvp_count} Going
                    </Text>
                  </View>
                  <TouchableOpacity
                    style={styles.floatingCardActionBtn}
                    onPress={(e) => {
                      e.stopPropagation();
                      dismissFloatingCard();
                    }}
                    hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
                    accessibilityRole="button"
                    accessibilityLabel="Close event preview"
                  >
                    <X size={22} color={Colors.text.primary} />
                  </TouchableOpacity>
                </View>
              </View>
              <View style={styles.floatingCardWhitePanel}>
                <View style={styles.floatingCardCategoryRow}>
                  <CategoryIcon category={activeEvent.category_slug} size="sm" />
                  <Text style={styles.floatingCardTitle} numberOfLines={2}>
                    {activeEvent.title}
                  </Text>
                </View>
                <Text style={styles.floatingCardDescription} numberOfLines={1}>
                  {truncateText(activeEvent.description ?? '')}
                </Text>
              </View>
            </TouchableOpacity>
          </View>
        </>
      )}

      {/* Top app bar */}
      <View style={[styles.fixedHeader, { height: headerHeight, paddingTop: insets.top }]}>
        <View style={styles.topBar}>
          <View style={styles.topBarLeft}>
            <Image source={require('@/assets/images/EMlogo.png')} style={styles.topBarLogo} />
            <Text style={styles.brandText}>EventMap</Text>
          </View>
          <TouchableOpacity
            style={styles.searchPill}
            onPress={() => setShowSearchOverlay(true)}
            activeOpacity={0.8}
            accessibilityRole="search"
            accessibilityLabel="Search events"
          >
            <Search size={16} color={Colors.text.tertiary} />
            <Text style={styles.searchPillText} numberOfLines={1}>
              Search events
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.filterIconButton}
            onPress={() => setShowFilters(!showFilters)}
            activeOpacity={0.8}
            accessibilityRole="button"
            accessibilityLabel={
              activeFilterCount > 0
                ? `Open filters, ${activeFilterCount} active`
                : 'Open filters'
            }
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <SlidersHorizontal size={20} color={Colors.text.secondary} />
            {activeFilterCount > 0 && (
              <View style={styles.filterButtonBadge}>
                <Text style={styles.filterButtonBadgeText}>{activeFilterCount}</Text>
              </View>
            )}
          </TouchableOpacity>
        </View>

        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.chipsRow}
          style={styles.chipsScroll}
        >
          <TouchableOpacity
            style={[styles.overlayChip, activeDatePreset === 'today' && styles.overlayChipActive]}
            onPress={() => applyDatePreset(activeDatePreset === 'today' ? 'any' : 'today')}
            activeOpacity={0.85}
            hitSlop={CHIP_HIT_SLOP}
            accessibilityRole="button"
            accessibilityLabel="Only events happening today"
            accessibilityState={{ selected: activeDatePreset === 'today' }}
          >
            <Text
              style={[
                styles.overlayChipText,
                activeDatePreset === 'today' && styles.overlayChipTextActive,
              ]}
            >
              TODAY
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.overlayChip, selectedCategories.length === 0 && styles.overlayChipActive]}
            onPress={() => setSelectedCategories([])}
            activeOpacity={0.85}
            hitSlop={CHIP_HIT_SLOP}
            accessibilityRole="button"
            accessibilityLabel="Show all event categories"
            accessibilityState={{ selected: selectedCategories.length === 0 }}
          >
            <Text style={[styles.overlayChipText, selectedCategories.length === 0 && styles.overlayChipTextActive]}>
              ALL EVENTS
            </Text>
          </TouchableOpacity>
          {categories.slice(0, 8).map((category) => {
            const selected = selectedCategories.includes(category.id);
            return (
              <TouchableOpacity
                key={category.id}
                style={[styles.overlayChip, selected && styles.overlayChipActive]}
                onPress={() => toggleCategory(category.id)}
                activeOpacity={0.85}
                hitSlop={CHIP_HIT_SLOP}
                accessibilityRole="button"
                accessibilityLabel={`${category.label} filter`}
                accessibilityState={{ selected }}
              >
                <CategoryIcon category={category.slug} size="sm" variant="minimal" />
                <Text style={[styles.overlayChipText, selected && styles.overlayChipTextActive]}>
                  {category.label.toUpperCase()}
                </Text>
              </TouchableOpacity>
            );
          })}
        </ScrollView>
      </View>

      {locationDenied && !locationBannerDismissed && (
        <View style={[styles.locationBanner, { top: headerHeight + 8 }]}>
          <MapPin size={16} color={Colors.text.secondary} />
          <Text style={styles.locationBannerText} numberOfLines={2}>
            Location is off — showing San Francisco
          </Text>
          <TouchableOpacity
            style={styles.locationBannerButton}
            onPress={() => Linking.openSettings()}
            activeOpacity={0.85}
            accessibilityRole="button"
            accessibilityLabel="Enable location in settings"
            hitSlop={{ top: 10, bottom: 10, left: 6, right: 6 }}
          >
            <Text style={styles.locationBannerButtonText}>Enable</Text>
          </TouchableOpacity>
          <TouchableOpacity
            onPress={() => setLocationBannerDismissed(true)}
            hitSlop={{ top: 14, bottom: 14, left: 14, right: 14 }}
            accessibilityRole="button"
            accessibilityLabel="Dismiss location banner"
          >
            <X size={16} color={Colors.text.tertiary} />
          </TouchableOpacity>
        </View>
      )}

      <Modal
        visible={showFilters}
        animationType="slide"
        presentationStyle="fullScreen"
        onRequestClose={() => setShowFilters(false)}
      >
        <View style={[styles.filtersPage, { paddingTop: insets.top, paddingBottom: insets.bottom }]}>
          <View style={styles.filtersPageHeader}>
            <TouchableOpacity
              onPress={() => setShowFilters(false)}
              style={styles.filtersPageClose}
              hitSlop={12}
              accessibilityRole="button"
              accessibilityLabel="Close filters"
            >
              <X size={24} color={Colors.text.primary} />
            </TouchableOpacity>
            <Text style={styles.filtersPageTitle}>Filters</Text>
            {activeFilterCount > 0 ? (
              <TouchableOpacity
                onPress={clearFilters}
                accessibilityRole="button"
                accessibilityLabel="Clear all filters"
                hitSlop={{ top: 14, bottom: 14, left: 14, right: 14 }}
              >
                <Text style={styles.clearText}>Clear all</Text>
              </TouchableOpacity>
            ) : (
              <View style={styles.filtersPageClose} />
            )}
          </View>
          <ScrollView
            style={styles.filtersPageContent}
            contentContainerStyle={styles.filtersPageContentInner}
            showsVerticalScrollIndicator={false}
          >
            <Text style={styles.filtersSectionTitle}>When</Text>
            <View style={styles.datePresetRow}>
              {DATE_PRESETS.map((preset) => {
                const selected = activeDatePreset === preset.key;
                return (
                  <TouchableOpacity
                    key={preset.key}
                    style={[styles.datePresetChip, selected && styles.datePresetChipSelected]}
                    onPress={() => applyDatePreset(preset.key)}
                    activeOpacity={0.85}
                    accessibilityRole="button"
                    accessibilityState={{ selected }}
                    accessibilityLabel={preset.label}
                  >
                    <Text
                      style={[
                        styles.datePresetText,
                        selected && styles.datePresetTextSelected,
                      ]}
                    >
                      {preset.label}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>
            {dateRange ? (
              <Text style={styles.datePresetSummary}>
                {dateRange.start.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
                {' — '}
                {dateRange.end.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
                {activeDatePreset === 'custom' ? ' (from search)' : ''}
              </Text>
            ) : null}

            <Text style={[styles.filtersSectionTitle, styles.filtersSectionTitleSpaced]}>
              Categories
            </Text>
            <View style={styles.categoriesGrid}>
              {categories.map((category) => {
                const isSelected = selectedCategories.includes(category.id);
                const categoryColor = getCategoryIconColor(category.slug);
                return (
                  <TouchableOpacity
                    key={category.id}
                    style={[
                      styles.categoryChip,
                      isSelected && {
                        backgroundColor: categoryColor,
                        borderColor: categoryColor,
                      },
                    ]}
                    onPress={() => toggleCategory(category.id)}
                    accessibilityRole="button"
                    accessibilityLabel={`${category.label} category`}
                    accessibilityState={{ selected: isSelected }}
                    hitSlop={{ top: 6, bottom: 6, left: 4, right: 4 }}
                  >
                    <CategoryIcon category={category.slug} size="sm" />
                    <Text
                      style={[
                        styles.categoryChipText,
                        isSelected && styles.categoryChipTextSelected,
                      ]}
                    >
                      {category.label}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          </ScrollView>
          <View style={styles.filtersPageFooter}>
            <Button
              label="Show results"
              onPress={() => setShowFilters(false)}
              fullWidth
              accessibilityLabel="Apply filters and show results"
            />
          </View>
        </View>
      </Modal>

      <SearchOverlay
        visible={showSearchOverlay}
        onClose={() => setShowSearchOverlay(false)}
        onSearch={handleSearchFromOverlay}
        userLocation={userLocation}
        initialKeyword={searchQuery}
      />

      {loading && events.length === 0 && (
        <View style={styles.mapSearchingOverlay}>
          <ActivityIndicator size="small" color={Colors.primary} />
          <Text style={styles.mapSearchingText}>Searching...</Text>
        </View>
      )}

      {sheetIndex === 1 && (
        <View style={styles.mapDimOverlay} pointerEvents="box-only" />
      )}

      {!appLoading && hasBusiness && (
        <View
          style={[
            styles.fabWrap,
            // Sit a step above the sheet's collapsed peek (same 0.13 snap as
            // snapPoints) so the FAB never brushes the peeked header on tall
            // screens, while staying clear of the map attribution.
            { bottom: Math.max(windowHeight * SHEET_PEEK_RATIO + Spacing.md, insets.bottom + 104) },
          ]}
        >
          <TouchableOpacity
            style={styles.fab}
            activeOpacity={0.88}
            onPress={() => router.push('/(tabs)/create')}
            accessibilityRole="button"
            accessibilityLabel="Create event"
          >
            <Plus size={30} color="#FFFFFF" />
          </TouchableOpacity>
        </View>
      )}

      {/* The sheet stays mounted while a map preview is open: unmounting it
          reset the list's scroll position and replayed every card's entrance
          animation when the preview closed. It is animated closed instead. */}
      <BottomSheet
        ref={bottomSheetRef}
        index={0}
        snapPoints={snapPoints}
        topInset={headerHeight}
        enablePanDownToClose={false}
        handleIndicatorStyle={styles.handleIndicator}
        backgroundStyle={styles.sheetBackground}
        style={styles.sheetContainer}
        onChange={setSheetIndex}
      >
          <BottomSheetFlatList
            ref={flatListRef}
            data={visibleEvents}
            keyExtractor={(item: RankedEvent) => item.id}
            renderItem={renderEventCard}
            refreshing={refreshing}
            onRefresh={handleRefresh}
            ListHeaderComponent={listHeader}
            ListEmptyComponent={
            loading ? (
              <View style={styles.loadingRow}>
                <ActivityIndicator size="large" color={Colors.primary} />
                <Text style={styles.loadingText}>Loading events...</Text>
              </View>
            ) : loadError ? (
              <ErrorState
                title="Couldn't load events"
                onRetry={() => loadEventsWithCenter(center.lat, center.lng)}
              />
            ) : (
              <View style={styles.emptyState}>
                <View style={styles.emptyLogoWrap}>
                  <Image
                    source={require('@/assets/images/EMlogo.png')}
                    style={styles.emptyLogo}
                    resizeMode="contain"
                  />
                </View>
                <Text style={styles.emptyTitle}>
                  {offscreenEvents.length > 0
                    ? 'Nothing in this part of the map'
                    : searchQuery
                      ? `No results for “${searchQuery}”`
                      : 'No events nearby'}
                </Text>
                <Text style={styles.emptySubtitle}>
                  {offscreenEvents.length > 0
                    ? `${offscreenEvents.length} ${
                        offscreenEvents.length === 1 ? 'event is' : 'events are'
                      } just outside the current view.`
                    : searchQuery
                      ? 'Nothing matches in the current map area. Zoom out or clear the search.'
                      : dateRange || selectedCategories.length > 0
                        ? 'Nothing matches these filters here. Try another date or category.'
                        : 'No events in this area yet. Try moving the map.'}
                </Text>
                {offscreenEvents.length > 0 ? (
                  <TouchableOpacity
                    style={styles.clearFiltersButton}
                    onPress={showOffscreenEvents}
                    activeOpacity={0.8}
                    accessibilityRole="button"
                    accessibilityLabel={`Show the ${offscreenEvents.length} events just outside the view`}
                  >
                    <Text style={styles.clearFiltersText}>
                      Show {offscreenEvents.length === 1 ? 'it' : 'them'}
                    </Text>
                  </TouchableOpacity>
                ) : (selectedCategories.length > 0 || searchQuery.length > 0 || dateRange != null) ? (
                  <TouchableOpacity
                    style={styles.clearFiltersButton}
                    onPress={clearFilters}
                    activeOpacity={0.8}
                    accessibilityRole="button"
                    accessibilityLabel="Clear all filters"
                  >
                    <Text style={styles.clearFiltersText}>Clear filters</Text>
                  </TouchableOpacity>
                ) : null}
              </View>
            )
          }
          onEndReached={() => loadMoreEvents()}
          onEndReachedThreshold={0.5}
          ListFooterComponent={
            loadingMore ? (
              <View style={styles.loadMoreFooter}>
                <ActivityIndicator size="small" color={Colors.primary} />
              </View>
            ) : null
          }
          onViewableItemsChanged={handleViewableItemsChanged}
          viewabilityConfig={viewabilityConfig}
          contentContainerStyle={styles.listContent}
          showsVerticalScrollIndicator={false}
          onScrollToIndexFailed={(info: { index: number }) => {
            setTimeout(() => {
              flatListRef.current?.scrollToIndex({
                index: info.index,
                animated: true,
                viewPosition: 0.5,
              });
            }, 100);
          }}
        />
      </BottomSheet>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background.primary,
  },
  mapWrapper: {
    ...StyleSheet.absoluteFillObject,
  },
  map: {
    flex: 1,
  },
  mapDimOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(28,28,28,0.25)',
    pointerEvents: 'box-only',
  },
  fixedHeader: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    zIndex: 30,
    paddingHorizontal: Spacing.md,
    paddingBottom: Spacing.sm,
    justifyContent: 'flex-end',
    pointerEvents: 'box-none',
  },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: 'rgba(255,255,255,0.82)',
    borderRadius: BorderRadius.round,
    paddingHorizontal: 14,
    height: 56,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.35)',
    ...Shadows.sm,
  },
  topBarLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
  },
  topBarLogo: {
    width: 30,
    height: 30,
    borderRadius: BorderRadius.sm,
    tintColor: Colors.primary,
  },
  brandText: {
    color: Colors.primary,
    // Slightly tighter than before so the search pill fits alongside.
    fontSize: 20,
    lineHeight: 24,
    letterSpacing: -0.2,
    fontFamily: Typography.displayFontFamilies.extrabold,
    fontWeight: Typography.weights.extrabold,
  },
  searchPill: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs,
    height: 36,
    marginHorizontal: Spacing.sm,
    paddingHorizontal: Spacing.sm + Spacing.xs,
    borderRadius: BorderRadius.round,
    backgroundColor: Colors.neutralSoft,
  },
  searchPillText: {
    flex: 1,
    fontSize: Typography.sizes.sm,
    fontFamily: Typography.fontFamilies.medium,
    color: Colors.text.tertiary,
  },
  chipsScroll: {
    marginTop: Spacing.sm,
  },
  chipsRow: {
    gap: Spacing.sm,
    paddingRight: Spacing.md,
  },
  overlayChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 12,
    paddingVertical: 7,
    // ~30pt tall; CHIP_HIT_SLOP lifts the effective target past 44pt without
    // making the overlay row visually heavier over the map.
    minHeight: 30,
    borderRadius: BorderRadius.round,
    backgroundColor: 'rgba(255,255,255,0.78)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.26)',
  },
  overlayChipActive: {
    backgroundColor: Colors.primary,
    borderColor: Colors.primary,
  },
  overlayChipText: {
    fontSize: Typography.sizes.xs,
    letterSpacing: 0.2,
    color: Colors.text.primary,
    fontFamily: Typography.labelFontFamilies.semibold,
  },
  overlayChipTextActive: {
    color: '#FFFFFF',
  },
  filterIconButton: {
    width: 40,
    height: 40,
    borderRadius: BorderRadius.round,
    backgroundColor: 'rgba(255,255,255,0.7)',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.35)',
  },
  filterButtonBadge: {
    position: 'absolute',
    // Sits on the button's edge so it doesn't cover the icon.
    top: -4,
    right: -4,
    minWidth: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: Colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: Spacing.xs,
    borderWidth: 2,
    borderColor: Colors.white,
  },
  filterButtonBadgeText: {
    fontSize: 10,
    fontFamily: Typography.fontFamilies.semibold,
    fontWeight: Typography.weights.semibold,
    color: Colors.text.inverse,
  },
  datePresetRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.sm,
  },
  datePresetChip: {
    paddingHorizontal: Spacing.md,
    paddingVertical: 10,
    minHeight: 44,
    justifyContent: 'center',
    borderRadius: BorderRadius.round,
    borderWidth: 1,
    borderColor: Colors.border.light,
    backgroundColor: Colors.surface,
  },
  datePresetChipSelected: {
    borderColor: Colors.primary,
    backgroundColor: Colors.primarySoft,
  },
  datePresetText: {
    fontSize: Typography.sizes.sm,
    color: Colors.text.secondary,
    fontFamily: Typography.fontFamilies.medium,
  },
  datePresetTextSelected: {
    color: Colors.primary,
    fontFamily: Typography.fontFamilies.semibold,
  },
  datePresetSummary: {
    marginTop: Spacing.sm,
    fontSize: Typography.sizes.xs,
    color: Colors.text.tertiary,
    fontFamily: Typography.fontFamilies.regular,
  },
  filtersSectionTitleSpaced: {
    marginTop: Spacing.xl,
  },
  filtersPage: {
    flex: 1,
    backgroundColor: Colors.background.primary,
  },
  filtersPageHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border.light,
    backgroundColor: '#FFFFFF',
  },
  filtersPageTitle: {
    fontSize: Typography.sizes.lg,
    fontFamily: Typography.fontFamilies.semibold,
    fontWeight: Typography.weights.semibold,
    color: Colors.text.primary,
  },
  filtersPageClose: {
    width: 40,
    alignItems: 'flex-start',
  },
  filtersPageContent: {
    flex: 1,
  },
  filtersPageContentInner: {
    padding: Spacing.lg,
    paddingBottom: Spacing.xxl,
  },
  filtersPageFooter: {
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.md,
    paddingBottom: Spacing.sm,
    borderTopWidth: 1,
    borderTopColor: Colors.border.light,
    backgroundColor: Colors.surface,
  },
  filtersSectionTitle: {
    fontSize: Typography.sizes.sm,
    fontFamily: Typography.fontFamilies.semibold,
    fontWeight: Typography.weights.semibold,
    color: Colors.text.secondary,
    marginBottom: Spacing.md,
    textTransform: 'uppercase',
  },
  locationBanner: {
    position: 'absolute',
    left: Spacing.md,
    right: Spacing.md,
    zIndex: 25,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    backgroundColor: Colors.background.primary,
    paddingVertical: Spacing.sm,
    paddingHorizontal: Spacing.md,
    borderRadius: BorderRadius.lg,
    borderWidth: 1,
    borderColor: Colors.border.light,
    ...Shadows.md,
  },
  locationBannerText: {
    flex: 1,
    fontSize: Typography.sizes.sm,
    fontFamily: Typography.fontFamilies.medium,
    color: Colors.text.secondary,
  },
  locationBannerButton: {
    paddingVertical: Spacing.xs,
    paddingHorizontal: Spacing.md,
    borderRadius: BorderRadius.round,
    backgroundColor: Colors.primary,
  },
  locationBannerButtonText: {
    fontSize: Typography.sizes.sm,
    fontFamily: Typography.fontFamilies.semibold,
    fontWeight: Typography.weights.semibold,
    color: Colors.text.inverse,
  },
  loadMoreFooter: {
    paddingVertical: Spacing.lg,
    alignItems: 'center',
  },
  mapSearchingOverlay: {
    position: 'absolute',
    // Sit below the fixed header (which is HEADER_HEIGHT_PX tall, zIndex 30).
    top: HEADER_HEIGHT_PX + Spacing.sm,
    zIndex: 40,
    alignSelf: 'center',
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    backgroundColor: Colors.background.primary,
    paddingVertical: Spacing.sm,
    paddingHorizontal: Spacing.md,
    borderRadius: BorderRadius.lg,
    ...Shadows.md,
  },
  mapSearchingText: {
    fontSize: Typography.sizes.sm,
    fontFamily: Typography.fontFamily,
    color: Colors.text.secondary,
  },
  sheetContainer: {
    overflow: 'visible',
  },
  sheetBackground: {
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 44,
    borderTopRightRadius: 44,
    overflow: 'hidden',
    ...Platform.select({
      ios: {
        shadowColor: '#1C1C1C',
        shadowOffset: { width: 0, height: -4 },
        shadowOpacity: 0.1,
        shadowRadius: 20,
      },
      android: { elevation: 16 },
    }),
  },
  handleIndicator: {
    backgroundColor: Colors.border.medium,
    width: 48,
  },
  floatingCardBackdrop: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 99,
  },
  floatingCardWrapper: {
    position: 'absolute',
    left: 20,
    right: 20,
    zIndex: 100,
  },
  floatingCard: {
    height: 260,
    flexDirection: 'column',
    borderRadius: 20,
    overflow: 'hidden',
    backgroundColor: '#FFFFFF',
    ...Platform.select({
      ios: {
        shadowColor: '#1C1C1C',
        shadowOffset: { width: 0, height: 12 },
        shadowOpacity: 0.3,
        shadowRadius: 24,
      },
      android: { elevation: 20 },
    }),
  },
  floatingCardImageSection: {
    flex: 7,
    position: 'relative',
    overflow: 'hidden',
  },
  floatingCardImage: {
    ...StyleSheet.absoluteFillObject,
    width: '100%',
    height: '100%',
  },
  floatingCardPlaceholder: {
    backgroundColor: Colors.background.tertiary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  floatingCardPlaceholderLogo: {
    width: 64,
    height: 64,
    opacity: 0.5,
  },
  floatingCardActionsOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: Spacing.md,
  },
  floatingCardBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs,
    backgroundColor: 'rgba(255,255,255,0.95)',
    paddingVertical: Spacing.xs,
    paddingHorizontal: Spacing.sm,
    borderRadius: BorderRadius.round,
  },
  floatingCardBadgeText: {
    fontSize: Typography.sizes.sm,
    fontFamily: Typography.fontFamilies.medium,
    fontWeight: Typography.weights.medium,
    color: Colors.text.primary,
  },
  floatingCardActionBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.95)',
  },
  floatingCardWhitePanel: {
    flex: 3,
    backgroundColor: '#FFFFFF',
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.md,
    borderBottomLeftRadius: 20,
    borderBottomRightRadius: 20,
  },
  floatingCardCategoryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    marginBottom: Spacing.xs,
  },
  floatingCardTitle: {
    fontSize: Typography.sizes.lg,
    fontFamily: Typography.fontFamilies.bold,
    fontWeight: Typography.weights.bold,
    color: Colors.text.primary,
    marginBottom: Spacing.xs,
  },
  floatingCardDescription: {
    fontSize: Typography.sizes.sm,
    fontFamily: Typography.fontFamily,
    color: Colors.text.secondary,
  },
  sheetHeader: {
    width: '100%',
    alignSelf: 'stretch',
    paddingHorizontal: 24,
    paddingBottom: 14,
  },
  sheetHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 10,
  },
  sheetEyebrow: {
    color: Colors.primary,
    textTransform: 'uppercase',
    letterSpacing: 3,
    fontSize: Typography.sizes.xxs,
    fontFamily: Typography.labelFontFamilies.semibold,
    marginBottom: 4,
  },
  sheetTitle: {
    color: Colors.text.primary,
    fontSize: 32,
    lineHeight: 38,
    letterSpacing: -0.5,
    fontFamily: Typography.displayFontFamilies.extrabold,
    fontWeight: Typography.weights.extrabold,
  },
  seeAllText: {
    color: Colors.primary,
    fontSize: 16,
    fontFamily: Typography.fontFamilies.bold,
    fontWeight: Typography.weights.bold,
  },
  sheetSummary: {
    fontSize: 12,
    fontFamily: Typography.labelFontFamilies.semibold,
    color: Colors.text.tertiary,
    marginTop: 8,
    marginBottom: 10,
  },
  listContent: {
    paddingHorizontal: 24,
    paddingBottom: Spacing.xxl * 2,
  },
  clearText: {
    fontSize: Typography.sizes.sm,
    fontFamily: Typography.fontFamily,
    color: Colors.primary,
  },
  categoriesGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.sm,
  },
  categoryChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    borderRadius: BorderRadius.lg,
    backgroundColor: Colors.background.secondary,
    borderWidth: 1,
    borderColor: Colors.border.light,
  },
  categoryChipText: {
    fontSize: Typography.sizes.sm,
    fontFamily: Typography.fontFamily,
    color: Colors.text.primary,
  },
  categoryChipTextSelected: {
    color: Colors.text.inverse,
    fontFamily: Typography.fontFamilies.medium,
    fontWeight: Typography.weights.medium,
  },
  loadingRow: {
    paddingVertical: Spacing.xxl,
    alignItems: 'center',
  },
  loadingText: {
    marginTop: Spacing.md,
    fontSize: Typography.sizes.md,
    fontFamily: Typography.fontFamily,
    color: Colors.text.secondary,
  },
  emptyState: {
    alignItems: 'center',
    paddingVertical: Spacing.xxl,
  },
  emptyLogoWrap: {
    width: 80,
    height: 80,
    borderRadius: 24,
    backgroundColor: Colors.primarySoft,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: Spacing.md,
  },
  emptyLogo: {
    width: 48,
    height: 48,
  },
  emptyTitle: {
    fontSize: Typography.sizes.lg,
    fontFamily: Typography.displayFontFamilies.semibold,
    fontWeight: Typography.weights.semibold,
    color: Colors.text.primary,
  },
  emptySubtitle: {
    fontSize: Typography.sizes.sm,
    fontFamily: Typography.fontFamily,
    color: Colors.text.secondary,
    marginTop: Spacing.xs,
    maxWidth: 300,
    textAlign: 'center',
  },
  clearFiltersButton: {
    marginTop: Spacing.lg,
    paddingVertical: Spacing.md,
    paddingHorizontal: Spacing.xl,
    backgroundColor: Colors.primary,
    borderRadius: BorderRadius.lg,
  },
  clearFiltersText: {
    fontSize: Typography.sizes.sm,
    fontFamily: Typography.fontFamilies.medium,
    fontWeight: Typography.weights.medium,
    color: Colors.text.inverse,
  },
  fabWrap: {
    position: 'absolute',
    right: 24,
    zIndex: 60,
  },
  fab: {
    width: 64,
    height: 64,
    borderRadius: BorderRadius.round,
    backgroundColor: Colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: Colors.primary,
    shadowOffset: { width: 0, height: 14 },
    shadowOpacity: 0.28,
    shadowRadius: 20,
    elevation: 8,
  },
});
