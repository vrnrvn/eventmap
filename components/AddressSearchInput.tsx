import { useState, useCallback, useRef, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  ScrollView,
  Keyboard,
  ActivityIndicator,
} from 'react-native';
import { MapPin, X } from 'lucide-react-native';
import {
  placesService,
  AutocompletePrediction,
  AutocompleteTypes,
} from '@/services/places';
import { geocodingService } from '@/services/geocoding';
import { Colors, Spacing, Typography, BorderRadius, Shadows } from '@/constants/theme';

const DEBOUNCE_MS = 300;
const roundApprox = (n: number) => Math.round(n * 100) / 100;

export type AddressSearchResult = {
  formattedAddress: string;
  lat: number;
  lng: number;
};

type AddressSearchInputProps = {
  value: string;
  onChangeText: (text: string) => void;
  onSelect: (result: AddressSearchResult) => void;
  placeholder?: string;
  label?: string;
  error?: string;
  approximate?: boolean;
  showSetButton?: boolean;
  /** 'street' = addresses only; 'full' = addresses + business names; 'business' = Google Maps–like (businesses + addresses), uses Place Details for coordinates */
  addressPrecision?: 'street' | 'full' | 'any' | 'business';
  /** Show X icon to clear the input when it has value */
  showClearButton?: boolean;
  style?: object;
};

