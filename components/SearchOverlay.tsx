import { useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Modal,
  Pressable,
  Platform,
  LayoutAnimation,
  UIManager,
  KeyboardAvoidingView,
  ScrollView,
  Keyboard,
} from 'react-native';
import { BlurView } from 'expo-blur';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated, { FadeIn, FadeOut } from 'react-native-reanimated';
import { X } from 'lucide-react-native';
import { EventmapSearch, EventmapMapPin, EventmapCalendar } from '@/components/icons/EventmapIcons';
import { useSearch, type SearchLocation } from '@/contexts/SearchContext';
import { geocodingService } from '@/services/geocoding';
import { Colors, Spacing, Typography, BorderRadius, Shadows } from '@/constants/theme';
import { GooglePlacesAutocomplete, parseDescription } from './GooglePlacesAutocomplete';
import type { AutocompletePrediction } from '@/services/places';
import { RegionGrid, type RegionItem } from './RegionGrid';

if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

export type SearchStep = 'where' | 'when' | 'who';

type SearchOverlayProps = {
  visible: boolean;
  onClose: () => void;
  onSearch: (location: SearchLocation | null) => void;
  userLocation: { lat: number; lng: number } | null;
};

export function SearchOverlay({
  visible,
  onClose,
  onSearch,
  userLocation,
}: SearchOverlayProps) {
  const insets = useSafeAreaInsets();
  const { location, setLocation, clearAll, hasSelection } = useSearch();
  const [currentStep, setCurrentStep] = useState<SearchStep>('where');
  const [whereInput, setWhereInput] = useState('');
  const [suggestions, setSuggestions] = useState<AutocompletePrediction[]>([]);

  const handleLocationSelect = useCallback(
    (result: { label: string; lat: number; lng: number }) => {
      setLocation({ lat: result.lat, lng: result.lng, label: result.label });
      setWhereInput(result.label);
      setSuggestions([]);
      Keyboard.dismiss();
      LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
      setCurrentStep('when');
    },
    [setLocation]
  );

  const handleSuggestionSelect = useCallback(
    async (prediction: AutocompletePrediction) => {
      setWhereInput(prediction.description);
      setSuggestions([]);
      Keyboard.dismiss();
      try {
        const result = await geocodingService.getFirst(prediction.description);
        if (result) {
          handleLocationSelect({
            label: result.formattedAddress,
            lat: result.lat,
            lng: result.lng,
          });
        }
      } catch {
        // Silently fail
      }
    },
    [handleLocationSelect]
  );

  const handleRegionSelect = useCallback(
    async (region: RegionItem) => {
      Keyboard.dismiss();
      if (region.id === 'flexible') {
        setLocation(null);
        setWhereInput('');
        setSuggestions([]);
        LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
        setCurrentStep('when');
        return;
      }
      try {
        const result = await geocodingService.getFirst(region.searchQuery);
        if (result) {
          setLocation({ lat: result.lat, lng: result.lng, label: result.formattedAddress });
          setWhereInput(result.formattedAddress);
          setSuggestions([]);
          LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
          setCurrentStep('when');
        }
      } catch {
        setWhereInput(region.searchQuery);
      }
    },
    [setLocation]
  );

  const handleSearchPress = useCallback(() => {
    onSearch(location);
    onClose();
  }, [location, onSearch, onClose]);

  const handleClearAll = useCallback(() => {
    clearAll();
    setWhereInput('');
    setCurrentStep('where');
  }, [clearAll]);

  const handleClose = useCallback(() => {
    onClose();
  }, [onClose]);

  const summaryLabel = location?.label ?? 'Add location';

  return (
    <Modal
      visible={visible}
      animationType="none"
      transparent
      onRequestClose={handleClose}
    >
      <Pressable style={styles.modalContainer} onPress={handleClose}>
        <View style={styles.backdrop}>
          <BlurView intensity={80} tint="dark" style={StyleSheet.absoluteFill} />
        </View>

        <Pressable
          style={[styles.overlay, { paddingTop: insets.top + Spacing.md }]}
          onPress={() => {}}
        >
        <View style={styles.header}>
          <TouchableOpacity onPress={handleClose} style={styles.closeButton} hitSlop={12}>
            <X size={24} color={Colors.text.primary} />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Search</Text>
        </View>

        <KeyboardAvoidingView
          style={styles.keyboardAvoid}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          keyboardVerticalOffset={0}
        >
          <View style={styles.content}>
            {currentStep === 'where' && (
              <Animated.View
                entering={FadeIn.duration(200)}
                exiting={FadeOut.duration(150)}
                style={styles.whereSection}
              >
                <View style={styles.searchInputContainer}>
                  <GooglePlacesAutocomplete
                    value={whereInput}
                    onChangeText={setWhereInput}
                    onSuggestionsChange={setSuggestions}
                    placeholder="Search destinations"
                    autoFocus
                  />
                </View>

                <ScrollView
                  style={styles.resultsScroll}
                  contentContainerStyle={styles.resultsScrollContent}
                  keyboardShouldPersistTaps="handled"
                  showsVerticalScrollIndicator={false}
                >
                  {!whereInput.trim() ? (
                    <RegionGrid onSelect={handleRegionSelect} />
                  ) : suggestions.length > 0 ? (
                    <View style={styles.resultsList}>
                      {suggestions.map((item) => {
                        const { primary, secondary } = parseDescription(item.description);
                        return (
                          <TouchableOpacity
                            key={item.placeId}
                            style={styles.resultItem}
                            onPress={() => handleSuggestionSelect(item)}
                            activeOpacity={0.7}
                          >
                            <View style={styles.resultIcon}>
                              <EventmapMapPin size={20} color={Colors.text.secondary} />
                            </View>
                            <View style={styles.resultText}>
                              <Text style={styles.resultPrimary} numberOfLines={1}>
                                {primary}
                              </Text>
                              {secondary ? (
                                <Text style={styles.resultSecondary} numberOfLines={1}>
                                  {secondary}
                                </Text>
                              ) : null}
                            </View>
                          </TouchableOpacity>
                        );
                      })}
                    </View>
                  ) : null}
                </ScrollView>
              </Animated.View>
            )}

            {currentStep === 'when' && (
            <Animated.View entering={FadeIn.duration(200)} style={styles.stepSection}>
              <TouchableOpacity
                style={styles.summaryRow}
                onPress={() => setCurrentStep('where')}
              >
                <EventmapMapPin size={20} color={Colors.text.tertiary} />
                <Text style={styles.summaryLabel} numberOfLines={1}>
                  {summaryLabel}
                </Text>
              </TouchableOpacity>
              <View style={styles.placeholderSection}>
                <EventmapCalendar size={32} color={Colors.text.tertiary} />
                <Text style={styles.placeholderText}>When section</Text>
                <Text style={styles.placeholderSubtext}>Coming soon</Text>
              </View>
            </Animated.View>
          )}
          </View>
        </KeyboardAvoidingView>

        <View style={[styles.footer, { paddingBottom: insets.bottom + Spacing.md }]}>
          {hasSelection && (
            <TouchableOpacity onPress={handleClearAll} style={styles.clearButton}>
              <Text style={styles.clearText}>Clear all</Text>
            </TouchableOpacity>
          )}
          <TouchableOpacity
            style={styles.searchButton}
            onPress={handleSearchPress}
            activeOpacity={0.9}
          >
            <EventmapSearch size={20} color={Colors.text.inverse} />
            <Text style={styles.searchButtonText}>Search</Text>
          </TouchableOpacity>
        </View>
      </Pressable>
    </Pressable>
    </Modal>
  );
}

