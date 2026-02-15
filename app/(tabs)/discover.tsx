import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  TextInput,
  Dimensions,
  Platform,
} from 'react-native';
import { router } from 'expo-router';
import * as Location from 'expo-location';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import BottomSheet, { BottomSheetFlatList } from '@gorhom/bottom-sheet';
import { useAuth } from '@/contexts/AuthContext';
import { useSearch } from '@/contexts/SearchContext';
import { eventsService } from '@/services/events';
import { categoriesService } from '@/services/categories';
import { RankedEvent, Category } from '@/types/database';
import { Colors, Spacing, Typography, BorderRadius, Shadows } from '@/constants/theme';
import { getCategoryColor } from '@/constants/categories';
import { Search, MapPin, Calendar, Users, Filter, GripHorizontal, List, Repeat } from 'lucide-react-native';
import { GoogleMapView, type GoogleMapHandle } from '@/components/GoogleMapView';
import { EventCardCarousel } from '@/components/EventCardCarousel';
import { SearchOverlay, SearchBarCollapsed } from '@/components/SearchOverlay';
import { filterEventsByDateRange } from '@/utils/recurrence';

const { height: SCREEN_HEIGHT } = Dimensions.get('window');
const DEFAULT_CENTER = { lat: 37.7749, lng: -122.4194 };
const SNAP_POINTS = ['12%', '50%', '95%'];
const REGION_DEBOUNCE_MS = 500;

