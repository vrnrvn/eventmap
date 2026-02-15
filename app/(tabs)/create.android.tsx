import { useState, useEffect, useCallback, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { TouchableOpacity } from 'react-native-gesture-handler';
import { DateTimePickerAndroid } from '@react-native-community/datetimepicker';
import { ChevronRight } from 'lucide-react-native';
import { useApp } from '@/contexts/AppContext';
import { router } from 'expo-router';
import { Input } from '@/components/Input';
import { AddressSearchInput } from '@/components/AddressSearchInput';
import { GoogleMapView } from '@/components/GoogleMapView';
import { RecurrencePicker, getRecurrenceLabel, type RecurrencePickerHandle } from '@/components/RecurrencePicker';
import { geocodingService } from '@/services/geocoding';
import { eventsService } from '@/services/events';
import { categoriesService } from '@/services/categories';
import { Category } from '@/types/database';
import { Colors, Spacing, Typography, BorderRadius } from '@/constants/theme';
import type { RecurrenceOption } from '@/utils/recurrence';

const DEFAULT_LOCATION = { lat: 37.7749, lng: -122.4194 };
const MAX_EVENT_DATE = new Date();
MAX_EVENT_DATE.setFullYear(MAX_EVENT_DATE.getFullYear() + 10);

export default function CreateScreen() {
  const { hasBusiness, userBusiness } = useApp();
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(false);

  const businessLocation = userBusiness
    ? { lat: userBusiness.lat, lng: userBusiness.lng, address: userBusiness.address }
    : null;

  const [formData, setFormData] = useState({
    title: '',
    description: '',
    categoryId: '',
    startDatetime: new Date(),
    endDatetime: new Date(Date.now() + 2 * 60 * 60 * 1000),
    recurrence: null as RecurrenceOption,
    address: '',
    lat: DEFAULT_LOCATION.lat,
    lng: DEFAULT_LOCATION.lng,
  });
  const recurrencePickerRef = useRef<RecurrencePickerHandle>(null);

  useEffect(() => {
    if (businessLocation) {
      setFormData((f) => ({
        ...f,
        address: businessLocation.address,
        lat: businessLocation.lat,
        lng: businessLocation.lng,
      }));
    }
  }, [businessLocation?.lat, businessLocation?.lng, businessLocation?.address]);

  const [errors, setErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    categoriesService.getAllCategories().then(setCategories);
  }, []);

  const openDatePicker = useCallback(
    (currentDate: Date, field: 'start' | 'end') => {
      const updateField = (d: Date) =>
        setFormData((f) =>
          field === 'start'
            ? { ...f, startDatetime: d }
            : { ...f, endDatetime: d }
        );

      DateTimePickerAndroid.open({
        value: currentDate,
        mode: 'date',
        maximumDate: MAX_EVENT_DATE,
        onChange: (_, dateResult) => {
          if (dateResult) {
            DateTimePickerAndroid.open({
              value: dateResult,
              mode: 'time',
              onChange: (_, timeResult) => {
                if (timeResult) updateField(timeResult);
              },
            });
          }
        },
      });
    },
    []
  );

  const validate = () => {
    const e: Record<string, string> = {};
    if (!formData.title.trim()) e.title = 'Title is required';
    if (!formData.description.trim()) e.description = 'Description is required';
    if (!formData.categoryId) e.categoryId = 'Select a category';
    if (formData.endDatetime <= formData.startDatetime) {
      e.endDatetime = 'End must be after start';
    }
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const handleSubmit = async () => {
    if (!validate() || !userBusiness) return;

    const address = formData.address.trim() || (businessLocation?.address ?? '');
    const lat = formData.address.trim() ? formData.lat : (businessLocation?.lat ?? formData.lat);
    const lng = formData.address.trim() ? formData.lng : (businessLocation?.lng ?? formData.lng);

    setLoading(true);
    try {
      await eventsService.createEvent({
        businessId: userBusiness.id,
        title: formData.title.trim(),
        description: formData.description.trim(),
        categoryId: formData.categoryId,
        startDatetime: formData.startDatetime.toISOString(),
        endDatetime: formData.endDatetime.toISOString(),
        address,
        lat,
        lng,
        isRecurring: formData.recurrence != null,
        recurrencePattern: formData.recurrence ?? undefined,
      });
      Alert.alert('Success', 'Event created!', [
        {
          text: 'OK',
          onPress: () =>
            router.push({
              pathname: '/(tabs)/discover',
              params: { centerLat: lat.toString(), centerLng: lng.toString() },
            }),
        },
      ]);
    } catch (err: unknown) {
      Alert.alert(
        'Error',
        err instanceof Error ? err.message : 'Failed to create event'
      );
    } finally {
      setLoading(false);
    }
  };

  const formatDateTime = (d: Date) =>
    d.toLocaleString('en-US', {
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    });

  if (!hasBusiness) {
    return (
      <View style={styles.container}>
        <Text style={styles.title}>Create Events</Text>
        <Text style={styles.subtitle}>
          You need a business profile to create events
        </Text>
        <TouchableOpacity
          style={styles.button}
          onPress={() => router.push('/(tabs)/profile')}
        >
          <Text style={styles.buttonText}>Set Up Business</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
      >
        <Text style={styles.title}>Create Event</Text>

        <Input
          label="Title"
          value={formData.title}
          onChangeText={(t) => setFormData((f) => ({ ...f, title: t }))}
          placeholder="Event name"
          error={errors.title}
        />

        <Input
          label="Description"
          value={formData.description}
          onChangeText={(t) => setFormData((f) => ({ ...f, description: t }))}
          placeholder="Describe your event"
          multiline
          numberOfLines={4}
          style={styles.textArea}
          error={errors.description}
        />

        <Text style={styles.label}>Category</Text>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={styles.categoriesScroll}
          contentContainerStyle={styles.categoriesRow}
        >
          {categories.map((c) => (
            <TouchableOpacity
              key={c.id}
              style={[
                styles.categoryChip,
                formData.categoryId === c.id && styles.categoryChipSelected,
              ]}
              onPress={() => setFormData((f) => ({ ...f, categoryId: c.id }))}
            >
              <Text
                style={[
                  styles.categoryChipText,
                  formData.categoryId === c.id && styles.categoryChipTextSelected,
                ]}
              >
                {c.label}
              </Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
        {errors.categoryId && (
          <Text style={styles.errorText}>{errors.categoryId}</Text>
        )}

        <Text style={styles.label}>Start</Text>
        <TouchableOpacity
          style={styles.dateButton}
          onPress={() => openDatePicker(formData.startDatetime, 'start')}
        >
          <Text style={styles.dateButtonText}>
            {formatDateTime(formData.startDatetime)}
          </Text>
        </TouchableOpacity>

        <Text style={styles.label}>End</Text>
        <TouchableOpacity
          style={styles.dateButton}
          onPress={() => openDatePicker(formData.endDatetime, 'end')}
        >
          <Text style={styles.dateButtonText}>
            {formatDateTime(formData.endDatetime)}
          </Text>
        </TouchableOpacity>
        {errors.endDatetime && (
          <Text style={styles.errorText}>{errors.endDatetime}</Text>
        )}

        <Text style={styles.label}>Repeat</Text>
        <TouchableOpacity
          style={styles.dateButton}
          onPress={() => recurrencePickerRef.current?.present()}
        >
          <Text style={styles.dateButtonText}>
            {getRecurrenceLabel(formData.recurrence)}
          </Text>
          <ChevronRight size={20} color={Colors.text.tertiary} />
        </TouchableOpacity>

        <Text style={styles.label}>Location (optional – defaults to business address)</Text>
        <AddressSearchInput
          value={formData.address}
          onChangeText={(t) => setFormData((f) => ({ ...f, address: t }))}
          onSelect={(result) =>
            setFormData((f) => ({
              ...f,
              address: result.formattedAddress,
              lat: result.lat,
              lng: result.lng,
            }))
          }
          placeholder="Address or venue"
          approximate={false}
          showSetButton
        />
        <Text style={styles.tapHint}>Tap on the map to set location</Text>
        <View style={styles.mapPreview}>
          <GoogleMapView
            center={{ lat: formData.lat, lng: formData.lng }}
            zoom={15}
            markers={[
              {
                id: 'event',
                lat: formData.lat,
                lng: formData.lng,
                title: formData.title || 'Event location',
              },
            ]}
            style={styles.mapPreviewInner}
            onMapPress={async (lat, lng) => {
              const result = await geocodingService.reverseGeocode(lat, lng);
              if (result) {
                setFormData((f) => ({
                  ...f,
                  address: result.formattedAddress,
                  lat: result.lat,
                  lng: result.lng,
                }));
              }
            }}
          />
        </View>
        {formData.address && (
          <Text style={styles.locationHint}>
            Pin at {formData.lat.toFixed(4)}, {formData.lng.toFixed(4)}
          </Text>
        )}

        <TouchableOpacity
          style={styles.submitButton}
          onPress={handleSubmit}
          disabled={loading}
        >
          {loading ? (
            <ActivityIndicator color={Colors.text.inverse} />
          ) : (
            <Text style={styles.submitButtonText}>Create Event</Text>
          )}
        </TouchableOpacity>
      </ScrollView>
      <RecurrencePicker
        ref={recurrencePickerRef}
        selectedValue={formData.recurrence}
        onSelect={(v) => setFormData((f) => ({ ...f, recurrence: v }))}
      />
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background.primary,
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    padding: Spacing.xl,
    paddingBottom: Spacing.xxl,
  },
  title: {
    fontSize: Typography.sizes.xxl,
    fontFamily: Typography.fontFamilies.bold,
    fontWeight: Typography.weights.bold,
    color: Colors.text.primary,
    marginBottom: Spacing.lg,
  },
  subtitle: {
    fontSize: Typography.sizes.md,
    color: Colors.text.secondary,
    textAlign: 'center',
    marginBottom: Spacing.xl,
  },
  button: {
    backgroundColor: Colors.primary,
    paddingVertical: Spacing.md,
    paddingHorizontal: Spacing.xl,
    borderRadius: BorderRadius.lg,
  },
  buttonText: {
    color: Colors.text.inverse,
    fontSize: Typography.sizes.md,
    fontFamily: Typography.fontFamilies.semibold,
    fontWeight: Typography.weights.semibold,
  },
  label: {
    fontSize: Typography.sizes.sm,
    fontFamily: Typography.fontFamilies.medium,
    fontWeight: Typography.weights.medium,
    color: Colors.text.primary,
    marginBottom: Spacing.xs,
  },
  textArea: {
    minHeight: 100,
    textAlignVertical: 'top',
  },
  categoriesScroll: {
    marginBottom: Spacing.md,
  },
  categoriesRow: {
    flexDirection: 'row',
    gap: Spacing.sm,
    paddingVertical: Spacing.xs,
  },
  categoryChip: {
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    borderRadius: BorderRadius.round,
    backgroundColor: Colors.background.secondary,
  },
  categoryChipSelected: {
    backgroundColor: Colors.primary,
  },
  categoryChipText: {
    fontSize: Typography.sizes.md,
    color: Colors.text.primary,
  },
  categoryChipTextSelected: {
    color: Colors.text.inverse,
    fontFamily: Typography.fontFamilies.semibold,
    fontWeight: Typography.weights.semibold,
  },
  dateButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderWidth: 1,
    borderColor: Colors.border.light,
    borderRadius: BorderRadius.md,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm + 4,
    marginBottom: Spacing.md,
  },
  dateButtonText: {
    fontSize: Typography.sizes.md,
    color: Colors.text.primary,
  },
  errorText: {
    fontSize: Typography.sizes.xs,
    color: Colors.error,
    marginTop: -Spacing.sm,
    marginBottom: Spacing.sm,
  },
  locationHint: {
    fontSize: Typography.sizes.xs,
    color: Colors.text.tertiary,
    marginTop: Spacing.xs,
    marginBottom: Spacing.md,
  },
  tapHint: {
    fontSize: Typography.sizes.sm,
    color: Colors.text.secondary,
    marginBottom: Spacing.sm,
  },
  mapPreview: {
    height: 280,
    borderRadius: BorderRadius.lg,
    overflow: 'hidden',
    marginBottom: Spacing.md,
  },
  mapPreviewInner: {
    flex: 1,
    minHeight: 280,
  },
  submitButton: {
    backgroundColor: Colors.primary,
    paddingVertical: Spacing.md,
    borderRadius: BorderRadius.lg,
    alignItems: 'center',
    marginTop: Spacing.lg,
  },
  submitButtonText: {
    color: Colors.text.inverse,
    fontSize: Typography.sizes.md,
    fontFamily: Typography.fontFamilies.semibold,
    fontWeight: Typography.weights.semibold,
  },
});
