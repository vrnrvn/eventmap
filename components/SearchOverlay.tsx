import { useState, useCallback, useEffect, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Modal,
  Platform,
  LayoutAnimation,
  UIManager,
  KeyboardAvoidingView,
  ScrollView,
  Keyboard,
  TextInput,
} from 'react-native';
import { BlurView } from 'expo-blur';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated, { FadeIn, FadeOut } from 'react-native-reanimated';
import { X } from '@/components/icons.generated';
import { EventmapSearch, EventmapMapPin } from '@/components/icons/EventmapIcons';
import { useSearch, type SearchDateRange, type SearchLocation } from '@/contexts/SearchContext';
import { geocodingService } from '@/services/geocoding';
import { Colors, Spacing, Typography, BorderRadius, Shadows } from '@/constants/theme';
import {
  DATE_PRESETS,
  matchDatePreset,
  type DatePresetKey,
} from '@/utils/datePresets';
import { GooglePlacesAutocomplete, parseDescription } from './GooglePlacesAutocomplete';
import type { AutocompletePrediction } from '@/services/places';
import { useCategories } from '@/hooks/useCategories';
import { CategoryIcon } from '@/components/CategoryIcon';
import { matchCategorySuggestions } from '@/utils/categoryBrowse';
import { presentCategory } from '@/utils/categoryPresentation';
import type { Category } from '@/types/database';
import { RegionGrid, type RegionItem } from './RegionGrid';
import { ModalBackdrop } from '@/components/ui/ModalBackdrop';
import { a11yState } from '@/utils/accessibility';

if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

export type SearchStep = 'where' | 'when';

type SearchOverlayProps = {
  visible: boolean;
  onClose: () => void;
  onSearch: (
    location: SearchLocation | null,
    keyword: string,
    dateRange: SearchDateRange | null
  ) => void;
  userLocation: { lat: number; lng: number } | null;
  initialKeyword?: string;
  /**
   * A "Category" suggestion was picked for the typed keyword: apply it as a
   * category filter instead of a text search. Hidden when not provided.
   */
  onSelectCategory?: (category: Category) => void;
};