export default function DiscoverScreen() {
  const insets = useSafeAreaInsets();
  const { profile } = useAuth();
  const { location: searchLocation, dateRange } = useSearch();
  const [events, setEvents] = useState<RankedEvent[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategories, setSelectedCategories] = useState<string[]>([]);
  const [showFilters, setShowFilters] = useState(false);
  const [showSearchOverlay, setShowSearchOverlay] = useState(false);
  const [center, setCenter] = useState(DEFAULT_CENTER);
  const [mapCenter, setMapCenter] = useState(DEFAULT_CENTER);
  const [mapBounds, setMapBounds] = useState<{
    ne: { lat: number; lng: number };
    sw: { lat: number; lng: number };
  } | null>(null);
  const [explicitMoveTrigger, setExplicitMoveTrigger] = useState(0);
  const [sheetIndex, setSheetIndex] = useState(0);
  const [activeMarkerId, setActiveMarkerId] = useState<string | null>(null);
  const [userLocation, setUserLocation] = useState<{ lat: number; lng: number } | null>(null);

  const bottomSheetRef = useRef<BottomSheet>(null);
  const mapRef = useRef<GoogleMapHandle>(null);
  const flatListRef = useRef<any>(null);
  const isScrollingFromMapRef = useRef(false);
  const lastViewedIndexRef = useRef<number>(0);
  const hasInitializedMapRef = useRef(false);

  // ─── NEW: guard flag to suppress region-change reloads during
  //          programmatic map moves (marker tap, list scroll, etc.) ───
  const isProgrammaticMoveRef = useRef(false);
  const programmaticMoveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  /** Call this before any programmatic animateTo / center change so that
   *  the subsequent onRegionChange events are ignored. */
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

  useEffect(() => {
    loadEventsWithCenter(center.lat, center.lng);
  }, [searchQuery, selectedCategories, dateRange]);

  const mapCenterRef = useRef(mapCenter);
  mapCenterRef.current = mapCenter;
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const loadEventsWithCenterRef = useRef<
    (lat: number, lng: number) => Promise<void>
  >(() => Promise.resolve());

  const loadInitialData = async () => {
    try {
      const categoriesData = await categoriesService.getAllCategories();
      setCategories(categoriesData);
      let fetchLat = center.lat;
      let fetchLng = center.lng;
      const profileLocation =
        profile?.lat != null && profile?.lng != null
          ? { lat: profile.lat, lng: profile.lng }
          : null;
      if (profileLocation) {
        fetchLat = profileLocation.lat;
        fetchLng = profileLocation.lng;
      } else {
        const { status } = await Location.requestForegroundPermissionsAsync();
        if (status === 'granted') {
          const loc = await Location.getCurrentPositionAsync({});
          fetchLat = loc.coords.latitude;
          fetchLng = loc.coords.longitude;
        }
      }
      setUserLocation({ lat: fetchLat, lng: fetchLng });
      if (!hasInitializedMapRef.current) {
        const loc = { lat: fetchLat, lng: fetchLng };
        setCenter(loc);
        setMapCenter(loc);
        beginProgrammaticMove(1200); // suppress region-change during init
        setExplicitMoveTrigger((t) => t + 1);
        hasInitializedMapRef.current = true;
        await loadEventsWithCenter(fetchLat, fetchLng);
      }
    } catch (err) {
      console.error('Failed to load initial data:', err);
    } finally {
      setLoading(false);
    }
  };

  const loadEventsWithCenter = async (lat: number, lng: number) => {
    try {
      setLoading(true);
      const data = await eventsService.getRankedEvents(lat, lng, {
        radiusKm: 50,
        searchQuery: searchQuery || undefined,
        categories: selectedCategories.length > 0 ? selectedCategories : undefined,
        startDate: dateRange?.start ?? null,
        endDate: dateRange?.end ?? null,
      });
      const filtered =
        dateRange != null
          ? filterEventsByDateRange(data, dateRange.start, dateRange.end)
          : data;
      setEvents(filtered);
    } catch (err) {
      console.error('Failed to load events:', err);
    } finally {
      setLoading(false);
    }
  };
  loadEventsWithCenterRef.current = loadEventsWithCenter;

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
  };

  const handleSearchFromOverlay = useCallback(
    (location: { lat: number; lng: number; label: string } | null) => {
      const target = location ?? userLocation ?? { lat: DEFAULT_CENTER.lat, lng: DEFAULT_CENTER.lng };
      beginProgrammaticMove(1200);
      setCenter(target);
      setMapCenter(target);
      setExplicitMoveTrigger((t) => t + 1);
      mapRef.current?.animateTo(target.lat, target.lng);
      loadEventsWithCenter(target.lat, target.lng);
    },
    [userLocation, beginProgrammaticMove]
  );

  // ─── FIX: ignore region changes that result from programmatic moves ───
  const handleRegionChange = useCallback(
    (region: {
      lat: number;
      lng: number;
      bounds?: { ne: { lat: number; lng: number }; sw: { lat: number; lng: number } };
    }) => {
      // Always keep bounds up-to-date (cheap, no flicker)
      setMapCenter({ lat: region.lat, lng: region.lng });
      if (region.bounds) setMapBounds(region.bounds);

      // Skip reload when the map was moved programmatically or hasn't initialized
      if (!hasInitializedMapRef.current) return;
      if (isProgrammaticMoveRef.current) return;

      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }
      debounceTimerRef.current = setTimeout(() => {
        debounceTimerRef.current = null;
        // Double-check the flag again after debounce
        if (isProgrammaticMoveRef.current) return;
        setCenter({ lat: region.lat, lng: region.lng });
        loadEventsWithCenterRef.current(region.lat, region.lng);
      }, REGION_DEBOUNCE_MS);
    },
    [/* stable – no deps needed */]
  );

  const isInBounds = (
    lat: number,
    lng: number,
    bounds: { ne: { lat: number; lng: number }; sw: { lat: number; lng: number } }
  ) =>
    lat >= bounds.sw.lat &&
    lat <= bounds.ne.lat &&
    lng >= bounds.sw.lng &&
    lng <= bounds.ne.lng;

  const visibleEvents = useMemo(() => {
    if (!mapBounds) return events;
    return events.filter((e) => isInBounds(e.lat, e.lng, mapBounds));
  }, [events, mapBounds]);

  // ─── FIX: set programmatic-move guard before animating ───
  const handleMarkerPress = useCallback(
    (eventId: string) => {
      setActiveMarkerId(eventId);
      const index = visibleEvents.findIndex((e) => e.id === eventId);
      if (index >= 0) {
        isScrollingFromMapRef.current = true;
        beginProgrammaticMove(1000);
        bottomSheetRef.current?.snapToIndex(1);
        setTimeout(() => {
          flatListRef.current?.scrollToIndex({
            index,
            animated: true,
            viewPosition: 0.5,
          });
        }, 350);
        setTimeout(() => {
          isScrollingFromMapRef.current = false;
        }, 800);
      }
    },
    [visibleEvents, beginProgrammaticMove]
  );

  // ─── Stable ref-based viewability handler (FlatList forbids changing this on the fly) ───
  const viewabilityCallbackRef = useRef<
    (info: { viewableItems: Array<{ item: RankedEvent; index: number | null }> }) => void
  >(() => {});

  // Keep the ref updated with latest logic + dependencies
  useEffect(() => {
    viewabilityCallbackRef.current = ({ viewableItems }) => {
      if (isScrollingFromMapRef.current || viewableItems.length === 0) return;
      const first = viewableItems[0];
      if (first?.index != null && first.index !== lastViewedIndexRef.current) {
        lastViewedIndexRef.current = first.index;
        const event = first.item;
        setActiveMarkerId(event.id);
        beginProgrammaticMove(800);
        mapRef.current?.animateTo(event.lat, event.lng);
      }
    };
  }, [beginProgrammaticMove]);

  // Stable handler that never changes identity — just delegates to the ref
  const handleViewableItemsChanged = useRef(
    (info: { viewableItems: Array<{ item: RankedEvent; index: number | null }> }) => {
      viewabilityCallbackRef.current(info);
    }
  ).current;

  const viewabilityConfig = useRef({
    itemVisiblePercentThreshold: 50,
  }).current;

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    });
  };

  // ─── FIX: decouple centerForMap from markerIdsKey so new event data
  //          doesn't force a map re-center ───
  const centerForMap = useMemo(
    () => mapCenter,
    [explicitMoveTrigger]            // ← removed markerIdsKey
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
      })),
    [events]
  );

  const renderEventCard = ({ item }: { item: RankedEvent }) => (
    <TouchableOpacity
      style={styles.eventCard}
      onPress={() => router.push(`/event/${item.id}` as never)}
      activeOpacity={0.8}
    >
      <EventCardCarousel
        imageUrls={item.cover_image_url ? [item.cover_image_url] : []}
      />
      <View style={styles.eventContent}>
        <View style={styles.eventHeader}>
          <Text style={styles.eventTitle} numberOfLines={2}>
            {item.title}
          </Text>
          {item.is_premium && (
            <View style={styles.premiumBadge}>
              <Text style={styles.premiumText}>★</Text>
            </View>
          )}
        </View>
        <View style={styles.eventMeta}>
          <View style={styles.metaRow}>
            <Calendar size={14} color={Colors.text.secondary} />
            <Text style={styles.metaText}>{formatDate(item.start_datetime)}</Text>
            {item.is_recurring && (
              <Repeat size={14} color={Colors.text.tertiary} style={{ marginLeft: Spacing.xs }} />
            )}
          </View>
          <View style={styles.metaRow}>
            <MapPin size={14} color={Colors.text.secondary} />
            <Text style={styles.metaText}>
              {item.distance_km.toFixed(1)} km from you
            </Text>
          </View>
          {item.rsvp_count > 0 && (
            <View style={styles.metaRow}>
              <Users size={14} color={Colors.text.secondary} />
              <Text style={styles.metaText}>{item.rsvp_count} going</Text>
            </View>
          )}
        </View>
        <View style={styles.categoryBadge}>
          <Text style={styles.categoryText}>{item.category_label}</Text>
        </View>
        <Text style={styles.businessName}>{item.business_name}</Text>
      </View>
    </TouchableOpacity>
  );

  const renderListHeader = () => (
    <View style={styles.sheetHeader}>
      <View style={styles.grabHandle}>
        <GripHorizontal size={24} color={Colors.text.tertiary} />
      </View>
      <TouchableOpacity
        style={styles.showListRow}
        onPress={() => bottomSheetRef.current?.snapToIndex(1)}
        activeOpacity={0.7}
      >
        <List size={20} color={Colors.primary} />
        <Text style={styles.sheetSummary}>
          {loading
            ? 'Finding events near you...'
            : `${visibleEvents.length} event${visibleEvents.length !== 1 ? 's' : ''} in view`}
        </Text>
      </TouchableOpacity>
    </View>
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
          onMarkerDetailsPress={(eventId) => router.push(`/event/${eventId}` as never)}
          onRegionChange={handleRegionChange}
          style={styles.map}
        />
      </View>

      <View style={[styles.floatingHeader, { top: insets.top + Spacing.md }]}>
        <SearchBarCollapsed
          locationLabel={searchLocation?.label ?? null}
          onPress={() => setShowSearchOverlay(true)}
        />
        <TouchableOpacity
          style={styles.filterButton}
          onPress={() => setShowFilters(!showFilters)}
        >
          <Filter size={20} color={Colors.primary} />
          {selectedCategories.length > 0 && (
            <View style={styles.filterBadge}>
              <Text style={styles.filterBadgeText}>{selectedCategories.length}</Text>
            </View>
          )}
        </TouchableOpacity>
      </View>

      <SearchOverlay
        visible={showSearchOverlay}
        onClose={() => setShowSearchOverlay(false)}
        onSearch={handleSearchFromOverlay}
        userLocation={userLocation}
      />

      {showFilters && (
        <View style={[styles.filtersDropdown, { top: insets.top + Spacing.md + 56 }]}>
          <View style={styles.filtersHeader}>
            <Text style={styles.filtersTitle}>Categories</Text>
            {selectedCategories.length > 0 && (
              <TouchableOpacity onPress={clearFilters}>
                <Text style={styles.clearText}>Clear all</Text>
              </TouchableOpacity>
            )}
          </View>
          <View style={styles.categoriesGrid}>
            {categories.map((category) => {
              const isSelected = selectedCategories.includes(category.id);
              const categoryColor = getCategoryColor(category.slug);
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
                >
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
        </View>
      )}

      {/* ─── FIX: only show "Searching" overlay on *initial* load, not on
           every refetch, to avoid the flash ─── */}
      {loading && events.length === 0 && (
        <View style={styles.mapSearchingOverlay}>
          <ActivityIndicator size="small" color={Colors.primary} />
          <Text style={styles.mapSearchingText}>Searching...</Text>
        </View>
      )}

      {sheetIndex === 2 && (
        <View style={styles.mapDimOverlay} pointerEvents="box-only" />
      )}

      <BottomSheet
        ref={bottomSheetRef}
        index={0}
        snapPoints={SNAP_POINTS}
        enablePanDownToClose={false}
        handleIndicatorStyle={styles.handleIndicator}
        backgroundStyle={styles.sheetBackground}
        onChange={setSheetIndex}
      >
        <BottomSheetFlatList
          ref={flatListRef}
          data={visibleEvents}
          keyExtractor={(item: RankedEvent) => item.id}
          renderItem={renderEventCard}
          ListHeaderComponent={renderListHeader}
          ListEmptyComponent={
            loading ? (
              <View style={styles.loadingRow}>
                <ActivityIndicator size="large" color={Colors.primary} />
                <Text style={styles.loadingText}>Loading events...</Text>
              </View>
            ) : (
              <View style={styles.emptyState}>
                <MapPin size={48} color={Colors.text.tertiary} />
                <Text style={styles.emptyTitle}>Event not found</Text>
                <Text style={styles.emptySubtitle}>
                  No events in this area. Try moving the map or adjusting your filters
                </Text>
                {(selectedCategories.length > 0 || searchQuery) && (
                  <TouchableOpacity
                    style={styles.clearFiltersButton}
                    onPress={clearFilters}
                    activeOpacity={0.8}
                  >
                    <Text style={styles.clearFiltersText}>Clear filters</Text>
                  </TouchableOpacity>
                )}
              </View>
            )
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
    backgroundColor: Colors.background.secondary,
  },
  mapWrapper: {
    ...StyleSheet.absoluteFillObject,
  },
  map: {
    flex: 1,
    minHeight: SCREEN_HEIGHT,
  },
  mapDimOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.2)',
    pointerEvents: 'box-only',
  },
  floatingHeader: {
    position: 'absolute',
    left: Spacing.lg,
    right: Spacing.lg,
    zIndex: 100,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
  },
  searchBar: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.background.primary,
    borderRadius: BorderRadius.round,
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.md,
    ...Shadows.lg,
  },
  filterButton: {
    width: 48,
    height: 48,
    borderRadius: BorderRadius.round,
    backgroundColor: Colors.background.primary,
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
    ...Shadows.lg,
  },
  filterBadge: {
    position: 'absolute',
    top: 6,
    right: 6,
    minWidth: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: Colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 4,
  },
  filterBadgeText: {
    fontSize: 10,
    fontFamily: Typography.fontFamilies.semibold,
    fontWeight: Typography.weights.semibold,
    color: Colors.text.inverse,
  },
  filtersDropdown: {
    position: 'absolute',
    left: Spacing.lg,
    right: Spacing.lg,
    zIndex: 99,
    backgroundColor: Colors.background.primary,
    borderRadius: BorderRadius.lg,
    padding: Spacing.md,
    ...Shadows.lg,
  },
  mapSearchingOverlay: {
    position: 'absolute',
    top: Spacing.lg,
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
  sheetBackground: {
    backgroundColor: Colors.background.primary,
    borderTopLeftRadius: BorderRadius.xl,
    borderTopRightRadius: BorderRadius.xl,
    ...Shadows.lg,
  },
  handleIndicator: {
    backgroundColor: Colors.border.medium,
    width: 40,
  },
  sheetHeader: {
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.sm,
    paddingBottom: Spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border.light,
  },
  grabHandle: {
    alignSelf: 'center',
    marginBottom: Spacing.sm,
  },
  showListRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.sm,
    paddingVertical: Spacing.sm,
  },
  sheetSummary: {
    fontSize: Typography.sizes.md,
    fontFamily: Typography.fontFamily,
    color: Colors.text.secondary,
    textAlign: 'center',
  },
  listContent: {
    paddingHorizontal: Spacing.lg,
    paddingBottom: Spacing.xxl * 2,
  },
  searchInput: {
    flex: 1,
    marginLeft: Spacing.sm,
    fontSize: Typography.sizes.md,
    fontFamily: Typography.fontFamily,
    color: Colors.text.primary,
  },
  filtersContainer: {
    marginTop: Spacing.sm,
    paddingTop: Spacing.md,
    borderTopWidth: 1,
    borderTopColor: Colors.border.light,
  },
  filtersHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: Spacing.sm,
  },
  filtersTitle: {
    fontSize: Typography.sizes.sm,
    fontFamily: Typography.fontFamilies.semibold,
    fontWeight: Typography.weights.semibold,
    color: Colors.text.primary,
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
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    borderRadius: BorderRadius.round,
    backgroundColor: Colors.background.secondary,
    borderWidth: 1,
    borderColor: Colors.border.light,
  },
  categoryChipSelected: {
    backgroundColor: Colors.primary,
    borderColor: Colors.primary,
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
  eventCard: {
    backgroundColor: Colors.background.secondary,
    borderRadius: BorderRadius.lg,
    marginBottom: Spacing.md,
    overflow: 'hidden',
    ...Shadows.md,
  },
  eventImage: {
    height: 150,
    backgroundColor: Colors.background.tertiary,
    justifyContent: 'center',
    alignItems: 'center',
  },
  imagePlaceholder: {
    fontSize: 48,
    fontFamily: Typography.fontFamily,
  },
  eventContent: {
    padding: Spacing.md,
  },
  eventHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: Spacing.sm,
  },
  eventTitle: {
    flex: 1,
    fontSize: Typography.sizes.lg,
    fontFamily: Typography.fontFamilies.semibold,
    fontWeight: Typography.weights.semibold,
    color: Colors.text.primary,
  },
  premiumBadge: {
    backgroundColor: Colors.premium,
    paddingHorizontal: Spacing.sm,
    paddingVertical: 2,
    borderRadius: BorderRadius.sm,
    marginLeft: Spacing.sm,
  },
  premiumText: {
    fontSize: Typography.sizes.sm,
    fontFamily: Typography.fontFamily,
    color: Colors.text.primary,
  },
  eventMeta: {
    gap: Spacing.xs,
    marginBottom: Spacing.sm,
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs,
  },
  metaText: {
    fontSize: Typography.sizes.sm,
    fontFamily: Typography.fontFamily,
    color: Colors.text.secondary,
  },
  categoryBadge: {
    alignSelf: 'flex-start',
    backgroundColor: Colors.background.tertiary,
    paddingHorizontal: Spacing.sm,
    paddingVertical: Spacing.xs,
    borderRadius: BorderRadius.sm,
    marginBottom: Spacing.xs,
  },
  categoryText: {
    fontSize: Typography.sizes.xs,
    color: Colors.text.secondary,
    fontFamily: Typography.fontFamilies.medium,
    fontWeight: Typography.weights.medium,
  },
  businessName: {
    fontSize: Typography.sizes.sm,
    fontFamily: Typography.fontFamily,
    color: Colors.text.tertiary,
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
  emptyTitle: {
    fontSize: Typography.sizes.lg,
    fontFamily: Typography.fontFamilies.semibold,
    fontWeight: Typography.weights.semibold,
    color: Colors.text.primary,
    marginTop: Spacing.md,
  },
  emptySubtitle: {
    fontSize: Typography.sizes.sm,
    fontFamily: Typography.fontFamily,
    color: Colors.text.secondary,
    marginTop: Spacing.xs,
    textAlign: 'center',
  },
  clearFiltersButton: {
    marginTop: Spacing.lg,
    paddingVertical: Spacing.sm,
    paddingHorizontal: Spacing.lg,
    backgroundColor: Colors.primary,
    borderRadius: BorderRadius.md,
  },
  clearFiltersText: {
    fontSize: Typography.sizes.sm,
    fontFamily: Typography.fontFamilies.medium,
    fontWeight: Typography.weights.medium,
    color: Colors.text.inverse,
  },
});