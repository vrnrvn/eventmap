import { useState, useEffect, useCallback, useRef } from 'react';
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
import { Repeat, ChevronRight, MapPin } from 'lucide-react-native';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useApp } from '@/contexts/AppContext';
import { usePremium } from '@/contexts/PremiumContext';
import { Input } from '@/components/Input';
import { ScreenHeader } from '@/components/ui/ScreenHeader';
import { ImagePickerButton, type ImageAsset } from '@/components/ImagePickerButton';
import {
  RecurrencePicker,
  getRecurrenceLabel,
  type RecurrencePickerHandle,
} from '@/components/RecurrencePicker';
import type { RecurrenceOption } from '@/utils/recurrence';
import { notify, notifyConfirm } from '@/utils/notify';
import { eventsService } from '@/services/events';
import { eventLocationStore } from '@/stores/eventLocationStore';
import { categoriesService } from '@/services/categories';
import { CategoryIcon } from '@/components/CategoryIcon';
import { Category, EventPhoto } from '@/types/database';
import { Colors, Spacing, Typography, BorderRadius } from '@/constants/theme';

const DEFAULT_LOCATION = { lat: 37.7749, lng: -122.4194 };
const MAX_EVENT_DATE = new Date();
MAX_EVENT_DATE.setFullYear(MAX_EVENT_DATE.getFullYear() + 10);

