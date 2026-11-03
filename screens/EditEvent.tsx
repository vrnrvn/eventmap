import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  ActivityIndicator,
} from 'react-native';
import DateTimePicker, {
  DateTimePickerAndroid,
} from '@react-native-community/datetimepicker';
import { Repeat, ChevronRight, MapPin } from 'lucide-react-native';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useNavigation, usePreventRemove } from '@react-navigation/native';
import { RecurrenceEndRow } from '@/components/RecurrenceEndRow';
import {
  EventLinksEditor,
  normalizeLinkUrl,
  type EventLinkDraft,
} from '@/components/EventLinksEditor';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useApp } from '@/contexts/AppContext';
import { usePremium } from '@/contexts/PremiumContext';
import { Input } from '@/components/Input';
import { Button } from '@/components/ui/Button';
import { ScreenHeader } from '@/components/ui/ScreenHeader';
import { ImagePickerButton, type ImageAsset } from '@/components/ImagePickerButton';
import { WebDateTimeInput } from '@/components/WebDateTimeInput';
import {
  RecurrencePicker,
  getRecurrenceLabel,
  type RecurrencePickerHandle,
} from '@/components/RecurrencePicker';
import { parseRecurrenceEndDate, type RecurrenceOption } from '@/utils/recurrence';
import { notify, notifyConfirm } from '@/utils/notify';
import { confirmAction } from '@/utils/confirm';
import { eventsService } from '@/services/events';
import { eventLocationStore } from '@/stores/eventLocationStore';
import { categoriesService } from '@/services/categories';
import { CategoryIcon } from '@/components/CategoryIcon';
import { Category, Event, EventPhoto } from '@/types/database';
import { Colors, Spacing, Typography, BorderRadius } from '@/constants/theme';
import { withShiftedEnd } from '@/utils/eventDatetime';
import { timeZoneLabel } from '@/utils/formatEventWhen';

const DEFAULT_LOCATION = { lat: 37.7749, lng: -122.4194 };
const MAX_EVENT_DATE = new Date();
MAX_EVENT_DATE.setFullYear(MAX_EVENT_DATE.getFullYear() + 10);

const TITLE_MAX = 100;
const DESCRIPTION_MAX = 2000;

type EventFormData = {
  title: string;
  description: string;
  categoryId: string;
  startDatetime: Date;
  endDatetime: Date;
  address: string;
  lat: number;
  lng: number;
  images: ImageAsset[];
  recurrence: RecurrenceOption;
  maxAttendees: string;
  links: EventLinkDraft[];
};

/** Serialize the form fields that count as "changes" for the unsaved guard. */
const snapshotOf = (f: EventFormData) =>
  JSON.stringify({
    title: f.title,
    description: f.description,
    categoryId: f.categoryId,
    start: f.startDatetime.getTime(),
    end: f.endDatetime.getTime(),
    address: f.address,
    lat: f.lat,
    lng: f.lng,
    images: f.images.map((img) => img.uri),
    recurrence: f.recurrence,
    maxAttendees: f.maxAttendees,
    links: f.links.map((link) => `${link.id ?? ''}|${link.label}|${link.url}`),
  });

