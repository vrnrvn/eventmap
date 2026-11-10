import { useState, useEffect, useCallback, useRef } from 'react';
import { blockedOffline } from '@/utils/requireOnline';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useAuth } from '@/contexts/AuthContext';
import { useFormDraft } from '@/hooks/useFormDraft';
import { draftKeys, parseDraft } from '@/utils/formDraft';
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
import { Repeat, ChevronRight, MapPin } from '@/components/icons.generated';
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
import { eventsService, extrasToUpdates } from '@/services/events';
import { hostToolsService, isCapacityBelowAttendanceError, isRescheduleRequiredError } from '@/services/hostTools';
import {
  EventExtrasFields,
  EMPTY_EXTRAS,
  validateExtras,
  type EventExtrasDraft,
} from '@/components/EventExtrasFields';
import { eventLocationStore } from '@/stores/eventLocationStore';
import { useCategories } from '@/hooks/useCategories';
import { CategorySelectGrid } from '@/components/CategorySelectGrid';
import { recurrenceErrorMessage } from '@/utils/rpcErrors';
import { Event, EventPhoto } from '@/types/database';
import { Colors, Spacing, Typography, BorderRadius } from '@/constants/theme';
import { withShiftedEnd } from '@/utils/eventDatetime';
import {
  getDeviceTimeZone,
  instantToPickerDate,
  pickerDateToInstant,
  zoneDisplayLabel,
} from '@/utils/timezone';
import { TimeZonePicker } from '@/components/TimeZonePicker';
import { a11yState, announce } from '@/utils/accessibility';
import { validationSummary } from '@/utils/validationSummary';

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
  /**
   * Zone the dates above are expressed in. null = legacy event with no stored
   * zone: dates are edited in the device zone and saving leaves it unset
   * unless the host picks one.
   */
  timezone: string | null;
  /** Phase 3 detail fields (20261103150000). */
  extras: EventExtrasDraft;
};

/** Zone used to convert picker dates to instants (device zone for legacy events). */
const effectiveZone = (f: Pick<EventFormData, 'timezone'>) => f.timezone ?? getDeviceTimeZone();

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
    timezone: f.timezone,
    extras: f.extras,
  });