export function SearchOverlay({
  visible,
  onClose,
  onSelectCategory,
  onSearch,
  userLocation,
  initialKeyword = '',
}: SearchOverlayProps) {
  const insets = useSafeAreaInsets();
  const { location, setLocation, dateRange } = useSearch();
  const [currentStep, setCurrentStep] = useState<SearchStep>('where');
  const [whereInput, setWhereInput] = useState('');
  const [keyword, setKeyword] = useState(initialKeyword);
  const { categories } = useCategories();
  const categorySuggestions = useMemo(
    () => (onSelectCategory ? matchCategorySuggestions(keyword, categories) : []),
    [keyword, categories, onSelectCategory]
  );
  const [suggestions, setSuggestions] = useState<AutocompletePrediction[]>([]);
  // Dates are staged locally and committed on Search. Writing straight to
  // the context made every chip tap refetch Discover behind the modal.
  const [draftRange, setDraftRange] = useState<SearchDateRange | null>(dateRange);

  // Re-seed the fields from the active filters whenever the overlay opens.
  useEffect(() => {
    if (!visible) return;
    setKeyword(initialKeyword);
    setDraftRange(dateRange);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, initialKeyword]);

  const hasSelection = location != null || draftRange != null;

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
    onSearch(location, keyword.trim(), draftRange);
    onClose();
  }, [location, keyword, draftRange, onSearch, onClose]);

  // Clears the staged selection; nothing reaches Discover until Search.
  const handleClearAll = useCallback(() => {
    setLocation(null);
    setDraftRange(null);
    setWhereInput('');
    setKeyword('');
    setCurrentStep('where');
  }, [setLocation]);

  const applyDatePreset = useCallback((key: DatePresetKey) => {
    const preset = DATE_PRESETS.find((p) => p.key === key);
    setDraftRange(preset ? preset.build() : null);
  }, []);

  const handleClose = useCallback(() => {
    onClose();
  }, [onClose]);

  const summaryLabel = location?.label ?? 'Add location';

  const activeDatePreset = matchDatePreset(draftRange);

  return (
    <Modal
      visible={visible}
      animationType="none"
      transparent
      onRequestClose={handleClose}
    >
      <View style={styles.modalContainer}>
        <ModalBackdrop onPress={handleClose} label="Close search">
          <BlurView intensity={80} tint="dark" style={StyleSheet.absoluteFill} />
        </ModalBackdrop>

        <View
          style={[styles.overlay, { paddingTop: insets.top + Spacing.md }]}
          accessibilityViewIsModal
          onAccessibilityEscape={handleClose}
        >
        <View style={styles.header}>
          <TouchableOpacity
            onPress={handleClose}
            style={styles.closeButton}
            hitSlop={12}
            accessibilityRole="button"
            accessibilityLabel="Close search"
          >
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
                <View style={styles.keywordInputShell}>
                  <EventmapSearch size={18} color={Colors.text.tertiary} />
                  <TextInput
                    value={keyword}
                    onChangeText={setKeyword}
                    placeholder="Search events by name"
                    placeholderTextColor={Colors.text.tertiary}
                    style={styles.keywordInput}
                    returnKeyType="search"
                    autoCorrect={false}
                    onSubmitEditing={handleSearchPress}
                    accessibilityLabel="Keyword"
                  />
                  {keyword.length > 0 ? (
                    <TouchableOpacity
                      onPress={() => setKeyword('')}
                      hitSlop={8}
                      accessibilityRole="button"
                      accessibilityLabel="Clear keyword"
                    >
                      <X size={16} color={Colors.text.tertiary} />
                    </TouchableOpacity>
                  ) : null}
                </View>

                {categorySuggestions.length > 0 ? (
                  <View style={styles.categorySuggestions} accessibilityLabel="Category suggestions">
                    {categorySuggestions.map(({ category, matched }) => {
                      const { label } = presentCategory(category);
                      return (
                        <TouchableOpacity
                          key={category.id}
                          style={styles.categorySuggestion}
                          onPress={() => {
                            onSelectCategory?.(category);
                            onClose();
                          }}
                          activeOpacity={0.7}
                          accessibilityRole="button"
                          accessibilityLabel={`Show ${label} events`}
                        >
                          <CategoryIcon category={category} size="sm" />
                          <View style={styles.categorySuggestionText}>
                            <Text style={styles.categorySuggestionLabel}>{label}</Text>
                            <Text style={styles.categorySuggestionMeta}>
                              {matched ? `Category · matches “${matched}”` : 'Category'}
                            </Text>
                          </View>
                        </TouchableOpacity>
                      );
                    })}
                  </View>
                ) : null}

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
                            accessibilityRole="button"
                            accessibilityLabel={secondary ? `${primary}, ${secondary}` : primary}
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
                accessibilityRole="button"
                accessibilityLabel={`${summaryLabel}, change location`}
              >
                <EventmapMapPin size={20} color={Colors.text.tertiary} />
                <Text style={styles.summaryLabel} numberOfLines={1}>
                  {summaryLabel}
                </Text>
              </TouchableOpacity>
              <View style={styles.whenSection}>
                <Text style={styles.whenHint}>Filter events by date (applies to Discover list & map).</Text>
                <View style={styles.dateChipRow}>
                  {DATE_PRESETS.map((preset) => {
                    const selected = activeDatePreset === preset.key;
                    return (
                      <TouchableOpacity
                        key={preset.key}
                        style={[styles.dateChip, selected && styles.dateChipActive]}
                        onPress={() => applyDatePreset(preset.key)}
                        activeOpacity={0.85}
                        accessibilityRole="button"
                        {...a11yState({ selected }, 'button')}
                        accessibilityLabel={preset.label}
                        hitSlop={{ top: 6, bottom: 6 }}
                      >
                        <Text style={[styles.dateChipText, selected && styles.dateChipTextActive]}>
                          {preset.label}
                        </Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>
                {draftRange ? (
                  <Text style={styles.dateRangeSummary}>
                    {draftRange.start.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
                    {' — '}
                    {draftRange.end.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
                  </Text>
                ) : null}
              </View>
            </Animated.View>
          )}
          </View>
        </KeyboardAvoidingView>

        <View style={[styles.footer, { paddingBottom: insets.bottom + Spacing.md }]}>
          {(hasSelection || keyword.trim().length > 0) && (
            <TouchableOpacity
              onPress={handleClearAll}
              style={styles.clearButton}
              accessibilityRole="button"
              accessibilityLabel="Clear all filters"
              hitSlop={{ top: 6, bottom: 6, left: 8, right: 8 }}
            >
              <Text style={styles.clearText}>Clear all</Text>
            </TouchableOpacity>
          )}
          <TouchableOpacity
            style={styles.searchButton}
            onPress={handleSearchPress}
            activeOpacity={0.9}
            accessibilityRole="button"
            accessibilityLabel="Search"
          >
            <EventmapSearch size={20} color={Colors.text.inverse} />
            <Text style={styles.searchButtonText}>Search</Text>
          </TouchableOpacity>
        </View>
      </View>
    </View>
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
        <Text style={styles.collapsedSegment}>Dates</Text>
      </View>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  modalContainer: {
    flex: 1,
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
  categorySuggestions: {
    marginTop: Spacing.sm,
    gap: 2,
  },
  categorySuggestion: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    paddingVertical: Spacing.sm,
    paddingHorizontal: Spacing.sm,
    minHeight: 44,
    borderRadius: BorderRadius.md,
  },
  categorySuggestionText: { flex: 1, minWidth: 0 },
  categorySuggestionLabel: {
    fontSize: Typography.sizes.md,
    fontFamily: Typography.fontFamilies.semibold,
    color: Colors.text.primary,
  },
  categorySuggestionMeta: {
    fontSize: Typography.sizes.xs,
    fontFamily: Typography.fontFamilies.regular,
    color: Colors.text.tertiary,
  },
  keywordInputShell: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.md,
    backgroundColor: Colors.background.secondary,
    borderRadius: BorderRadius.lg,
    borderWidth: 1,
    borderColor: Colors.border.light,
    marginBottom: Spacing.md,
  },
  keywordInput: {
    flex: 1,
    fontSize: Typography.sizes.md,
    fontFamily: Typography.fontFamily,
    color: Colors.text.primary,
    padding: 0,
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
  whenSection: {
    flex: 1,
    paddingHorizontal: Spacing.sm,
  },
  whenHint: {
    fontSize: Typography.sizes.sm,
    color: Colors.text.secondary,
    lineHeight: 20,
    marginBottom: Spacing.lg,
  },
  dateChipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.sm,
    marginBottom: Spacing.md,
  },
  dateChip: {
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    borderRadius: BorderRadius.round,
    backgroundColor: Colors.background.secondary,
    borderWidth: 1,
    borderColor: Colors.border.light,
  },
  dateChipActive: {
    borderColor: Colors.primary,
    backgroundColor: Colors.primarySoft,
  },
  dateChipText: {
    fontSize: Typography.sizes.sm,
    color: Colors.text.primary,
    fontFamily: Typography.fontFamilies.medium,
  },
  dateChipTextActive: {
    color: Colors.primary,
    fontFamily: Typography.fontFamilies.semibold,
    fontWeight: Typography.weights.semibold,
  },
  dateRangeSummary: {
    fontSize: Typography.sizes.sm,
    color: Colors.text.tertiary,
    fontFamily: Typography.fontFamilies.medium,
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