export default function EditEvent() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const insets = useSafeAreaInsets();
  const { userBusiness } = useApp();
  const { currentPlan } = usePremium();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<string | null>(null);
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
    links: [] as EventLinkDraft[],
  });
  const [linkErrors, setLinkErrors] = useState<Record<number, string>>({});
  const tzLabel = useMemo(() => timeZoneLabel(), []);
  const recurrencePickerRef = useRef<RecurrencePickerHandle>(null);
  /** Track the original photos loaded from DB to detect removals */
  const originalPhotoIds = useRef<string[]>([]);
  /** Saved sort_order per existing photo, so only moved ones are rewritten. */
  const originalPhotoOrder = useRef<Map<string, number>>(new Map());
  /** Original start time, so saves of other fields aren't blocked for past events */
  const originalStartMs = useRef<number | null>(null);
  const originalHadCap = useRef(false);
  /** The saved row as loaded, so the update only sends fields that changed. */
  const originalEvent = useRef<Event | null>(null);
  /** Current "going" count, to warn before edits that notify attendees. */
  const goingCount = useRef(0);
  const isPremiumBusiness = userBusiness?.subscription_tier === 'premium';

  const [errors, setErrors] = useState<Record<string, string>>({});

  /** Snapshot of the loaded values, used to detect unsaved changes on back. */
  const initialSnapshot = useRef<string | null>(null);
  const isDirty =
    initialSnapshot.current != null && snapshotOf(formData) !== initialSnapshot.current;

  // Unsaved-changes guard for every way off the screen: header back, the
  // Android hardware back and the iOS swipe gesture all dispatch a remove
  // action, which this intercepts while the form is dirty.
  const navigation = useNavigation();
  usePreventRemove(isDirty && !saving, ({ data }) => {
    notifyConfirm({
      title: 'Discard changes?',
      message: 'You have unsaved changes. Go back and lose them?',
      confirmLabel: 'Discard',
      cancelLabel: 'Keep editing',
      destructive: true,
      onConfirm: () => navigation.dispatch(data.action),
    });
  });

  const handleBack = () => router.back();

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
        if (e.status === 'cancelled') {
          // Cancelled events are read-only; attendees were already told it's
          // off, so silent edits would only confuse them.
          notify.error("This event was cancelled and can't be edited.");
          router.back();
          return;
        }
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
        originalPhotoOrder.current = new Map(
          (details.photos || []).map((p: EventPhoto) => [p.id, p.sort_order])
        );
        originalStartMs.current = new Date(e.start_datetime).getTime();
        originalHadCap.current = e.max_attendees != null;
        originalEvent.current = e;
        goingCount.current = details.rsvp_count ?? 0;

        const loaded = {
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
          maxAttendees: e.max_attendees != null ? String(e.max_attendees) : '',
          links: (details.links ?? []).map((link) => ({
            id: link.id,
            label: link.label ?? '',
            url: link.url,
          })),
        };
        setFormData(loaded);
        initialSnapshot.current = snapshotOf(loaded);
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
            ? withShiftedEnd(f, d)
            : { ...f, endDatetime: d }
        );

      DateTimePickerAndroid.open({
        value: currentDate,
        mode: 'date',
        // Don't clamp events whose (unchanged) start is already in the past.
        minimumDate: currentDate.getTime() >= Date.now() ? new Date() : undefined,
        maximumDate: MAX_EVENT_DATE,
        onChange: (dateEvent, dateResult) => {
          if (dateEvent.type !== 'set' || !dateResult) return;
          // Commit the chosen date immediately (keeping the previous time) so
          // cancelling the time step doesn't discard the date.
          const withNewDate = new Date(currentDate);
          withNewDate.setFullYear(
            dateResult.getFullYear(),
            dateResult.getMonth(),
            dateResult.getDate()
          );
          updateField(withNewDate);
          DateTimePickerAndroid.open({
            value: withNewDate,
            mode: 'time',
            onChange: (timeEvent, timeResult) => {
              if (timeEvent.type !== 'set' || !timeResult) return;
              const combined = new Date(withNewDate);
              combined.setHours(
                timeResult.getHours(),
                timeResult.getMinutes(),
                0,
                0
              );
              updateField(combined);
            },
          });
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
    if (formData.recurrence?.endDate) {
      const seriesEnd = parseRecurrenceEndDate(formData.recurrence.endDate);
      const firstDay = new Date(formData.startDatetime);
      firstDay.setHours(0, 0, 0, 0);
      if (seriesEnd && seriesEnd < firstDay) {
        // Server-side event_has_ended would hide the series before it ever ran.
        e.recurrenceEnd = 'The series end date is before the first event';
      }
    }
    const linkIssues: Record<number, string> = {};
    formData.links.forEach((link, index) => {
      if (!link.url.trim() && !link.label.trim()) return;
      if (!normalizeLinkUrl(link.url)) {
        linkIssues[index] = 'Enter a web address like example.com/tickets';
      }
    });
    setLinkErrors(linkIssues);
    if (Object.keys(linkIssues).length > 0) e.links = 'Fix the links below';
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  /**
   * Only the fields that actually differ from the loaded row. Sending the
   * whole row used to trip the "event updated" notification trigger on
   * every save (timestamp precision, trimmed address), pinging attendees
   * about edits that changed nothing they care about.
   */
  const buildUpdates = (): Partial<Event> => {
    const original = originalEvent.current;
    const address = formData.address.trim() || (businessLocation?.address ?? '');
    const lat = formData.address.trim() ? formData.lat : (businessLocation?.lat ?? formData.lat);
    const lng = formData.address.trim() ? formData.lng : (businessLocation?.lng ?? formData.lng);
    const maxAttendeesValue = formData.maxAttendees.trim()
      ? Number(formData.maxAttendees.trim())
      : null;

    const candidate: Partial<Event> = {
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
      max_attendees: maxAttendeesValue,
    };
    if (!original) return candidate;

    const updates: Partial<Event> = {};
    const sameInstant = (a: string, b: string) => new Date(a).getTime() === new Date(b).getTime();
    if (candidate.title !== original.title) updates.title = candidate.title;
    if (candidate.description !== original.description) updates.description = candidate.description;
    if (candidate.category_id !== original.category_id) updates.category_id = candidate.category_id;
    if (!sameInstant(candidate.start_datetime!, original.start_datetime)) {
      updates.start_datetime = candidate.start_datetime;
    }
    if (!sameInstant(candidate.end_datetime!, original.end_datetime)) {
      updates.end_datetime = candidate.end_datetime;
    }
    if (candidate.address !== original.address) updates.address = candidate.address;
    if (candidate.lat !== original.lat) updates.lat = candidate.lat;
    if (candidate.lng !== original.lng) updates.lng = candidate.lng;
    if (candidate.is_recurring !== Boolean(original.is_recurring)) {
      updates.is_recurring = candidate.is_recurring;
    }
    if (JSON.stringify(candidate.recurrence_pattern) !== JSON.stringify(original.recurrence_pattern ?? null)) {
      updates.recurrence_pattern = candidate.recurrence_pattern;
    }
    if ((candidate.max_attendees ?? null) !== (original.max_attendees ?? null)) {
      updates.max_attendees = candidate.max_attendees;
    }
    return updates;
  };

  const handleSubmit = async () => {
    if (!validate() || !id) return;

    const updates = buildUpdates();
    const newCap = updates.max_attendees;
    if (newCap != null && newCap < goingCount.current) {
      const proceed = await confirmAction({
        title: 'Cap below current attendance',
        message: `${goingCount.current} people are already going. Lowering the limit to ${newCap} keeps them in but blocks new joins. Continue?`,
        confirmLabel: 'Set limit',
        cancelLabel: 'Keep editing',
      });
      if (!proceed) return;
    }

    // Time or place changes notify every going/interested attendee (DB
    // trigger). Make sure the host means it before pinging the room.
    const notifies =
      'start_datetime' in updates ||
      'end_datetime' in updates ||
      'address' in updates ||
      'lat' in updates ||
      'lng' in updates;
    if (notifies && goingCount.current > 0) {
      const proceed = await confirmAction({
        title: 'Notify attendees?',
        message: `Changing the time or location sends an "event updated" notification to everyone who's going or interested (${goingCount.current} going). Save anyway?`,
        confirmLabel: 'Save and notify',
        cancelLabel: 'Keep editing',
      });
      if (!proceed) return;
    }

    setSaving(true);
    try {
      // Save the event fields FIRST: if this fails, nothing has been uploaded
      // or deleted, so there are no orphans. Photos are handled afterwards
      // and photo failures are non-fatal.
      if (Object.keys(updates).length > 0) {
        await eventsService.updateEvent(id, updates);
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
      // Photo order is the list order (position 0 = cover): new photos are
      // inserted at their position and existing ones that moved get their
      // sort_order rewritten. Before this, dragging a photo to the front only
      // changed cover_image_url and the gallery order reverted on reload.
      let photoFailures = 0;
      const uploadedByUri = new Map<string, string>();
      const newImages = formData.images.filter((i) => !i.photoId);
      let uploadedSoFar = 0;
      for (const [position, img] of formData.images.entries()) {
        if (img.photoId) {
          if (originalPhotoOrder.current.get(img.photoId) !== position) {
            try {
              await eventsService.updateEventPhotoOrder(img.photoId, position);
            } catch {
              // Non-fatal: order falls back to the saved one.
            }
          }
          continue;
        }
        uploadedSoFar += 1;
        setUploadProgress(`Uploading photo ${uploadedSoFar} of ${newImages.length}…`);
        try {
          const url = await eventsService.uploadEventImage({
            uri: img.uri,
            name: img.name,
            type: img.type,
          });
          await eventsService.addEventPhoto(id, url, position);
          uploadedByUri.set(img.uri, url);
        } catch {
          photoFailures += 1;
        }
      }

      // Cover image: the first photo in the list that actually has a URL, so
      // a failed new upload in slot 0 doesn't null out the cover.
      const coverImageUrl =
        formData.images
          .map((img) => img.remoteUrl || uploadedByUri.get(img.uri) || null)
          .find((url): url is string => !!url) ?? null;
      try {
        await eventsService.updateEvent(id, { cover_image_url: coverImageUrl });
      } catch {
        // Non-fatal.
      }

      let linksFailed = false;
      try {
        const linkRows = formData.links.flatMap((link) => {
          const url = normalizeLinkUrl(link.url);
          return url ? [{ id: link.id, label: link.label.trim() || null, url }] : [];
        });
        linksFailed = !(await eventsService.syncEventLinks(id, linkRows));
      } catch {
        linksFailed = true;
      }

      const warnings: string[] = [];
      if (linksFailed) {
        warnings.push('some links could not be saved.');
      }
      if (photoFailures > 0) {
        warnings.push(
          `${photoFailures} photo(s) failed to upload — you can try again by editing the event.`
        );
      }
      notify.success(
        warnings.length > 0
          ? `Event updated, but ${warnings.join(' Also, ')}`
          : 'Event updated.'
      );
      // Everything is persisted: mark the form clean so the remove guard
      // doesn't ask about "unsaved changes" on the way out.
      initialSnapshot.current = snapshotOf(formData);
      router.back();
    } catch (err: unknown) {
      notify.error(err instanceof Error ? err.message : 'Failed to update event');
    } finally {
      setSaving(false);
      setUploadProgress(null);
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
        onBack={handleBack}
        backgroundColor={Colors.surface}
        style={styles.headerBorder}
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
          maxLength={TITLE_MAX}
          error={errors.title}
        />

        <Input
          label="Description"
          value={formData.description}
          onChangeText={(t) => setFormData((f) => ({ ...f, description: t }))}
          placeholder="Describe your event"
          multiline
          numberOfLines={4}
          maxLength={DESCRIPTION_MAX}
          style={styles.textArea}
          error={errors.description}
          rightAdornment={
            <Text style={styles.charCounter}>
              {formData.description.length}/{DESCRIPTION_MAX}
            </Text>
          }
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

        <Text style={styles.tapHint}>
          {tzLabel
            ? `Times are in your device timezone (${tzLabel}).`
            : 'Times are in your device timezone.'}
        </Text>
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
        {Platform.OS === 'web' && showStartPicker && (
          <View style={styles.webPickerWrap}>
            <WebDateTimeInput
              value={formData.startDatetime}
              minimumDate={
                formData.startDatetime.getTime() >= Date.now() ? new Date() : undefined
              }
              maximumDate={MAX_EVENT_DATE}
              accessibilityLabel="Event start date and time"
              onChange={(d) => setFormData((f) => withShiftedEnd(f, d))}
            />
          </View>
        )}
        {Platform.OS === 'ios' && showStartPicker && (
          <DateTimePicker
            value={formData.startDatetime}
            mode="datetime"
            display="spinner"
            minimumDate={
              formData.startDatetime.getTime() >= Date.now() ? new Date() : undefined
            }
            maximumDate={MAX_EVENT_DATE}
            onChange={(_, d) => {
              if (d) setFormData((f) => withShiftedEnd(f, d));
            }}
          />
        )}
        {Platform.OS !== 'android' && showStartPicker && (
          <TouchableOpacity
            style={styles.pickerDoneButton}
            onPress={() => setShowStartPicker(false)}
            activeOpacity={0.7}
          >
            <Text style={styles.pickerDoneText}>Done</Text>
          </TouchableOpacity>
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
        {Platform.OS === 'web' && showEndPicker && (
          <View style={styles.webPickerWrap}>
            <WebDateTimeInput
              value={formData.endDatetime}
              minimumDate={formData.startDatetime}
              maximumDate={MAX_EVENT_DATE}
              accessibilityLabel="Event end date and time"
              onChange={(d) => setFormData((f) => ({ ...f, endDatetime: d }))}
            />
          </View>
        )}
        {Platform.OS === 'ios' && showEndPicker && (
          <DateTimePicker
            value={formData.endDatetime}
            mode="datetime"
            display="spinner"
            minimumDate={formData.startDatetime}
            maximumDate={MAX_EVENT_DATE}
            onChange={(_, d) => {
              if (d) setFormData((f) => ({ ...f, endDatetime: d }));
            }}
          />
        )}
        {Platform.OS !== 'android' && showEndPicker && (
          <TouchableOpacity
            style={styles.pickerDoneButton}
            onPress={() => setShowEndPicker(false)}
            activeOpacity={0.7}
          >
            <Text style={styles.pickerDoneText}>Done</Text>
          </TouchableOpacity>
        )}
        {errors.endDatetime && (
          <Text style={styles.errorText}>{errors.endDatetime}</Text>
        )}

        {/* Recurrence (Premium only) */}
        <Text style={styles.label}>Repeat</Text>
        <TouchableOpacity
          style={styles.dateButton}
          onPress={() => {
            // A lapsed-premium host can still open the picker to turn an
            // existing series off (the picker then only enables "None").
            if (!isPremiumBusiness && formData.recurrence == null) {
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
              </Text>
            </View>
            {!isPremiumBusiness && (
              <View style={styles.premiumBadge}>
                <Text style={styles.premiumBadgeText}>Premium</Text>
              </View>
            )}
            <ChevronRight size={18} color={Colors.text.tertiary} />
          </View>
        </TouchableOpacity>
        {formData.recurrence ? (
          <RecurrenceEndRow
            variant="flat"
            pattern={formData.recurrence}
            seriesStart={formData.startDatetime}
            onChange={(next) => setFormData((f) => ({ ...f, recurrence: next }))}
          />
        ) : null}
        {errors.recurrenceEnd && (
          <Text style={styles.errorText}>{errors.recurrenceEnd}</Text>
        )}

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

        <Text style={styles.label}>Links</Text>
        <EventLinksEditor
          links={formData.links}
          errors={linkErrors}
          onChange={(links) => {
                  setLinkErrors({});
                  setFormData((f) => ({ ...f, links }));
                }}
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
        </TouchableOpacity>
        <RecurrencePicker
          ref={recurrencePickerRef}
          selectedValue={formData.recurrence}
          noneOnly={!isPremiumBusiness}
          onSelect={(v) =>
            setFormData((f) => ({
              ...f,
              // Changing the cadence keeps any end date already chosen.
              recurrence: v ? { ...v, ...(f.recurrence?.endDate ? { endDate: f.recurrence.endDate } : {}) } : null,
            }))
          }
        />
      </ScrollView>

      <View style={[styles.footer, { paddingBottom: Math.max(insets.bottom, Spacing.md) }]}>
        <Button
          label={uploadProgress ?? 'Save changes'}
          onPress={handleSubmit}
          gradient
          size="lg"
          fullWidth
          loading={saving}
        />
      </View>
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
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: Spacing.md,
    paddingTop: Spacing.xl,
    paddingBottom: Spacing.xxl,
  },
  footer: {
    paddingHorizontal: Spacing.md,
    paddingTop: Spacing.sm,
    backgroundColor: Colors.surface,
    borderTopWidth: 1,
    borderTopColor: Colors.border.light,
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
  charCounter: {
    fontSize: Typography.sizes.xs,
    color: Colors.text.tertiary,
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
    fontFamily: Typography.fontFamilies.regular,
    color: Colors.text.primary,
  },
  categoryChipTextSelected: {
    color: Colors.text.inverse,
    fontFamily: Typography.fontFamilies.semibold,
    fontWeight: Typography.weights.semibold,
  },
  dateButton: {
    backgroundColor: Colors.background.secondary,
    borderRadius: BorderRadius.md,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm + 4,
    marginBottom: Spacing.md,
  },
  dateButtonText: {
    fontSize: Typography.sizes.md,
    fontFamily: Typography.fontFamilies.regular,
    color: Colors.text.primary,
  },
  webPickerWrap: {
    marginBottom: Spacing.sm,
  },
  pickerDoneButton: {
    alignSelf: 'center',
    paddingHorizontal: Spacing.xl,
    paddingVertical: 10,
    backgroundColor: Colors.primarySoft,
    borderRadius: BorderRadius.md,
    marginTop: Spacing.xs,
    marginBottom: Spacing.sm,
  },
  pickerDoneText: {
    fontSize: Typography.sizes.md,
    fontFamily: Typography.fontFamilies.semibold,
    fontWeight: Typography.weights.semibold,
    color: Colors.primary,
  },
  recurrenceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
  },
  recurrenceTextWrap: {
    flex: 1,
  },
  premiumBadge: {
    backgroundColor: Colors.premiumSoft,
    borderRadius: BorderRadius.round,
    paddingHorizontal: Spacing.sm,
    paddingVertical: Spacing.xs / 2,
  },
  premiumBadgeText: {
    fontSize: Typography.sizes.xxs,
    fontFamily: Typography.labelFontFamilies.semibold,
    fontWeight: Typography.weights.semibold,
    color: Colors.premium,
  },
  errorText: {
    fontSize: Typography.sizes.xs,
    fontFamily: Typography.fontFamilies.regular,
    color: Colors.error,
    marginTop: -Spacing.sm,
    marginBottom: Spacing.sm,
  },
  tapHint: {
    fontSize: Typography.sizes.sm,
    fontFamily: Typography.fontFamilies.regular,
    color: Colors.text.secondary,
    marginBottom: Spacing.sm,
  },
  addressTouchable: {
    backgroundColor: Colors.background.secondary,
    borderRadius: BorderRadius.md,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm + 4,
    marginBottom: Spacing.md,
  },
  addressTouchableRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: Spacing.sm,
  },
  addressTouchableText: {
    fontSize: Typography.sizes.md,
    fontFamily: Typography.fontFamilies.regular,
    color: Colors.text.primary,
    flex: 1,
  },
  addressPlaceholder: {
    color: Colors.text.tertiary,
  },
});