export default function EditEvent() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const insets = useSafeAreaInsets();
  const { userBusiness } = useApp();
  const { user } = useAuth();
  const { currentPlan } = usePremium();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<string | null>(null);
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
    timezone: null as string | null,
    extras: EMPTY_EXTRAS,
  });
  const [linkErrors, setLinkErrors] = useState<Record<number, string>>({});
  const [extrasErrors, setExtrasErrors] = useState<Partial<Record<keyof EventExtrasDraft, string>>>({});
  const [showExtras, setShowExtras] = useState(false);
  const [tzPickerOpen, setTzPickerOpen] = useState(false);
  const recurrencePickerRef = useRef<RecurrencePickerHandle>(null);
  /** Track the original photos loaded from DB to detect removals */
  const originalPhotoIds = useRef<string[]>([]);
  /** Saved sort_order per existing photo, so only moved ones are rewritten. */
  const originalPhotoOrder = useRef<Map<string, number>>(new Map());
  /** Original start time, so saves of other fields aren't blocked for past events */
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

  // Local draft of unsaved edits (docs/OFFLINE_PLAN.md §3.7), tied to the
  // event version it was made from so it's never restored over newer edits.
  const [draftBase, setDraftBase] = useState<string | null>(null);
  const [draftReady, setDraftReady] = useState(false);
  const { clearDraft } = useFormDraft(user && id ? draftKeys.editEvent(user.id, id) : null, formData, {
    shouldSave: isDirty,
    ready: draftReady,
    base: draftBase,
  });

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
      onConfirm: () => {
        clearDraft();
        navigation.dispatch(data.action);
      },
    });
  });

  const handleBack = () => router.back();

  // Categories are required to publish. They come from the shared cached
  // query (available offline once loaded); with nothing loaded, a failed
  // load offers a retry instead of leaving an empty picker.
  const { categories, isError: categoriesFailed, refetch: refetchCategories } = useCategories();
  useEffect(() => {
    if (!categoriesFailed || categories.length > 0) return;
    notify.error("Couldn't load categories.", { label: 'Retry', onPress: () => void refetchCategories() });
  }, [categoriesFailed, categories.length, refetchCategories]);

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
        const loadedZone = e.timezone ?? null;
        const zoneForPicker = loadedZone ?? getDeviceTimeZone();
        originalHadCap.current = e.max_attendees != null;
        originalEvent.current = e;
        goingCount.current = details.rsvp_count ?? 0;

        const loaded = {
          title: e.title,
          description: e.description,
          categoryId: e.category_id,
          startDatetime: instantToPickerDate(new Date(e.start_datetime), zoneForPicker),
          endDatetime: instantToPickerDate(new Date(e.end_datetime), zoneForPicker),
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
          timezone: loadedZone,
          extras: {
            visibility: e.visibility ?? 'public',
            ticketUrl: e.ticket_url ?? '',
            priceLabel: e.price_label ?? '',
            ageRestriction: e.age_restriction ?? 'none',
            accessibilityNotes: e.accessibility_notes ?? '',
            whatToBring: e.what_to_bring ?? '',
          },
        };
        // Open the section when anything in it is already filled in.
        setShowExtras(
          !!(e.ticket_url || e.price_label || e.accessibility_notes || e.what_to_bring) ||
            e.visibility === 'unlisted' ||
            (e.age_restriction ?? 'none') !== 'none'
        );
        setFormData(loaded);
        initialSnapshot.current = snapshotOf(loaded);
        // Unsaved edits from an earlier visit to this same version of the
        // event (a failed save, a dropped connection, a killed app).
        setDraftBase(e.updated_at ?? null);
        const draft = parseDraft<EventFormData>(
          user ? await AsyncStorage.getItem(draftKeys.editEvent(user.id, id)).catch(() => null) : null,
          e.updated_at ?? null
        );
        if (draft && draft.startDatetime instanceof Date && draft.endDatetime instanceof Date) {
          setFormData({ ...loaded, ...draft, extras: { ...loaded.extras, ...draft.extras } });
          notify.withAction('Restored your unsaved changes.', {
            label: 'Discard',
            onPress: () => {
              clearDraft();
              setFormData(loaded);
            },
          });
        }
        setDraftReady(true);
      } catch {
        notify.error('Failed to load event');
        router.back();
      } finally {
        setLoading(false);
      }
    };
    load();
    // Loads once per event; the signed-in user can't change on this screen
    // and clearDraft is only called later, from the toast action.
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
    // Only enforce a future start when the start INSTANT actually changed, so
    // an event that already started can still have its other fields edited.
    // Compared as instants: changing only the time zone keeps the picker value
    // but moves the real start.
    const candidateStartMs = pickerDateToInstant(formData.startDatetime, effectiveZone(formData)).getTime();
    const originalInstantMs = originalEvent.current
      ? new Date(originalEvent.current.start_datetime).getTime()
      : null;
    const startChanged = originalInstantMs == null || candidateStartMs !== originalInstantMs;
    if (startChanged && candidateStartMs <= Date.now()) {
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
    const extraIssues = validateExtras(formData.extras);
    setExtrasErrors(extraIssues);
    if (Object.keys(extraIssues).length > 0) {
      e.extras = 'Check the fields under More options';
      setShowExtras(true);
    }
    setErrors(e);
    // Screen readers otherwise hear nothing when Save is refused.
    if (Object.keys(e).length > 0) announce(validationSummary(e));
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

    const zone = effectiveZone(formData);
    const candidate: Partial<Event> = {
      title: formData.title.trim(),
      description: formData.description.trim(),
      category_id: formData.categoryId,
      start_datetime: pickerDateToInstant(formData.startDatetime, zone).toISOString(),
      end_datetime: pickerDateToInstant(formData.endDatetime, zone).toISOString(),
      timezone: formData.timezone,
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
    // Only send the column when the host actually set/changed a zone: the
    // column may not exist yet (unapplied 20261103140000) and a legacy event
    // must stay untouched when nothing else about its zone changed.
    if ((candidate.timezone ?? null) !== (original.timezone ?? null)) {
      updates.timezone = candidate.timezone;
    }
    // Detail fields: send only what changed (columns may not exist yet).
    const extraUpdates = extrasToUpdates(formData.extras);
    const orig = original as Partial<Event>;
    if (extraUpdates.visibility !== undefined && extraUpdates.visibility !== (orig.visibility ?? 'public')) updates.visibility = extraUpdates.visibility;
    if (extraUpdates.age_restriction !== undefined && extraUpdates.age_restriction !== (orig.age_restriction ?? 'none')) updates.age_restriction = extraUpdates.age_restriction;
    if (extraUpdates.ticket_url !== undefined && (extraUpdates.ticket_url ?? null) !== (orig.ticket_url ?? null)) updates.ticket_url = extraUpdates.ticket_url;
    if (extraUpdates.price_label !== undefined && (extraUpdates.price_label ?? null) !== (orig.price_label ?? null)) updates.price_label = extraUpdates.price_label;
    if (extraUpdates.accessibility_notes !== undefined && (extraUpdates.accessibility_notes ?? null) !== (orig.accessibility_notes ?? null)) updates.accessibility_notes = extraUpdates.accessibility_notes;
    if (extraUpdates.what_to_bring !== undefined && (extraUpdates.what_to_bring ?? null) !== (orig.what_to_bring ?? null)) updates.what_to_bring = extraUpdates.what_to_bring;
    return updates;
  };

  const handleSubmit = async () => {
    if (blockedOffline("save your changes. They're kept on this device")) return;
    if (!validate() || !id) return;

    const updates = buildUpdates();
    const newCap = updates.max_attendees;
    // A plain UPDATE that lowers the cap below attendance is refused by the
    // server (guard_event_capacity_shrink); after the host confirms here the
    // change goes through the explicit host_set_event_capacity RPC instead.
    let confirmedLowerCap: number | null | undefined;
    if (newCap != null && newCap < goingCount.current) {
      const proceed = await confirmAction({
        title: 'Cap below current attendance',
        message: `${goingCount.current} people are already going. Lowering the limit to ${newCap} keeps them in but blocks new joins. Continue?`,
        confirmLabel: 'Set limit',
        cancelLabel: 'Keep editing',
      });
      if (!proceed) return;
      confirmedLowerCap = newCap;
      delete updates.max_attendees;
    }

    // Time or place changes once people are going go through reschedule_event
    // (the server refuses a plain update with `reschedule_required`): one
    // "Event rescheduled" notice instead of the generic "updated" one, and a
    // postponed event resumes. Make sure the host means it first.
    const placeChanged = 'address' in updates || 'lat' in updates || 'lng' in updates;
    const timePlaceChanged = 'start_datetime' in updates || 'end_datetime' in updates || placeChanged;
    const isPostponed = originalEvent.current?.status === 'postponed';
    let viaReschedule = false;
    // reschedule_event notifies going, interested and savers, so the prompt
    // can't be gated on the going count alone (details only carry that one).
    // Drafts have no audience yet and save silently.
    const isDraft = originalEvent.current?.publish_state === 'draft';
    if (timePlaceChanged && (isPostponed || !isDraft)) {
      const going = goingCount.current;
      const proceed = await confirmAction({
        title: isPostponed ? 'Set the new date?' : 'Notify attendees?',
        message: isPostponed
          ? 'This reopens joining and tells everyone the event is back on at the new time.'
          : `Changing the time or location sends a "rescheduled" notification to everyone who's going, interested or has saved this event${going > 0 ? ` (${going} going)` : ''}. Save anyway?`,
        confirmLabel: isPostponed ? 'Set date' : 'Save and notify',
        cancelLabel: 'Keep editing',
      });
      if (!proceed) return;
      viaReschedule = true;
    }

    setSaving(true);
    try {
      // Save the event fields FIRST: if this fails, nothing has been uploaded
      // or deleted, so there are no orphans. Photos are handled afterwards
      // and photo failures are non-fatal.
      // Each step that succeeds is folded into originalEvent (the saved row
      // every save diffs against), so if a later step fails, saving again
      // only resends what's still missing: no second "rescheduled" notice.
      if (viaReschedule) {
        const zone = effectiveZone(formData);
        const reschedule = {
          startIso: pickerDateToInstant(formData.startDatetime, zone).toISOString(),
          endIso: pickerDateToInstant(formData.endDatetime, zone).toISOString(),
          address: placeChanged ? (updates.address ?? originalEvent.current?.address ?? null) : null,
          lat: placeChanged ? (updates.lat ?? originalEvent.current?.lat ?? null) : null,
          lng: placeChanged ? (updates.lng ?? originalEvent.current?.lng ?? null) : null,
        };
        await hostToolsService.rescheduleEvent(id, reschedule);
        if (originalEvent.current) {
          const orig = originalEvent.current;
          originalEvent.current = {
            ...orig,
            start_datetime: reschedule.startIso,
            end_datetime: reschedule.endIso,
            ...(placeChanged
              ? { address: reschedule.address ?? orig.address, lat: reschedule.lat ?? orig.lat, lng: reschedule.lng ?? orig.lng }
              : null),
            // reschedule_event resumes a postponed event.
            status: orig.status === 'postponed' ? 'active' : orig.status,
          };
        }
        delete updates.start_datetime;
        delete updates.end_datetime;
        delete updates.address;
        delete updates.lat;
        delete updates.lng;
      }
      if (Object.keys(updates).length > 0) {
        await eventsService.updateEvent(id, updates);
        if (originalEvent.current) originalEvent.current = { ...originalEvent.current, ...updates };
      }
      if (confirmedLowerCap !== undefined) {
        await hostToolsService.setCapacity(id, confirmedLowerCap);
        if (originalEvent.current) originalEvent.current = { ...originalEvent.current, max_attendees: confirmedLowerCap };
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
      clearDraft();
      router.back();
    } catch (err: unknown) {
      // The going count moved under us (someone joined since the screen
      // loaded) and the server refused to strand them.
      if (isCapacityBelowAttendanceError(err)) {
        notify.error('More people are going than the new limit allows. Reload the event and confirm again.');
        return;
      }
      if (isRescheduleRequiredError(err)) {
        notify.error('Someone joined while you were editing. Reload and save again to reschedule them properly.');
        return;
      }
      notify.error(recurrenceErrorMessage(err) ?? (err instanceof Error ? err.message : 'Failed to update event'));
    } finally {
      setSaving(false);
      setUploadProgress(null);
    }
  };

  const formatDateTime = (d: Date) =>
    d.toLocaleString(undefined, {
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
        <View style={styles.categoriesGridWrap}>
          <CategorySelectGrid
            categories={categories}
            selectedId={formData.categoryId}
            onSelect={(id) => setFormData((f) => ({ ...f, categoryId: id }))}
            title={formData.title}
            description={formData.description}
          />
        </View>
        {errors.categoryId && (
          <Text style={styles.errorText}>{errors.categoryId}</Text>
        )}

        <Text style={styles.label}>Time zone</Text>
        <TouchableOpacity
          style={styles.dateButton}
          onPress={() => setTzPickerOpen(true)}
          accessibilityRole="button"
          accessibilityLabel={
            formData.timezone
              ? `Time zone: ${zoneDisplayLabel(formData.timezone, formData.startDatetime)}. Change`
              : 'Time zone not set. Choose one'
          }
        >
          <Text style={styles.dateButtonText}>
            {formData.timezone
              ? zoneDisplayLabel(formData.timezone, formData.startDatetime)
              : `Not set · yours is ${zoneDisplayLabel(getDeviceTimeZone(), formData.startDatetime)}`}
          </Text>
          <ChevronRight size={18} color={Colors.text.tertiary} />
        </TouchableOpacity>
        <Text style={styles.tapHint}>
          {formData.timezone
            ? 'Start and end below are entered in this zone.'
            : 'Set the zone so attendees elsewhere see the right local time. Until then times are in your device zone.'}
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
                {getRecurrenceLabel(formData.recurrence, formData.startDatetime)}
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
          <Text style={styles.seriesScopeHint}>
            Changes here apply to every upcoming date. To change one date, or a date and everything after it,{' '}
            <Text
              style={styles.seriesScopeLink}
              onPress={() => router.push(`/business/manage-event/${id}` as never)}
              accessibilityRole="link"
            >
              open Upcoming dates
            </Text>
            .
          </Text>
        ) : null}
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

        <TouchableOpacity
          style={styles.dateButton}
          onPress={() => setShowExtras((v) => !v)}
          accessibilityRole="button"
          {...a11yState({ expanded: showExtras })}
          accessibilityLabel="More options: visibility, tickets, age, accessibility"
        >
          <Text style={styles.dateButtonText}>More options</Text>
          <ChevronRight
            size={18}
            color={Colors.text.tertiary}
            style={showExtras ? { transform: [{ rotate: '90deg' }] } : undefined}
          />
        </TouchableOpacity>
        {showExtras ? (
          <EventExtrasFields
            value={formData.extras}
            errors={extrasErrors}
            onChange={(extras) => {
              setExtrasErrors({});
              setFormData((f) => ({ ...f, extras }));
            }}
          />
        ) : null}
        {errors.extras ? <Text style={styles.errorText}>{errors.extras}</Text> : null}

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
        <TimeZonePicker
        visible={tzPickerOpen}
        value={formData.timezone ?? getDeviceTimeZone()}
        referenceDate={formData.startDatetime}
        onSelect={(tz) => setFormData((f) => ({ ...f, timezone: tz }))}
        onClose={() => setTzPickerOpen(false)}
      />
      <RecurrencePicker
          ref={recurrencePickerRef}
          seriesStart={formData.startDatetime}
          onMoveStart={(d) =>
            setFormData((f) => {
              // Keep the time of day and the event's length; only the date moves.
              const start = new Date(f.startDatetime);
              start.setFullYear(d.getFullYear(), d.getMonth(), d.getDate());
              const duration = f.endDatetime.getTime() - f.startDatetime.getTime();
              return { ...f, startDatetime: start, endDatetime: new Date(start.getTime() + duration) };
            })
          }
          selectedValue={formData.recurrence}
          noneOnly={!isPremiumBusiness}
          onSelect={(v) =>
            setFormData((f) => ({
              ...f,
              // Changing the cadence keeps any end date already chosen, unless
              // "Ends after N times" sends its own endDate, which wins.
              recurrence: v ? { ...(f.recurrence?.endDate ? { endDate: f.recurrence.endDate } : {}), ...v } : null,
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
  seriesScopeLink: {
    color: Colors.primary,
    fontFamily: Typography.fontFamilies.semibold,
  },
  seriesScopeHint: {
    fontSize: Typography.sizes.xs,
    lineHeight: 17,
    color: Colors.text.secondary,
    fontFamily: Typography.fontFamilies.regular,
    marginTop: -Spacing.xs,
    marginBottom: Spacing.sm,
  },
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
  categoriesGridWrap: {
    marginBottom: Spacing.md,
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
