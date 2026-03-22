import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Pressable,
  ActivityIndicator,
  Dimensions,
  Platform,
  Image,
  ScrollView,
  Modal,
} from 'react-native';
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
import { getCategoryIconColor } from '@/constants/categoryIcons';
import { CategoryIcon } from '@/components/CategoryIcon';
import { Users, List, Repeat, X, Heart, Search, SlidersHorizontal, Plus, MapPin } from 'lucide-react-native';
import { EventmapFilter, EventmapMapPin, EventmapCalendar } from '@/components/icons/EventmapIcons';
import { GoogleMapView, type GoogleMapHandle } from '@/components/GoogleMapView';
import { EventCardCarousel } from '@/components/EventCardCarousel';
import { Avatar } from '@/components/Avatar';
import { SearchOverlay } from '@/components/SearchOverlay';
import { filterEventsByDateRange } from '@/utils/recurrence';
import { bannersService, type AppBanner } from '@/services/banners';
import { socialService } from '@/services/social';
import { AppBannerCarousel } from '@/components/AppBannerCarousel';

const { height: SCREEN_HEIGHT } = Dimensions.get('window');
const DEFAULT_CENTER = { lat: 37.7749, lng: -122.4194 };
const REGION_DEBOUNCE_MS = 500;
const HEADER_HEIGHT_PX = 170;

function truncateText(text: string, limit = 50): string {
  if (!text || text.length <= limit) return text;
  return text.slice(0, limit).trim() + '...';
}

