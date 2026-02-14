import { useState, useCallback, useRef, useEffect } from 'react';
import { View, TextInput, StyleSheet, ActivityIndicator } from 'react-native';
import { MapPin } from 'lucide-react-native';
import { placesService, AutocompletePrediction } from '@/services/places';
import { Colors, Spacing, Typography, BorderRadius } from '@/constants/theme';

const DEBOUNCE_MS = 300;

export type PlaceResult = {
  label: string;
  lat: number;
  lng: number;
};

export function parseDescription(description: string): { primary: string; secondary: string } {
  const parts = description.split(',').map((p) => p.trim());
  if (parts.length <= 1) {
    return { primary: description, secondary: '' };
  }
  return {
    primary: parts[0],
    secondary: parts.slice(1).join(', '),
  };
}

export type GooglePlacesAutocompleteProps = {
  value: string;
  onChangeText: (text: string) => void;
  onSuggestionsChange: (suggestions: AutocompletePrediction[]) => void;
  placeholder?: string;
  autoFocus?: boolean;
};

export function GooglePlacesAutocomplete({
  value,
  onChangeText,
  onSuggestionsChange,
  placeholder = 'Search destinations',
  autoFocus = false,
}: GooglePlacesAutocompleteProps) {
  const [loading, setLoading] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, []);

  const fetchSuggestions = useCallback(
    async (query: string) => {
      if (!query.trim()) {
        onSuggestionsChange([]);
        setLoading(false);
        return;
      }
      setLoading(true);
      try {
        const results = await placesService.autocomplete(query, {
          types: 'geocode',
        });
        onSuggestionsChange(results);
      } catch {
        onSuggestionsChange([]);
      } finally {
        setLoading(false);
      }
    },
    [onSuggestionsChange]
  );

  const handleInputChange = useCallback(
    (text: string) => {
      onChangeText(text);
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => fetchSuggestions(text), DEBOUNCE_MS);
    },
    [onChangeText, fetchSuggestions]
  );

  return (
    <View style={styles.inputWrapper}>
      <MapPin size={20} color={Colors.text.tertiary} style={styles.inputIcon} />
      <TextInput
        style={styles.input}
        placeholder={placeholder}
        placeholderTextColor={Colors.text.tertiary}
        value={value}
        onChangeText={handleInputChange}
        onFocus={() => value.trim() && fetchSuggestions(value)}
        autoFocus={autoFocus}
        autoCorrect={false}
        autoCapitalize="none"
      />
      {loading && (
        <ActivityIndicator size="small" color={Colors.primary} style={styles.loader} />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  inputWrapper: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.background.primary,
    borderRadius: BorderRadius.lg,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    borderWidth: 1,
    borderColor: Colors.border.light,
  },
  inputIcon: {
    marginRight: Spacing.sm,
  },
  input: {
    flex: 1,
    fontSize: Typography.sizes.md,
    color: Colors.text.primary,
    paddingVertical: Spacing.sm,
  },
  loader: {
    marginLeft: Spacing.sm,
  },
});