export default function EditEvent() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { userBusiness } = useApp();
  const { currentPlan } = usePremium();
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
    images: [] as ImageAsset[],
    recurrence: null as RecurrenceOption,
    maxAttendees: '',
  });
  const recurrencePickerRef = useRef<RecurrencePickerHandle>(null);
  /** Track the original photos loaded from DB to detect removals */
  const originalPhotoIds = useRef<string[]>([]);
  /** Original start time, so saves of other fields aren't blocked for past events */
  const originalStartMs = useRef<number | null>(null);
  const originalHadCap = useRef(false);

  const [errors, setErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    categoriesService.getAllCategories().then(setCategories);
  }, []);

  // Location is select-only: it can only change via the /business-location
  // picker (suggestion pick or map tap), which hands the committed result
  // back through eventLocationStore. Free-typed text can never desync the
  // address from the saved coordinates.
  useFocusEffect(
    useCallback(() => {
      const loc = eventLocationStore.consume();
      if (loc) {
        setFormData((f) => ({
          ...f,
          address: loc.formattedAddress,
          lat: loc.lat,
          lng: loc.lng,
        }));
      }
    }, [])
  );

  useEffect(() => {
    if (!id) return;
    const load = async () => {
      try {
        const details = await eventsService.getEventDetails(id);
        if (!details?.event) {
          notify.error('Event not found');
          router.back();
          return;
        }
        const e = details.event;
        const existingImages: ImageAsset[] = (details.photos || [])
          .sort((a: EventPhoto, b: EventPhoto) => a.sort_order - b.sort_order)
          .map((p: EventPhoto) => ({
            uri: p.image_url,
            name: `existing-${p.id}`,
            type: 'image/jpeg',
            remoteUrl: p.image_url,
            photoId: p.id,
          }));
        originalPhotoIds.current = existingImages
          .map((img) => img.photoId)
          .filter(Boolean) as string[];
        originalStartMs.current = new Date(e.start_datetime).getTime();
        originalHadCap.current =
          (e as { max_attendees?: number | null }).max_attendees != null;

        setFormData({
          title: e.title,
          description: e.description,
          categoryId: e.category_id,
          startDatetime: new Date(e.start_datetime),
          endDatetime: new Date(e.end_datetime),
          address: e.address,
          lat: e.lat,
          lng: e.lng,
          images: existingImages,
          recurrence: e.is_recurring && e.recurrence_pattern ? e.recurrence_pattern : null,
          // Tolerant: max_attendees only exists once 20261030108000 is applied.
          maxAttendees:
            (e as { max_attendees?: number | null }).max_attendees != null
              ? String((e as { max_attendees?: number | null }).max_attendees)
              : '',
        });
      } catch {
        notify.error('Failed to load event');
        router.back();
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
        // Don't clamp events whose (unchanged) start is already in the past.
        minimumDate: currentDate.getTime() >= Date.now() ? new Date() : undefined,
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
    // Only enforce a future start when the start was actually changed, so an
    // event that already started can still have its other fields edited.
    const startChanged =
      originalStartMs.current == null ||
      formData.startDatetime.getTime() !== originalStartMs.current;
    if (startChanged && formData.startDatetime.getTime() <= Date.now()) {
      e.startDatetime = 'Start must be in the future';
    }
    if (formData.endDatetime <= formData.startDatetime) {
      e.endDatetime = 'End must be after start';
    }
    if (formData.maxAttendees.trim()) {
      const n = Number(formData.maxAttendees.trim());
      if (!Number.isInteger(n) || n <= 0) {
        e.maxAttendees = 'Enter a whole number greater than 0';
      }
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
      // Save the event fields FIRST: if this fails, nothing has been uploaded
      // or deleted, so there are no orphans. Photos are handled afterwards
      // and photo failures are non-fatal.
      const maxAttendeesValue = formData.maxAttendees.trim()
        ? Number(formData.maxAttendees.trim())
        : null;
      const updates: Record<string, unknown> = {
        title: formData.title.trim(),
        description: formData.description.trim(),
        category_id: formData.categoryId,
        start_datetime: formData.startDatetime.toISOString(),
        end_datetime: formData.endDatetime.toISOString(),
        address,
        lat,
        lng,
        is_recurring: formData.recurrence != null,
        recurrence_pattern: formData.recurrence ?? null,
      };
      // Include max_attendees when the user set a value, or when the event
      // previously had a cap and the field was cleared (send null to remove
      // it); the column only exists once 20261030108000 is applied.
      if (maxAttendeesValue != null || originalHadCap.current) {
        updates.max_attendees = maxAttendeesValue;
      }

      let capacityUnavailable = false;
      try {
        await eventsService.updateEvent(id, updates as never);
      } catch (updErr: unknown) {
        const code = (updErr as { code?: string })?.code;
        // TODO: remove retry once 20261030108000 is applied
        if (
          'max_attendees' in updates &&
          (code === '42703' || code === 'PGRST204')
        ) {
          delete updates.max_attendees;
          await eventsService.updateEvent(id, updates as never);
          capacityUnavailable = true;
        } else {
          throw updErr;
        }
      }

      // Detect removed photos and delete them (non-fatal)
      const currentPhotoIds = formData.images
        .map((img) => img.photoId)
        .filter(Boolean) as string[];
      const removedIds = originalPhotoIds.current.filter(
        (pid) => !currentPhotoIds.includes(pid)
      );
      for (const pid of removedIds) {
        try {
          await eventsService.deleteEventPhoto(pid);
        } catch {
          // Non-fatal: the photo just stays attached.
        }
      }

      // Upload + attach new images (no photoId means it's new); keep the
      // successes even if some fail.
      let photoFailures = 0;
      const uploadedByUri = new Map<string, string>();
      const existingCount = formData.images.filter((i) => i.photoId).length;
      for (const img of formData.images) {
        if (img.photoId) continue;
        try {
          const url = await eventsService.uploadEventImage({
            uri: img.uri,
            name: img.name,
            type: img.type,
          });
          await eventsService.addEventPhoto(
            id,
            url,
            existingCount + uploadedByUri.size
          );
          uploadedByUri.set(img.uri, url);
        } catch {
          photoFailures += 1;
        }
      }

      // Cover image: first image in the list (existing URL or a successful
      // upload); non-fatal if it can't be written.
      const firstImage = formData.images[0];
      const coverImageUrl = firstImage
        ? firstImage.remoteUrl || uploadedByUri.get(firstImage.uri) || null
        : null;
      try {
        await eventsService.updateEvent(id, { cover_image_url: coverImageUrl });
      } catch {
        // Non-fatal.
      }

      const warnings: string[] = [];
      if (photoFailures > 0) {
        warnings.push(
          `${photoFailures} photo(s) failed to upload — you can try again by editing the event.`
        );
      }
      if (capacityUnavailable) {
        warnings.push(
          'Attendee capacity is not enabled yet, so the limit was not saved.'
        );
      }
      notify.success(
        warnings.length > 0
          ? `Event updated, but ${warnings.join(' Also, ')}`
          : 'Event updated.'
      );
      router.back();
    } catch (err: unknown) {
      notify.error(err instanceof Error ? err.message : 'Failed to update event');
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
      <ScreenHeader
        title="Edit Event"
        backgroundColor={Colors.surface}
        style={styles.headerBorder}
        right={
          <TouchableOpacity
            style={styles.saveHeaderButton}
            onPress={handleSubmit}
            disabled={saving}
            accessibilityRole="button"
            accessibilityLabel="Save event"
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            {saving ? (
              <ActivityIndicator size="small" color={Colors.primary} />
            ) : (
              <Text style={styles.saveHeaderText}>Save</Text>
            )}
          </TouchableOpacity>
        }
      />

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
              <CategoryIcon category={c.slug} size="sm" variant="pill" />
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
            minimumDate={
              formData.startDatetime.getTime() >= Date.now() ? new Date() : undefined
            }
            maximumDate={MAX_EVENT_DATE}
            onChange={(_, d) => {
              setShowStartPicker(false);
              if (d) setFormData((f) => ({ ...f, startDatetime: d }));
            }}
          />
        )}
        {errors.startDatetime && (
          <Text style={styles.errorText}>{errors.startDatetime}</Text>
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

        {/* Recurrence (Premium only) */}
        <Text style={styles.label}>Repeat</Text>
        <TouchableOpacity
          style={styles.dateButton}
          onPress={() => {
            if (userBusiness?.subscription_tier !== 'premium') {
              notifyConfirm({
                title: 'Premium Feature',
                message:
                  'Recurring events are only available for Premium businesses. Upgrade to create recurring events.',
                cancelLabel: 'OK',
                confirmLabel: 'Upgrade',
                onConfirm: () => router.push('/premium/plans' as never),
              });
              return;
            }
            recurrencePickerRef.current?.present();
          }}
        >
          <View style={styles.recurrenceRow}>
            <Repeat size={18} color={Colors.primary} />
            <View style={styles.recurrenceTextWrap}>
              <Text style={styles.dateButtonText}>
                {getRecurrenceLabel(formData.recurrence)}
                {userBusiness?.subscription_tier !== 'premium' && ' (Premium)'}
              </Text>
            </View>
            <ChevronRight size={18} color={Colors.text.tertiary} />
          </View>
        </TouchableOpacity>

        <Input
          label="Max attendees (optional)"
          value={formData.maxAttendees}
          onChangeText={(t) =>
            setFormData((f) => ({
              ...f,
              maxAttendees: t.replace(/[^0-9]/g, ''),
            }))
          }
          placeholder="Unlimited"
          keyboardType="number-pad"
          error={errors.maxAttendees}
        />

        <Text style={styles.label}>Photos</Text>
        <Text style={styles.tapHint}>First image becomes the cover photo</Text>
        <ImagePickerButton
          images={formData.images}
          onChange={(imgs) => setFormData((f) => ({ ...f, images: imgs }))}
          maxImages={currentPlan?.max_photos_per_event ?? 5}
        />

        <Text style={styles.label}>Location (optional – defaults to business address)</Text>
        <Text style={styles.tapHint}>
          Pick the address from suggestions or tap the map
        </Text>
        <TouchableOpacity
          style={styles.addressTouchable}
          onPress={() =>
            router.push({
              pathname: '/business-location',
              params: {
                context: 'event',
                address: formData.address ?? '',
                lat: String(formData.lat),
                lng: String(formData.lng),
              },
            })
          }
          activeOpacity={0.7}
          accessibilityRole="button"
          accessibilityLabel="Set event location"
        >
          <View style={styles.addressTouchableRow}>
            <MapPin size={18} color={Colors.text.tertiary} />
            <Text
              style={[
                styles.addressTouchableText,
                !formData.address?.trim() && styles.addressPlaceholder,
              ]}
              numberOfLines={2}
            >
              {formData.address?.trim()
                ? formData.address
                : 'Tap to set venue on map'}
            </Text>
          </View>
          {!!formData.address?.trim() && (
            <Text style={styles.addressCoords}>
              {formData.lat.toFixed(4)}, {formData.lng.toFixed(4)}
            </Text>
          )}
        </TouchableOpacity>
        <RecurrencePicker
          ref={recurrencePickerRef}
          selectedValue={formData.recurrence}
          onSelect={(v) => setFormData((f) => ({ ...f, recurrence: v }))}
        />
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
  headerBorder: {
    borderBottomWidth: 1,
    borderBottomColor: Colors.border.light,
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
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
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
  recurrenceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
  },
  recurrenceTextWrap: {
    flex: 1,
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
  addressTouchable: {
    borderWidth: 1,
    borderColor: Colors.border.light,
    borderRadius: BorderRadius.md,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm + 4,
    backgroundColor: Colors.background.primary,
    marginBottom: Spacing.md,
  },
  addressTouchableRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: Spacing.sm,
  },
  addressTouchableText: {
    fontSize: Typography.sizes.md,
    color: Colors.text.primary,
    flex: 1,
  },
  addressPlaceholder: {
    color: Colors.text.tertiary,
  },
  addressCoords: {
    fontSize: Typography.sizes.xs,
    fontFamily: Typography.fontFamily,
    color: Colors.text.tertiary,
    marginTop: 4,
  },
});