type SearchBarCollapsedProps = {
  locationLabel: string | null;
  onPress: () => void;
};

export function SearchBarCollapsed({ locationLabel, onPress }: SearchBarCollapsedProps) {
  return (
    <TouchableOpacity style={styles.collapsedBar} onPress={onPress} activeOpacity={0.9}>
      <EventmapSearch size={18} color={Colors.text.tertiary} />
      <View style={styles.collapsedSegments}>
        <Text style={styles.collapsedSegment} numberOfLines={1}>
          {locationLabel ?? 'Where'}
        </Text>
        <Text style={styles.collapsedDivider}>|</Text>
        <Text style={styles.collapsedSegment}>When</Text>
        <Text style={styles.collapsedDivider}>|</Text>
        <Text style={styles.collapsedSegment}>Add guests</Text>
      </View>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  modalContainer: {
    flex: 1,
  },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
  },
  overlay: {
    flex: 1,
    marginHorizontal: Spacing.lg,
    marginBottom: Spacing.xl,
    backgroundColor: Colors.background.primary,
    borderRadius: BorderRadius.xl,
    overflow: 'hidden',
    ...Shadows.lg,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: Spacing.lg,
    paddingBottom: Spacing.lg,
  },
  closeButton: {
    padding: Spacing.sm,
    marginRight: Spacing.sm,
  },
  headerTitle: {
    fontSize: Typography.sizes.lg,
    fontFamily: Typography.displayFontFamilies.semibold,
    fontWeight: Typography.weights.semibold,
    color: Colors.text.primary,
  },
  keyboardAvoid: {
    flex: 1,
    minHeight: 0,
  },
  content: {
    flex: 1,
    paddingHorizontal: Spacing.lg,
    minHeight: 0,
  },
  whereSection: {
    flex: 1,
    minHeight: 0,
  },
  searchInputContainer: {
    marginBottom: Spacing.md,
  },
  resultsScroll: {
    flex: 1,
    minHeight: 0,
  },
  resultsScrollContent: {
    flexGrow: 1,
    paddingBottom: Spacing.xl,
  },
  resultsList: {
    paddingTop: Spacing.sm,
  },
  resultItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: Spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border.light,
  },
  resultIcon: {
    width: 40,
    height: 40,
    borderRadius: 10,
    backgroundColor: Colors.background.secondary,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: Spacing.md,
  },
  resultText: {
    flex: 1,
    minWidth: 0,
  },
  resultPrimary: {
    fontSize: Typography.sizes.md,
    fontFamily: Typography.fontFamilies.semibold,
    fontWeight: Typography.weights.semibold,
    color: Colors.text.primary,
  },
  resultSecondary: {
    fontSize: Typography.sizes.sm,
    color: Colors.text.tertiary,
    marginTop: 2,
  },
  stepSection: {
    flex: 1,
  },
  summaryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    paddingVertical: Spacing.md,
    paddingHorizontal: Spacing.md,
    backgroundColor: Colors.background.secondary,
    borderRadius: BorderRadius.lg,
    marginBottom: Spacing.lg,
  },
  summaryLabel: {
    flex: 1,
    fontSize: Typography.sizes.md,
    color: Colors.text.primary,
  },
  placeholderSection: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: Spacing.xxl,
  },
  placeholderText: {
    fontSize: Typography.sizes.md,
    color: Colors.text.tertiary,
    marginTop: Spacing.md,
  },
  placeholderSubtext: {
    fontSize: Typography.sizes.sm,
    color: Colors.text.tertiary,
    marginTop: Spacing.xs,
  },
  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.lg,
    borderTopWidth: 1,
    borderTopColor: Colors.border.light,
  },
  clearButton: {
    paddingVertical: Spacing.sm,
  },
  clearText: {
    fontSize: Typography.sizes.md,
    color: Colors.text.secondary,
    textDecorationLine: 'underline',
  },
  searchButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.sm,
    backgroundColor: Colors.primary,
    paddingVertical: Spacing.md,
    borderRadius: BorderRadius.lg,
    ...Shadows.md,
  },
  searchButtonText: {
    fontSize: Typography.sizes.md,
    fontFamily: Typography.fontFamilies.semibold,
    fontWeight: Typography.weights.semibold,
    color: Colors.text.inverse,
  },
  collapsedBar: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.background.primary,
    borderRadius: BorderRadius.round,
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.md,
    ...Shadows.md,
  },
  collapsedSegments: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    marginLeft: Spacing.sm,
    flexWrap: 'nowrap',
  },
  collapsedSegment: {
    fontSize: Typography.sizes.sm,
    color: Colors.text.secondary,
    maxWidth: 100,
  },
  collapsedDivider: {
    fontSize: Typography.sizes.sm,
    color: Colors.border.medium,
    marginHorizontal: Spacing.xs,
  },
});
