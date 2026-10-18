import { useState, useCallback, useRef, useEffect } from 'react';
import { View, TextInput, StyleSheet, ActivityIndicator, Platform } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withSpring } from 'react-native-reanimated';
import { EventmapMapPin } from '@/components/icons/EventmapIcons';
import { placesService, AutocompletePrediction } from '@/services/places';
import { Colors, Spacing, Typography, Shadows } from '@/constants/theme';

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
  const [focused, setFocused] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const focusVal = useSharedValue(0);

  useEffect(() => {
    focusVal.value = withSpring(focused ? 1 : 0, { damping: 18 });
  }, [focused, focusVal]);

  const animatedWrapperStyle = useAnimatedStyle(() => ({
    transform: [{ scale: 1 + focusVal.value * 0.02 }],
  }));

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
    <Animated.View style={[styles.inputWrapper, animatedWrapperStyle]}>
      <View style={styles.inputIcon}>
        <EventmapMapPin size={20} color={Colors.text.tertiary} />
      </View>
      <TextInput
        style={styles.input}
        placeholder={placeholder}
        placeholderTextColor={Colors.text.tertiary}
        value={value}
        onChangeText={handleInputChange}
        onFocus={() => {
          setFocused(true);
          value.trim() && fetchSuggestions(value);
        }}
        onBlur={() => setFocused(false)}
        autoFocus={autoFocus}
        autoCorrect={false}
        autoCapitalize="none"
      />
      {loading && (
        <ActivityIndicator size="small" color={Colors.primary} style={styles.loader} />
      )}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  inputWrapper: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.background.primary,
    borderRadius: 9999,
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.md,
    ...Platform.select({
      ios: {
        ...Shadows.md,
      },
      android: { elevation: 4 },
    }),
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