export function AddressSearchInput({
  value,
  onChangeText,
  onSelect,
  placeholder = 'Search address, city, area...',
  label,
  error,
  approximate = false,
  showSetButton = false,
  showClearButton = false,
  addressPrecision = 'any',
  style,
}: AddressSearchInputProps) {
  const [suggestions, setSuggestions] = useState<AutocompletePrediction[]>([]);
  const [suggestionsVisible, setSuggestionsVisible] = useState(false);
  const [settingLocation, setSettingLocation] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const selectingRef = useRef(false);

  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, []);

  const autocompleteOpts =
    addressPrecision === 'business'
      ? { allTypes: true as const }
      : { types: (addressPrecision === 'street' ? 'address' : 'geocode') as AutocompleteTypes };

  const fetchSuggestions = useCallback(
    async (query: string) => {
      if (!query.trim()) {
        setSuggestions([]);
        setSuggestionsVisible(false);
        return;
      }
      try {
        const results = await placesService.autocomplete(query, autocompleteOpts);
        setSuggestions(results);
        setSuggestionsVisible(results.length > 0);
      } catch {
        setSuggestions([]);
        setSuggestionsVisible(false);
      }
    },
    [addressPrecision]
  );

  const handleInputChange = useCallback(
    (text: string) => {
      onChangeText(text);
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => fetchSuggestions(text), DEBOUNCE_MS);
    },
    [onChangeText, fetchSuggestions]
  );

  const handleSelectSuggestion = useCallback(
    async (prediction: AutocompletePrediction) => {
      selectingRef.current = true;
      onChangeText(prediction.description);
      setSuggestionsVisible(false);
      setSuggestions([]);
      Keyboard.dismiss();
      try {
        if (addressPrecision === 'business') {
          const result = await placesService.getPlaceDetails(prediction.placeId);
          if (result) {
            onSelect({
              formattedAddress: result.formattedAddress,
              lat: result.lat,
              lng: result.lng,
            });
          }
        } else {
          const result = await geocodingService.getFirst(prediction.description);
          if (result) {
            onSelect({
              formattedAddress: result.formattedAddress,
              lat: approximate ? roundApprox(result.lat) : result.lat,
              lng: approximate ? roundApprox(result.lng) : result.lng,
            });
          }
        }
      } catch {
        // Silently fail - user can retry
      } finally {
        selectingRef.current = false;
      }
    },
    [onChangeText, onSelect, approximate, addressPrecision]
  );

  const handleSetLocation = useCallback(async () => {
    const query = value.trim();
    if (!query) return;
    Keyboard.dismiss();
    setSettingLocation(true);
    try {
      const result = await geocodingService.getFirst(query);
      if (result) {
        onSelect({
          formattedAddress: result.formattedAddress,
          lat: approximate ? roundApprox(result.lat) : result.lat,
          lng: approximate ? roundApprox(result.lng) : result.lng,
        });
        onChangeText(result.formattedAddress);
      }
    } catch {
      // Silently fail
    } finally {
      setSettingLocation(false);
    }
  }, [value, onChangeText, onSelect, approximate]);

  return (
    <View style={[styles.container, style]}>
      {label && <Text style={styles.label}>{label}</Text>}
      <View style={styles.inputRow}>
        <View style={styles.inputWrapper}>
          <View style={styles.inputInner}>
            <TextInput
              style={[styles.input, error && styles.inputError, showClearButton && value && styles.inputWithClear]}
              placeholder={placeholder}
              placeholderTextColor={Colors.text.tertiary}
              value={value}
              onChangeText={handleInputChange}
              onFocus={() => value.trim() && fetchSuggestions(value)}
              onBlur={() => {
                setTimeout(() => {
                  if (!selectingRef.current) setSuggestionsVisible(false);
                }, 300);
              }}
              keyboardShouldPersistTaps="handled"
            />
            {showClearButton && value ? (
              <TouchableOpacity
                style={styles.clearBtn}
                onPress={() => {
                  onChangeText('');
                  setSuggestions([]);
                  setSuggestionsVisible(false);
                }}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              >
                <X size={18} color={Colors.text.tertiary} />
              </TouchableOpacity>
            ) : null}
          </View>
          {suggestionsVisible && suggestions.length > 0 && (
            <ScrollView
              style={styles.suggestionsDropdown}
              keyboardShouldPersistTaps="handled"
              nestedScrollEnabled
              showsVerticalScrollIndicator
              bounces={false}
            >
              {suggestions.map((item) => (
                <TouchableOpacity
                  key={item.placeId}
                  style={styles.suggestionItem}
                  onPress={() => handleSelectSuggestion(item)}
                  activeOpacity={0.7}
                >
                  <Text style={styles.suggestionText} numberOfLines={2}>
                    {item.description}
                  </Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
          )}
        </View>
        {showSetButton && (
          <TouchableOpacity
            style={styles.setButton}
            onPress={handleSetLocation}
            disabled={settingLocation || !value.trim()}
          >
            {settingLocation ? (
              <ActivityIndicator size="small" color={Colors.text.inverse} />
            ) : (
              <>
                <MapPin size={18} color={Colors.text.inverse} />
                <Text style={styles.setButtonText}>Set</Text>
              </>
            )}
          </TouchableOpacity>
        )}
      </View>
      {error && <Text style={styles.errorText}>{error}</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    marginBottom: Spacing.md,
  },
  label: {
    fontSize: Typography.sizes.sm,
    fontFamily: Typography.fontFamilies.medium,
    fontWeight: Typography.weights.medium,
    color: Colors.text.primary,
    marginBottom: Spacing.xs,
  },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: Spacing.sm,
  },
  inputWrapper: {
    flex: 1,
    minWidth: 0,
    position: 'relative',
    zIndex: 10,
  },
  input: {
    borderWidth: 1,
    borderColor: Colors.border.light,
    borderRadius: BorderRadius.md,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm + 4,
    fontSize: Typography.sizes.md,
    color: Colors.text.primary,
    backgroundColor: Colors.background.primary,
  },
  inputError: {
    borderColor: Colors.error,
  },
  inputWithClear: {
    paddingRight: 40,
  },
  clearBtn: {
    position: 'absolute',
    right: 12,
    top: 0,
    bottom: 0,
    justifyContent: 'center',
    zIndex: 2,
  },
  suggestionsDropdown: {
    position: 'absolute',
    top: '100%',
    left: 0,
    right: 0,
    maxHeight: 200,
    backgroundColor: Colors.background.primary,
    borderRadius: BorderRadius.md,
    marginTop: Spacing.xs,
    ...Shadows.lg,
    overflow: 'hidden',
  },
  suggestionItem: {
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border.light,
  },
  suggestionText: {
    fontSize: Typography.sizes.md,
    color: Colors.text.primary,
  },
  setButton: {
    backgroundColor: Colors.primary,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm + 4,
    borderRadius: BorderRadius.md,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs,
    minHeight: 48,
    justifyContent: 'center',
    minWidth: 72,
  },
  setButtonText: {
    color: Colors.text.inverse,
    fontSize: Typography.sizes.sm,
    fontFamily: Typography.fontFamilies.semibold,
    fontWeight: Typography.weights.semibold,
  },
  errorText: {
    fontSize: Typography.sizes.xs,
    color: Colors.error,
    marginTop: Spacing.xs,
  },
});
