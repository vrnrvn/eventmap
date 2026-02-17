import React, { forwardRef, useImperativeHandle, useRef, useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  Dimensions,
  Linking,
} from 'react-native';
import { BottomSheetModal, BottomSheetScrollView } from '@gorhom/bottom-sheet';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { MapPin, Check, X } from 'lucide-react-native';
import { AddressSearchInput } from '@/components/AddressSearchInput';
import { GoogleMapView, type GoogleMapHandle } from '@/components/GoogleMapView';
import { geocodingService } from '@/services/geocoding';
import { Colors, Spacing, Typography, BorderRadius } from '@/constants/theme';

const { height: SCREEN_HEIGHT } = Dimensions.get('window');
const MAP_HEIGHT = 280;
const DEFAULT_LAT = 37.7749;
const DEFAULT_LNG = -122.4194;

export type AddressMapPickerResult = {
  formattedAddress: string;
  lat: number;
  lng: number;
};

export type AddressMapPickerHandle = {
  present: () => void;
  dismiss: () => void;
};

type AddressMapPickerProps = {
  initialAddress?: string;
  initialLat?: number | null;
  initialLng?: number | null;
  onConfirm: (result: AddressMapPickerResult) => void;
};

export const AddressMapPicker = forwardRef<AddressMapPickerHandle, AddressMapPickerProps>(
  function AddressMapPicker({ initialAddress = '', initialLat, initialLng, onConfirm }, ref) {
    const bottomSheetRef = useRef<BottomSheetModal>(null);
    const mapRef = useRef<GoogleMapHandle>(null);
    const insets = useSafeAreaInsets();
    const hasValidCoords =
      typeof initialLat === 'number' &&
      typeof initialLng === 'number' &&
      (initialLat !== 0 || initialLng !== 0);
    const [searchValue, setSearchValue] = useState(initialAddress);
    const [address, setAddress] = useState(initialAddress);
    const [lat, setLat] = useState(hasValidCoords ? initialLat! : DEFAULT_LAT);
    const [lng, setLng] = useState(hasValidCoords ? initialLng! : DEFAULT_LNG);
    const [reverseLoading, setReverseLoading] = useState(false);

    useImperativeHandle(ref, () => ({
      present: () => {
        const valid =
          typeof initialLat === 'number' &&
          typeof initialLng === 'number' &&
          (initialLat !== 0 || initialLng !== 0);
        setSearchValue(initialAddress);
        setAddress(initialAddress);
        setLat(valid ? initialLat! : DEFAULT_LAT);
        setLng(valid ? initialLng! : DEFAULT_LNG);
        bottomSheetRef.current?.present();
      },
      dismiss: () => bottomSheetRef.current?.dismiss(),
    }));

    const handleSelectFromSearch = useCallback(
      (result: { formattedAddress: string; lat: number; lng: number }) => {
        setAddress(result.formattedAddress);
        setLat(result.lat);
        setLng(result.lng);
        setSearchValue(result.formattedAddress);
        requestAnimationFrame(() => {
          mapRef.current?.animateTo(result.lat, result.lng);
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
          mapRef.current?.animateTo(result.lat, result.lng);
        } else {
          setAddress(`${pressedLat.toFixed(6)}, ${pressedLng.toFixed(6)}`);
          setLat(pressedLat);
          setLng(pressedLng);
          mapRef.current?.animateTo(pressedLat, pressedLng);
        }
      } catch {
        setAddress(`${pressedLat.toFixed(6)}, ${pressedLng.toFixed(6)}`);
        setLat(pressedLat);
        setLng(pressedLng);
        mapRef.current?.animateTo(pressedLat, pressedLng);
      } finally {
        setReverseLoading(false);
      }
    }, []);

    const handleConfirm = useCallback(() => {
      onConfirm({ formattedAddress: address, lat, lng });
      bottomSheetRef.current?.dismiss();
    }, [address, lat, lng, onConfirm]);

    const handleCancel = useCallback(() => {
      bottomSheetRef.current?.dismiss();
    }, []);

    return (
      <BottomSheetModal
        ref={bottomSheetRef}
        snapPoints={[Math.min(SCREEN_HEIGHT * 0.92, 700)]}
        index={0}
        enablePanDownToClose
        enableDismissOnClose
        handleIndicatorStyle={styles.handleIndicator}
        backgroundStyle={styles.background}
      >
        <BottomSheetScrollView
          contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 24 }]}
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.header}>
            <Text style={styles.title}>Business Location</Text>
            <Text style={styles.subtitle}>
              Search for your address or tap on the map to set the exact location
            </Text>
          </View>

          <View style={styles.searchSection}>
            <AddressSearchInput
              label="Search address or business"
              value={searchValue}
              onChangeText={setSearchValue}
              onSelect={handleSelectFromSearch}
              placeholder="Search business name or address (e.g. Arete Brazilian Jiu-Jitsu)..."
              addressPrecision="business"
            />
          </View>

          <View style={styles.mapSection}>
            <Text style={styles.mapLabel}>Map preview – tap to adjust pin</Text>
            <View style={[styles.mapContainer, { height: MAP_HEIGHT }]}>
              <GoogleMapView
                ref={mapRef}
                center={{ lat, lng }}
                zoom={17}
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
                    Linking.openURL(
                      `https://www.google.com/maps?q=${lat},${lng}&z=17`
                    )
                  }
                  activeOpacity={0.7}
                >
                  <Text style={styles.mapsLinkText}>Open in Google Maps</Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>

          <View style={styles.actions}>
            <TouchableOpacity
              style={styles.cancelBtn}
              onPress={handleCancel}
              activeOpacity={0.7}
            >
              <X size={18} color={Colors.text.secondary} />
              <Text style={styles.cancelBtnText}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.confirmBtn}
              onPress={handleConfirm}
              activeOpacity={0.85}
            >
              <Check size={18} color="#FFFFFF" />
              <Text style={styles.confirmBtnText}>Confirm location</Text>
            </TouchableOpacity>
          </View>
        </BottomSheetScrollView>
      </BottomSheetModal>
    );
  }
);

const styles = StyleSheet.create({
  handleIndicator: {
    backgroundColor: Colors.border.medium,
  },
  background: {
    backgroundColor: Colors.background.primary,
  },
  content: {
    paddingHorizontal: Spacing.xl,
  },
  header: {
    marginBottom: Spacing.lg,
  },
  title: {
    fontSize: Typography.sizes.xl,
    fontFamily: Typography.fontFamilies.bold,
    fontWeight: Typography.weights.bold,
    color: Colors.text.primary,
    marginBottom: Spacing.xs,
  },
  subtitle: {
    fontSize: Typography.sizes.sm,
    color: Colors.text.secondary,
    lineHeight: 20,
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
    minHeight: MAP_HEIGHT,
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
  actions: {
    flexDirection: 'row',
    gap: Spacing.md,
  },
  cancelBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.sm,
    paddingVertical: Spacing.md,
    borderRadius: BorderRadius.lg,
    borderWidth: 1,
    borderColor: Colors.border.medium,
  },
  cancelBtnText: {
    fontSize: Typography.sizes.md,
    fontFamily: Typography.fontFamilies.semibold,
    fontWeight: Typography.weights.semibold,
    color: Colors.text.secondary,
  },
  confirmBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.sm,
    paddingVertical: Spacing.md,
    borderRadius: BorderRadius.lg,
    backgroundColor: Colors.primary,
  },
  confirmBtnText: {
    fontSize: Typography.sizes.md,
    fontFamily: Typography.fontFamilies.semibold,
    fontWeight: Typography.weights.semibold,
    color: '#FFFFFF',
  },
});
