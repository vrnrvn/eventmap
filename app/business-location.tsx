import { useState, useCallback, useRef, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
  Dimensions,
  Linking,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { ArrowLeft, MapPin, Check } from 'lucide-react-native';
import { AddressSearchInput } from '@/components/AddressSearchInput';
import { GoogleMapView, type GoogleMapHandle } from '@/components/GoogleMapView';
import { geocodingService } from '@/services/geocoding';
import { businessLocationStore } from '@/stores/businessLocationStore';
import { onboardingLocationStore } from '@/stores/onboardingLocationStore';
import { Colors, Spacing, Typography, BorderRadius } from '@/constants/theme';

const { height: SCREEN_HEIGHT } = Dimensions.get('window');
const MAP_HEIGHT = Math.min(SCREEN_HEIGHT * 0.45, 400);
const DEFAULT_LAT = 37.7749;
const DEFAULT_LNG = -122.4194;

export default function BusinessLocationScreen() {
  const params = useLocalSearchParams<{
    address?: string;
    lat?: string;
    lng?: string;
    context?: 'business' | 'onboarding';
  }>();
  const isOnboarding = params.context === 'onboarding';
  const insets = useSafeAreaInsets();
  const mapRef = useRef<GoogleMapHandle>(null);

  const initialAddress = params.address ?? '';
  const initialLat = params.lat != null ? parseFloat(params.lat) : null;
  const initialLng = params.lng != null ? parseFloat(params.lng) : null;
  const hasValidCoords =
    typeof initialLat === 'number' &&
    typeof initialLng === 'number' &&
    !Number.isNaN(initialLat) &&
    !Number.isNaN(initialLng) &&
    (initialLat !== 0 || initialLng !== 0);

  const [searchValue, setSearchValue] = useState(initialAddress);
  const [address, setAddress] = useState(initialAddress);
  const [lat, setLat] = useState(hasValidCoords ? initialLat! : DEFAULT_LAT);
  const [lng, setLng] = useState(hasValidCoords ? initialLng! : DEFAULT_LNG);
  const [reverseLoading, setReverseLoading] = useState(false);

  const handleSelectFromSearch = useCallback(
    (result: { formattedAddress: string; lat: number; lng: number }) => {
      setAddress(result.formattedAddress);
      setLat(result.lat);
      setLng(result.lng);
      setSearchValue(result.formattedAddress);
      requestAnimationFrame(() => {
        mapRef.current?.animateTo(result.lat, result.lng, 19);
      });
    },
    []
  );

  const handleMapPress = useCallback(async (pressedLat: number, pressedLng: number) => {
    setReverseLoading(true);
    try {
      const result = await geocodingService.reverseGeocode(pressedLat, pressedLng, {
        preferAddress: true,
      });
      if (result) {
        setAddress(result.formattedAddress);
        setLat(result.lat);
        setLng(result.lng);
        setSearchValue(result.formattedAddress);
        mapRef.current?.animateTo(result.lat, result.lng, 19);
      } else {
        setAddress(`${pressedLat.toFixed(6)}, ${pressedLng.toFixed(6)}`);
        setLat(pressedLat);
        setLng(pressedLng);
        mapRef.current?.animateTo(pressedLat, pressedLng, 19);
      }
    } catch {
      setAddress(`${pressedLat.toFixed(6)}, ${pressedLng.toFixed(6)}`);
      setLat(pressedLat);
      setLng(pressedLng);
      mapRef.current?.animateTo(pressedLat, pressedLng, 19);
    } finally {
      setReverseLoading(false);
    }
  }, []);

  const handleConfirm = useCallback(() => {
    const result = { formattedAddress: address, lat, lng };
    if (isOnboarding) {
      onboardingLocationStore.setPending(result);
    } else {
      businessLocationStore.setPending(result);
    }
    router.back();
  }, [address, lat, lng, isOnboarding]);

  const handleBack = useCallback(() => {
    router.back();
  }, []);

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <TouchableOpacity style={styles.backBtn} onPress={handleBack} activeOpacity={0.7}>
          <ArrowLeft size={22} color={Colors.text.primary} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>
          {isOnboarding ? 'Your Location' : 'Business Location'}
        </Text>
        <TouchableOpacity
          style={styles.confirmHeaderBtn}
          onPress={handleConfirm}
          activeOpacity={0.7}
        >
          <Check size={20} color={Colors.primary} />
          <Text style={styles.confirmHeaderText}>Confirm</Text>
        </TouchableOpacity>
      </View>

      <KeyboardAvoidingView
        style={styles.keyboardView}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView
          style={styles.scroll}
          contentContainerStyle={[styles.scrollContent, { paddingBottom: insets.bottom + 24 }]}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.searchSection}>
            <AddressSearchInput
              label={isOnboarding ? 'Search city or address' : 'Search address or business'}
              value={searchValue}
              onChangeText={setSearchValue}
              onSelect={handleSelectFromSearch}
              placeholder={
                isOnboarding
                  ? 'Search city, area or address...'
                  : 'Search business name or address...'
              }
              addressPrecision="business"
              showClearButton
            />
          </View>

          <View style={styles.mapSection}>
            <Text style={styles.mapLabel}>Tap on map to set exact location</Text>
            <View style={[styles.mapContainer, { height: MAP_HEIGHT }]}>
              <GoogleMapView
                ref={mapRef}
                center={{ lat, lng }}
                zoom={19}
                markers={[
                  {
                    id: 'business',
                    lat,
                    lng,
                    title: address || 'Business location',
                  },
                ]}
                onMapPress={handleMapPress}
                style={styles.map}
              />
              {reverseLoading && (
                <View style={styles.mapOverlay}>
                  <ActivityIndicator size="large" color={Colors.primary} />
                  <Text style={styles.mapOverlayText}>Getting address...</Text>
                </View>
              )}
            </View>
          </View>

          <View style={styles.detailsSection}>
            <Text style={styles.detailsTitle}>Selected location</Text>
            <View style={styles.detailsCard}>
              <View style={styles.detailRow}>
                <MapPin size={18} color={Colors.primary} />
                <Text style={styles.detailLabel}>Full address</Text>
              </View>
              <Text style={styles.detailValue}>
                {address || 'Search or tap on map to set location'}
              </Text>
              <View style={styles.coordsRow}>
                <View style={styles.coordItem}>
                  <Text style={styles.coordLabel}>Latitude</Text>
                  <Text style={styles.coordValue}>{lat.toFixed(6)}</Text>
                </View>
                <View style={styles.coordItem}>
                  <Text style={styles.coordLabel}>Longitude</Text>
                  <Text style={styles.coordValue}>{lng.toFixed(6)}</Text>
                </View>
              </View>
              <View style={styles.mapsLinkRow}>
                <TouchableOpacity
                  style={styles.mapsLinkBtn}
                  onPress={() =>
                    Linking.openURL(`https://www.google.com/maps?q=${lat},${lng}&z=18`)
                  }
                  activeOpacity={0.7}
                >
                  <Text style={styles.mapsLinkText}>Open in Google Maps</Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: Colors.background.primary,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Colors.border.light,
  },
  backBtn: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: Colors.background.secondary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: {
    fontSize: Typography.sizes.lg,
    fontFamily: Typography.fontFamilies.bold,
    fontWeight: Typography.weights.bold,
    color: Colors.text.primary,
  },
  confirmHeaderBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 8,
    paddingHorizontal: 12,
  },
  confirmHeaderText: {
    fontSize: Typography.sizes.md,
    fontFamily: Typography.fontFamilies.semibold,
    fontWeight: Typography.weights.semibold,
    color: Colors.primary,
  },
  keyboardView: {
    flex: 1,
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: Spacing.xl,
    paddingTop: Spacing.lg,
  },
  searchSection: {
    marginBottom: Spacing.lg,
  },
  mapSection: {
    marginBottom: Spacing.lg,
  },
  mapLabel: {
    fontSize: Typography.sizes.sm,
    fontFamily: Typography.fontFamilies.semibold,
    fontWeight: Typography.weights.semibold,
    color: Colors.text.secondary,
    marginBottom: Spacing.sm,
  },
  mapContainer: {
    borderRadius: BorderRadius.lg,
    overflow: 'hidden',
    backgroundColor: Colors.background.secondary,
    position: 'relative',
  },
  map: {
    flex: 1,
    minHeight: 300,
  },
  mapOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(255,255,255,0.85)',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.sm,
  },
  mapOverlayText: {
    fontSize: Typography.sizes.sm,
    color: Colors.text.secondary,
  },
  detailsSection: {
    marginBottom: Spacing.xl,
  },
  detailsTitle: {
    fontSize: Typography.sizes.sm,
    fontFamily: Typography.fontFamilies.semibold,
    fontWeight: Typography.weights.semibold,
    color: Colors.text.secondary,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    marginBottom: Spacing.sm,
  },
  detailsCard: {
    backgroundColor: Colors.background.secondary,
    borderRadius: BorderRadius.lg,
    padding: Spacing.lg,
    borderWidth: 1,
    borderColor: Colors.border.light,
  },
  detailRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs,
    marginBottom: Spacing.xs,
  },
  detailLabel: {
    fontSize: Typography.sizes.sm,
    fontFamily: Typography.fontFamilies.medium,
    fontWeight: Typography.weights.medium,
    color: Colors.text.tertiary,
  },
  detailValue: {
    fontSize: Typography.sizes.md,
    color: Colors.text.primary,
    lineHeight: 22,
    marginBottom: Spacing.md,
  },
  coordsRow: {
    flexDirection: 'row',
    gap: Spacing.xl,
  },
  coordItem: {
    flex: 1,
  },
  coordLabel: {
    fontSize: Typography.sizes.xs,
    fontFamily: Typography.fontFamilies.medium,
    fontWeight: Typography.weights.medium,
    color: Colors.text.tertiary,
    marginBottom: 2,
  },
  coordValue: {
    fontSize: Typography.sizes.sm,
    fontFamily: Typography.fontFamilies.mono,
    color: Colors.text.secondary,
  },
  mapsLinkRow: {
    marginTop: Spacing.md,
    paddingTop: Spacing.md,
    borderTopWidth: 1,
    borderTopColor: Colors.border.light,
  },
  mapsLinkBtn: {
    alignSelf: 'flex-start',
  },
  mapsLinkText: {
    fontSize: Typography.sizes.sm,
    fontFamily: Typography.fontFamilies.semibold,
    fontWeight: Typography.weights.semibold,
    color: Colors.primary,
    textDecorationLine: 'underline',
  },
});
