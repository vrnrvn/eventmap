import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  Dimensions,
  Platform,
  Image,
} from 'react-native';
import { BlurView } from 'expo-blur';
import Animated, { FadeInDown, FadeIn } from 'react-native-reanimated';
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
import { Users, List, Repeat } from 'lucide-react-native';
import { EventmapFilter, EventmapMapPin, EventmapCalendar } from '@/components/icons/EventmapIcons';
import { GoogleMapView, type GoogleMapHandle } from '@/components/GoogleMapView';
import { EventCardCarousel } from '@/components/EventCardCarousel';
import { Avatar } from '@/components/Avatar';
import { SearchOverlay, SearchBarCollapsed } from '@/components/SearchOverlay';
import { filterEventsByDateRange } from '@/utils/recurrence';
import { bannersService, type AppBanner } from '@/services/banners';
import { AppBannerCarousel } from '@/components/AppBannerCarousel';

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
  const [banners, setBanners] = useState<AppBanner[]>([]);

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
    bannersService.getActiveBanners('discover').then(setBanners).catch(() => setBanners([]));
  }, []);

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
        beginProgrammaticMove(1200);
        setExplicitMoveTrigger((t) => t + 1);
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
        setExplicitMoveTrigger((t) => t + 1);
        mapRef.current?.animateTo(profileLocation.lat, profileLocation.lng);
        await loadEventsWithCenter(profileLocation.lat, profileLocation.lng);
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

  const handleRegionChange = useCallback(
    (region: {
      lat: number;
      lng: number;
      bounds?: { ne: { lat: number; lng: number }; sw: { lat: number; lng: number } };
    }) => {
      setMapCenter({ lat: region.lat, lng: region.lng });
      if (region.bounds) setMapBounds(region.bounds);

      if (!hasInitializedMapRef.current) return;
      if (isProgrammaticMoveRef.current) return;

      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }
      debounceTimerRef.current = setTimeout(() => {
        debounceTimerRef.current = null;
        if (isProgrammaticMoveRef.current) return;
        setCenter({ lat: region.lat, lng: region.lng });
        loadEventsWithCenterRef.current(region.lat, region.lng);
      }, REGION_DEBOUNCE_MS);
    },
    []
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

  const handleMarkerPress = useCallback(
    (eventId: string) => {
      setActiveMarkerId(eventId);
      const index = visibleEvents.findIndex((e) => e.id === eventId);
      if (index >= 0) {
        isScrollingFromMapRef.current = true;
        beginProgrammaticMove(1000);
        flatListRef.current?.scrollToIndex({
          index,
          animated: true,
          viewPosition: 0.5,
        });
        setTimeout(() => {
          isScrollingFromMapRef.current = false;
        }, 400);
      }
    },
    [visibleEvents, beginProgrammaticMove]
  );

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

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    });
  };

  const centerForMap = useMemo(
    () => mapCenter,
    [explicitMoveTrigger]
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

  const renderEventCard = ({ item, index }: { item: RankedEvent; index: number }) => (
    <Animated.View
      entering={FadeInDown.delay(index * 60).springify().damping(18)}
      style={[styles.eventCardWrapper, index % 2 === 1 && styles.eventCardOffset]}
    >
      <TouchableOpacity
        style={styles.eventCard}
        onPress={() => router.push(`/event/${item.id}` as never)}
        activeOpacity={0.92}
      >
        <EventCardCarousel
          imageUrls={item.cover_image_url ? [item.cover_image_url] : []}
          applySkew={index % 2 === 1}
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
              <EventmapCalendar size={14} color={Colors.text.secondary} />
              <Text style={styles.metaText}>{formatDate(item.start_datetime)}</Text>
              {item.is_recurring && (
                <Repeat size={14} color={Colors.text.tertiary} style={{ marginLeft: Spacing.xs }} />
              )}
            </View>
            <View style={styles.metaRow}>
              <EventmapMapPin size={14} color={Colors.text.secondary} />
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
          <TouchableOpacity
            style={styles.businessRow}
            onPress={() => router.push(`/business/${item.business_id}` as never)}
            activeOpacity={0.7}
          >
            <Avatar
              imageUrl={item.business_logo_url}
              name={item.business_name}
              size={24}
            />
            <Text style={styles.businessName}>{item.business_name}</Text>
          </TouchableOpacity>
        </View>
      </TouchableOpacity>
    </Animated.View>
  );

  const renderListHeader = () => (
    <>
      <AppBannerCarousel banners={banners} />
      <View style={styles.sheetHeader}>
        {sheetIndex === 0 ? (
          <TouchableOpacity
            style={styles.pullUpPill}
            onPress={() => bottomSheetRef.current?.snapToIndex(1)}
            activeOpacity={0.7}
          >
            <Text style={styles.pullUpText}>Pull up for events</Text>
          </TouchableOpacity>
        ) : (
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
        )}
      </View>
    </>
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

      {/* ── Search Island with Logo ── */}
      <View style={[styles.searchIslandWrapper, { top: insets.top + Spacing.md }]}>
        <BlurView intensity={Platform.OS === 'ios' ? 60 : 80} tint="light" style={styles.searchIsland}>
          <Image
            source={require('@/assets/images/EMlogo.png')}
            style={styles.searchIslandLogo}
            resizeMode="contain"
          />
          <SearchBarCollapsed
            locationLabel={searchLocation?.label ?? null}
            onPress={() => setShowSearchOverlay(true)}
          />
          <TouchableOpacity
            style={styles.filterButton}
            onPress={() => setShowFilters(!showFilters)}
          >
            <EventmapFilter size={20} color={Colors.primary} />
            {selectedCategories.length > 0 && (
              <View style={styles.filterBadge}>
                <Text style={styles.filterBadgeText}>{selectedCategories.length}</Text>
              </View>
            )}
          </TouchableOpacity>
        </BlurView>
      </View>

      <SearchOverlay
        visible={showSearchOverlay}
        onClose={() => setShowSearchOverlay(false)}
        onSearch={handleSearchFromOverlay}
        userLocation={userLocation}
      />

      {showFilters && (
        <Animated.View
          entering={FadeInDown.duration(220).springify().damping(18)}
          style={[styles.filtersDropdown, { top: insets.top + Spacing.md + 56 }]}
        >
          <BlurView intensity={Platform.OS === 'ios' ? 60 : 80} tint="light" style={styles.filtersBlur}>
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
          </BlurView>
        </Animated.View>
      )}

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
        style={styles.sheetContainer}
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
                <View style={styles.emptyLogoWrap}>
                  <Image
                    source={require('@/assets/images/EMlogo.png')}
                    style={styles.emptyLogo}
                    resizeMode="contain"
                  />
                </View>
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
    backgroundColor: Colors.background.primary,
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
    backgroundColor: 'rgba(28,28,28,0.25)',
    pointerEvents: 'box-only',
  },
  searchIslandWrapper: {
    position: 'absolute',
    left: Spacing.md,
    right: Spacing.md,
    zIndex: 30,
  },
  searchIsland: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    borderRadius: BorderRadius.round,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    overflow: 'hidden',
    ...Platform.select({
      ios: {
        shadowColor: '#1C1C1C',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.12,
        shadowRadius: 16,
      },
      android: { elevation: 8 },
    }),
  },
  searchIslandLogo: {
    width: 36,
    height: 36,
    borderRadius: 10,
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
    width: 44,
    height: 44,
    borderRadius: BorderRadius.lg,
    backgroundColor: 'rgba(250,248,245,0.6)',
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
    ...Shadows.sm,
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
    left: Spacing.md,
    right: Spacing.md,
    zIndex: 20,
    borderRadius: BorderRadius.xl,
    overflow: 'hidden',
    ...Platform.select({
      ios: {
        shadowColor: '#1C1C1C',
        shadowOffset: { width: 0, height: 6 },
        shadowOpacity: 0.14,
        shadowRadius: 20,
      },
      android: { elevation: 12 },
    }),
  },
  filtersBlur: {
    borderRadius: BorderRadius.xl,
    padding: Spacing.lg,
    overflow: 'hidden',
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
  sheetContainer: {
    marginHorizontal: 12,
    overflow: 'visible',
  },
  sheetBackground: {
    backgroundColor: 'rgba(250,248,245,0.85)',
    borderTopLeftRadius: 32,
    borderTopRightRadius: 32,
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
  sheetHeader: {
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.md,
    paddingBottom: Spacing.lg,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border.light,
  },
  pullUpPill: {
    alignSelf: 'center',
    paddingVertical: Spacing.sm,
    paddingHorizontal: Spacing.lg,
    marginBottom: Spacing.lg,
  },
  pullUpText: {
    fontSize: Typography.sizes.sm,
    fontFamily: Typography.fontFamilies.medium,
    fontWeight: Typography.weights.medium,
    color: Colors.text.tertiary,
  },
  showListRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: Spacing.xxl,
    gap: Spacing.md,
    paddingVertical: Spacing.sm,
  },
  sheetHandleIcon: {
    width: 40,
    height: 40,
    borderRadius: BorderRadius.md,
    backgroundColor: 'rgba(196, 92, 62, 0.12)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  sheetSummary: {
    fontSize: Typography.sizes.md,
    fontFamily: Typography.displayFontFamilies.medium,
    color: Colors.text.primary,
    textAlign: 'center',
  },
  listContent: {
    paddingHorizontal: Spacing.lg,
    paddingBottom: Spacing.xxl * 2,
  },
  eventCardWrapper: {
    marginBottom: Spacing.lg,
  },
  eventCardOffset: {
    marginLeft: 24,
    transform: [{ rotate: '-1deg' }],
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
    fontFamily: Typography.displayFontFamilies.semibold,
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
    borderRadius: BorderRadius.lg,
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
    backgroundColor: Colors.background.primary,
    borderRadius: BorderRadius.xl,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: Colors.border.light,
    ...Shadows.card,
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
    fontFamily: Typography.displayFontFamilies.extrabold,
    fontWeight: '800',
    color: Colors.text.primary,
    letterSpacing: 0.5,
  },
  premiumBadge: {
    backgroundColor: Colors.accent,
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
    backgroundColor: 'rgba(13, 79, 79, 0.1)',
    paddingHorizontal: Spacing.sm,
    paddingVertical: Spacing.xs,
    borderRadius: BorderRadius.sm,
    marginBottom: Spacing.xs,
  },
  categoryText: {
    fontSize: Typography.sizes.xs,
    color: Colors.secondary,
    fontFamily: Typography.fontFamilies.medium,
    fontWeight: Typography.weights.medium,
  },
  businessRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    marginTop: Spacing.xs,
  },
  businessName: {
    flex: 1,
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
  emptyLogoWrap: {
    width: 80,
    height: 80,
    borderRadius: 24,
    backgroundColor: 'rgba(196, 92, 62, 0.12)',
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
});