export default function DiscoverScreen() {
  const insets = useSafeAreaInsets();
  const { profile } = useAuth();
  const { location: searchLocation, dateRange } = useSearch();
  const [events, setEvents] = useState<RankedEvent[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategories, setSelectedCategories] = useState<string[]>([]);
  const [showSearchOverlay, setShowSearchOverlay] = useState(false);
  const [showFilters, setShowFilters] = useState(false);
  const [center, setCenter] = useState(DEFAULT_CENTER);
  const [mapCenter, setMapCenter] = useState(DEFAULT_CENTER);
  const [mapBounds, setMapBounds] = useState<{
    ne: { lat: number; lng: number };
    sw: { lat: number; lng: number };
  } | null>(null);
  const [explicitMoveTrigger, setExplicitMoveTrigger] = useState(0);
  const [sheetIndex, setSheetIndex] = useState(0);
  const [activeMarkerId, setActiveMarkerId] = useState<string | null>(null);
  const [showFloatingCard, setShowFloatingCard] = useState(false);
  const [savedEventIds, setSavedEventIds] = useState<Set<string>>(new Set());
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

  const activeEvent = useMemo(
    () => (activeMarkerId ? visibleEvents.find((e) => e.id === activeMarkerId) ?? null : null),
    [activeMarkerId, visibleEvents]
  );

  const handleSaveEvent = useCallback(async (eventId: string) => {
    if (!profile) return;
    const isSaved = savedEventIds.has(eventId);
    try {
      if (isSaved) {
        await socialService.unsaveEvent(eventId);
        setSavedEventIds((prev) => {
          const next = new Set(prev);
          next.delete(eventId);
          return next;
        });
      } else {
        await socialService.saveEvent(eventId);
        setSavedEventIds((prev) => new Set(prev).add(eventId));
      }
    } catch {
      // Ignore - user may need to sign in
    }
  }, [profile, savedEventIds]);

  const handleMarkerPress = useCallback(
    (eventId: string) => {
      setActiveMarkerId(eventId);
      setShowFloatingCard(true);
      beginProgrammaticMove(1000);
    },
    [beginProgrammaticMove]
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

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    });
  };

  const headerHeight = useMemo(
    () => HEADER_HEIGHT_PX,
    []
  );

  const snapPoints = useMemo(
    () => [
      SCREEN_HEIGHT * 0.07,
      SCREEN_HEIGHT - headerHeight,
    ],
    [headerHeight]
  );

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
      style={styles.eventCardWrapper}
    >
      <TouchableOpacity
        style={styles.eventCard}
        onPress={() => router.push(`/event/${item.id}` as never)}
        activeOpacity={0.92}
      >
        <EventCardCarousel imageUrls={item.cover_image_url ? [item.cover_image_url] : []} />
        <View style={styles.eventContent}>
          <View style={styles.eventHeader}>
            <Text style={styles.eventTitle} numberOfLines={1}>
              {item.title}
            </Text>
          </View>
          <View style={styles.eventMeta}>
            <View style={styles.metaRow}>
              <MapPin size={14} color={Colors.text.tertiary} />
              <Text style={styles.metaText}>{item.distance_km.toFixed(1)} mi</Text>
              <Text style={styles.metaDot}>•</Text>
              <Text style={styles.metaText} numberOfLines={1}>
                {item.business_name}
              </Text>
            </View>
          </View>
          <View style={styles.eventBadgeRow}>
            <View style={styles.eventBadgeLight}>
              <Text style={styles.eventBadgeLightText}>
                {new Date(item.start_datetime).toDateString() === new Date().toDateString() ? 'TODAY' : 'UPCOMING'}
              </Text>
            </View>
            <View style={styles.eventBadgeDark}>
              <Text style={styles.eventBadgeDarkText}>{item.category_label.toUpperCase()}</Text>
            </View>
          </View>
          <TouchableOpacity style={styles.businessRow} onPress={() => router.push(`/business/${item.business_id}` as never)} activeOpacity={0.7}>
            <Avatar imageUrl={item.business_logo_url} name={item.business_name} size={24} />
            <Text style={styles.businessName} numberOfLines={1}>
              {formatDate(item.start_datetime)}
            </Text>
          </TouchableOpacity>
        </View>
      </TouchableOpacity>
    </Animated.View>
  );

  const eventCountLabel = loading
    ? 'Finding events near you...'
    : visibleEvents.length > 100
      ? '100+ events'
      : `${visibleEvents.length} event${visibleEvents.length !== 1 ? 's' : ''}`;

  const renderListHeader = () => (
    <View style={styles.sheetHeader}>
      <View style={styles.sheetHandle} />
      <View style={styles.sheetHeaderRow}>
        <View>
          <Text style={styles.sheetEyebrow}>Happening Nearby</Text>
          <Text style={styles.sheetTitle}>Discover</Text>
        </View>
        <TouchableOpacity
          onPress={() => bottomSheetRef.current?.snapToIndex(1)}
          activeOpacity={0.8}
        >
          <Text style={styles.seeAllText}>See all</Text>
        </TouchableOpacity>
      </View>
      {banners.length > 0 ? <AppBannerCarousel banners={banners} /> : null}
      <Text style={styles.sheetSummary}>{eventCountLabel}</Text>
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

      {activeEvent && showFloatingCard && (
        <>
          <Pressable
            style={styles.floatingCardBackdrop}
            onPress={() => {
              setActiveMarkerId(null);
              setShowFloatingCard(false);
            }}
          />
          <View
            style={[styles.floatingCardWrapper, { bottom: insets.bottom + 20 }]}
            pointerEvents="box-none"
          >
          <TouchableOpacity
            style={styles.floatingCard}
            onPress={() => router.push(`/event/${activeEvent.id}` as never)}
            activeOpacity={1}
          >
            <View style={styles.floatingCardImageSection}>
              {activeEvent.cover_image_url ? (
                <Image
                  source={{ uri: activeEvent.cover_image_url }}
                  style={styles.floatingCardImage}
                  resizeMode="cover"
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
                  <Text style={styles.floatingCardBadgeText}>
                    🔥 {activeEvent.rsvp_count} Going
                  </Text>
                </View>
                <View style={styles.floatingCardActionPill}>
                  <TouchableOpacity
                    style={styles.floatingCardActionBtn}
                    onPress={(e) => {
                      e.stopPropagation();
                      handleSaveEvent(activeEvent.id);
                    }}
                    hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
                  >
                    <Heart
                      size={20}
                      color={savedEventIds.has(activeEvent.id) ? Colors.primary : '#1a1a1a'}
                      fill={savedEventIds.has(activeEvent.id) ? Colors.primary : 'transparent'}
                    />
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={styles.floatingCardActionBtn}
                    onPress={(e) => {
                      e.stopPropagation();
                      setActiveMarkerId(null);
                      setShowFloatingCard(false);
                    }}
                    hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
                  >
                    <X size={22} color="#1a1a1a" />
                  </TouchableOpacity>
                </View>
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
          <TouchableOpacity
            style={styles.topBarLeft}
            onPress={() => setShowSearchOverlay(true)}
            activeOpacity={0.8}
          >
            <Search size={21} color={Colors.primary} />
            <Image source={require('@/assets/images/EMlogo.png')} style={styles.topBarLogo} />
            <Text style={styles.brandText}>EventMaps</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.filterIconButton}
            onPress={() => setShowFilters(!showFilters)}
            activeOpacity={0.8}
          >
            <SlidersHorizontal size={20} color={Colors.text.secondary} />
          </TouchableOpacity>
        </View>

        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.chipsRow}
          style={styles.chipsScroll}
        >
          <TouchableOpacity
            style={[styles.overlayChip, selectedCategories.length === 0 && styles.overlayChipActive]}
            onPress={() => setSelectedCategories([])}
            activeOpacity={0.85}
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
            >
              <X size={24} color={Colors.text.primary} />
            </TouchableOpacity>
            <Text style={styles.filtersPageTitle}>Filters</Text>
            {selectedCategories.length > 0 ? (
              <TouchableOpacity onPress={clearFilters}>
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
            <Text style={styles.filtersSectionTitle}>Categories</Text>
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
        </View>
      </Modal>

      <SearchOverlay
        visible={showSearchOverlay}
        onClose={() => setShowSearchOverlay(false)}
        onSearch={handleSearchFromOverlay}
        userLocation={userLocation}
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

      <View style={[styles.fabWrap, { bottom: insets.bottom + 104 }]}>
        <TouchableOpacity
          style={styles.fab}
          activeOpacity={0.88}
          onPress={() => router.push('/(tabs)/create')}
        >
          <Plus size={30} color="#FFFFFF" />
        </TouchableOpacity>
      </View>

      {!(activeEvent && showFloatingCard) && (
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
      )}
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
    borderRadius: 8,
    tintColor: Colors.primary,
  },
  brandText: {
    color: Colors.primary,
    fontSize: 24,
    lineHeight: 28,
    letterSpacing: -0.2,
    fontFamily: Typography.displayFontFamilies.extrabold,
    fontWeight: '800',
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
    gap: 6,
    paddingHorizontal: 18,
    paddingVertical: 10,
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
    fontSize: 12,
    letterSpacing: 1,
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
    top: 4,
    right: 4,
    minWidth: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: Colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 4,
  },
  filterButtonBadgeText: {
    fontSize: 10,
    fontFamily: Typography.fontFamilies.semibold,
    fontWeight: Typography.weights.semibold,
    color: Colors.text.inverse,
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
  filtersSectionTitle: {
    fontSize: Typography.sizes.sm,
    fontFamily: Typography.fontFamilies.semibold,
    fontWeight: Typography.weights.semibold,
    color: Colors.text.secondary,
    marginBottom: Spacing.md,
    textTransform: 'uppercase',
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
    height: SCREEN_HEIGHT * 0.35,
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
  floatingCardActionPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs,
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
  sheetHandle: {
    width: 62,
    height: 6,
    borderRadius: BorderRadius.round,
    backgroundColor: Colors.border.light,
    alignSelf: 'center',
    marginBottom: 22,
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
    fontSize: 10,
    fontFamily: Typography.labelFontFamilies.semibold,
    marginBottom: 4,
  },
  sheetTitle: {
    color: Colors.text.primary,
    fontSize: 32,
    lineHeight: 38,
    letterSpacing: -0.5,
    fontFamily: Typography.displayFontFamilies.extrabold,
    fontWeight: '800',
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
  eventCardWrapper: {
    marginBottom: 18,
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
    backgroundColor: '#FFFFFF',
    borderRadius: 32,
    overflow: 'hidden',
    borderWidth: 0,
    ...Shadows.sm,
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
    padding: 10,
  },
  eventHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: Spacing.sm,
  },
  eventTitle: {
    flex: 1,
    fontSize: 22,
    lineHeight: 28,
    fontFamily: Typography.displayFontFamilies.extrabold,
    fontWeight: '800',
    color: Colors.text.primary,
    letterSpacing: -0.2,
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
    marginBottom: 10,
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs,
  },
  metaText: {
    fontSize: 12,
    fontFamily: Typography.labelFontFamilies.medium,
    color: Colors.text.secondary,
  },
  metaDot: {
    color: Colors.text.tertiary,
    marginHorizontal: 4,
  },
  eventBadgeRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 10,
  },
  eventBadgeLight: {
    backgroundColor: 'rgba(255,255,255,0.95)',
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: BorderRadius.round,
  },
  eventBadgeLightText: {
    color: '#0F172A',
    fontSize: 10,
    letterSpacing: 2,
    fontFamily: Typography.labelFontFamilies.semibold,
  },
  eventBadgeDark: {
    backgroundColor: 'rgba(0,0,0,0.45)',
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: BorderRadius.round,
  },
  eventBadgeDarkText: {
    color: '#FFFFFF',
    fontSize: 10,
    letterSpacing: 2,
    fontFamily: Typography.labelFontFamilies.semibold,
  },
  categoryBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs,
    alignSelf: 'flex-start',
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
    marginTop: 2,
  },
  businessName: {
    flex: 1,
    fontSize: 12,
    fontFamily: Typography.labelFontFamilies.medium,
    color: Colors.text.secondary,
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
