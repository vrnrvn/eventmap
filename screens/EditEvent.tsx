import { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  ActivityIndicator,
  Alert,
} from 'react-native';
import DateTimePicker, {
  DateTimePickerAndroid,
} from '@react-native-community/datetimepicker';
import { router, useLocalSearchParams } from 'expo-router';
import { useApp } from '@/contexts/AppContext';
import { Input } from '@/components/Input';
import { AddressSearchInput } from '@/components/AddressSearchInput';
import { GoogleMapView } from '@/components/GoogleMapView';
import { geocodingService } from '@/services/geocoding';
import { eventsService } from '@/services/events';
import { categoriesService } from '@/services/categories';
import { Category } from '@/types/database';
import { Colors, Spacing, Typography, BorderRadius } from '@/constants/theme';

const DEFAULT_LOCATION = { lat: 37.7749, lng: -122.4194 };
const MAX_EVENT_DATE = new Date();
MAX_EVENT_DATE.setFullYear(MAX_EVENT_DATE.getFullYear() + 10);

export default function EditEvent() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { userBusiness } = useApp();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [categories, setCategories] = useState<Category[]>([]);
  const [showStartPicker, setShowStartPicker] = useState(false);
  const [showEndPicker, setShowEndPicker] = useState(false);

  const businessLocation = userBusiness
    ? { lat: userBusiness.lat, lng: userBusiness.lng, address: userBusiness.address }
    : null;

  const [formData, setFormData] = useState({
    title: '',
    description: '',
    categoryId: '',
    startDatetime: new Date(),
    endDatetime: new Date(Date.now() + 2 * 60 * 60 * 1000),
    address: '',
    lat: DEFAULT_LOCATION.lat,
    lng: DEFAULT_LOCATION.lng,
  });

  const [errors, setErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    categoriesService.getAllCategories().then(setCategories);
  }, []);

  useEffect(() => {
    if (!id) return;
    const load = async () => {
      try {
        const details = await eventsService.getEventDetails(id);
        if (!details?.event) {
          Alert.alert('Error', 'Event not found', [
            { text: 'OK', onPress: () => router.back() },
          ]);
          return;
        }
        const e = details.event;
        setFormData({
          title: e.title,
          description: e.description,
          categoryId: e.category_id,
          startDatetime: new Date(e.start_datetime),
          endDatetime: new Date(e.end_datetime),
          address: e.address,
          lat: e.lat,
          lng: e.lng,
        });
      } catch {
        Alert.alert('Error', 'Failed to load event', [
          { text: 'OK', onPress: () => router.back() },
        ]);
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [id]);

  const openAndroidPicker = useCallback(
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
    if (!validate() || !id) return;

    const address = formData.address.trim() || (businessLocation?.address ?? '');
    const lat = formData.address.trim() ? formData.lat : (businessLocation?.lat ?? formData.lat);
    const lng = formData.address.trim() ? formData.lng : (businessLocation?.lng ?? formData.lng);

    setSaving(true);
    try {
      await eventsService.updateEvent(id, {
        title: formData.title.trim(),
        description: formData.description.trim(),
        category_id: formData.categoryId,
        start_datetime: formData.startDatetime.toISOString(),
        end_datetime: formData.endDatetime.toISOString(),
        address,
        lat,
        lng,
      });
      Alert.alert('Saved', 'Event updated.', [
        { text: 'OK', onPress: () => router.back() },
      ]);
    } catch (err: unknown) {
      Alert.alert(
        'Error',
        err instanceof Error ? err.message : 'Failed to update event'
      );
    } finally {
      setSaving(false);
    }
  };

  const formatDateTime = (d: Date) =>
    d.toLocaleString('en-US', {
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    });

  if (loading) {
    return (
      <View style={styles.centerContainer}>
        <ActivityIndicator size="large" color={Colors.primary} />
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <View style={styles.header}>
        <TouchableOpacity style={styles.backButton} onPress={() => router.back()}>
          <Text style={styles.backText}>Cancel</Text>
        </TouchableOpacity>
        <Text style={styles.title}>Edit Event</Text>
        <TouchableOpacity
          style={styles.saveHeaderButton}
          onPress={handleSubmit}
          disabled={saving}
        >
          {saving ? (
            <ActivityIndicator size="small" color={Colors.primary} />
          ) : (
            <Text style={styles.saveHeaderText}>Save</Text>
          )}
        </TouchableOpacity>
      </View>

      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
      >
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
          onPress={() => {
            if (Platform.OS === 'android') {
              openAndroidPicker(formData.startDatetime, 'start');
            } else {
              setShowStartPicker(true);
            }
          }}
        >
          <Text style={styles.dateButtonText}>
            {formatDateTime(formData.startDatetime)}
          </Text>
        </TouchableOpacity>
        {Platform.OS !== 'android' && showStartPicker && (
          <DateTimePicker
            value={formData.startDatetime}
            mode="datetime"
            display="spinner"
            maximumDate={MAX_EVENT_DATE}
            onChange={(_, d) => {
              setShowStartPicker(false);
              if (d) setFormData((f) => ({ ...f, startDatetime: d }));
            }}
          />
        )}

        <Text style={styles.label}>End</Text>
        <TouchableOpacity
          style={styles.dateButton}
          onPress={() => {
            if (Platform.OS === 'android') {
              openAndroidPicker(formData.endDatetime, 'end');
            } else {
              setShowEndPicker(true);
            }
          }}
        >
          <Text style={styles.dateButtonText}>
            {formatDateTime(formData.endDatetime)}
          </Text>
        </TouchableOpacity>
        {Platform.OS !== 'android' && showEndPicker && (
          <DateTimePicker
            value={formData.endDatetime}
            mode="datetime"
            display="spinner"
            maximumDate={MAX_EVENT_DATE}
            onChange={(_, d) => {
              setShowEndPicker(false);
              if (d) setFormData((f) => ({ ...f, endDatetime: d }));
            }}
          />
        )}
        {errors.endDatetime && (
          <Text style={styles.errorText}>{errors.endDatetime}</Text>
        )}

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
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background.primary,
  },
  centerContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.md,
    paddingTop: Spacing.xxl + 24,
    paddingBottom: Spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border.light,
  },
  backButton: {
    padding: Spacing.sm,
    minWidth: 60,
  },
  backText: {
    fontSize: Typography.sizes.md,
    color: Colors.text.secondary,
  },
  title: {
    fontSize: Typography.sizes.lg,
    fontFamily: Typography.fontFamilies.bold,
    fontWeight: Typography.weights.bold,
    color: Colors.text.primary,
  },
  saveHeaderButton: {
    padding: Spacing.sm,
    minWidth: 60,
    alignItems: 'flex-end',
  },
  saveHeaderText: {
    fontSize: Typography.sizes.md,
    fontFamily: Typography.fontFamilies.semibold,
    fontWeight: Typography.weights.semibold,
    color: Colors.primary,
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    padding: Spacing.xl,
    paddingBottom: Spacing.xxl,
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
    fontSize: Typography.sizes.sm,
    color: Colors.text.primary,
  },
  categoryChipTextSelected: {
    color: Colors.text.inverse,
    fontFamily: Typography.fontFamilies.semibold,
    fontWeight: Typography.weights.semibold,
  },
  dateButton: {
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
});
