import { useState, useEffect, useCallback, useRef } from 'react';
import { blockedOffline } from '@/utils/requireOnline';
import { useFormDraft } from '@/hooks/useFormDraft';
import { readLastCategory, rememberLastCategory } from '@/utils/lastCategory';
import { recurrenceErrorMessage } from '@/utils/rpcErrors';
import { draftKeys } from '@/utils/formDraft';
import { useFocusEffect, router } from 'expo-router';
import {
  View,
  Text,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  TouchableOpacity,
  Image,
  ActivityIndicator,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import DateTimePicker, {
  DateTimePickerAndroid,
} from '@react-native-community/datetimepicker';
import {
  ChevronRight,
  ChevronDown,
  MapPin,
  Sparkles,
} from '@/components/icons.generated';
import { useApp } from '@/contexts/AppContext';
import { usePremium } from '@/contexts/PremiumContext';
import { useAuth } from '@/contexts/AuthContext';
import { Input } from '@/components/Input';
import { Button } from '@/components/ui/Button';
import { HOST_GUIDELINES, businessPin, effectiveHostType } from '@/utils/hostSetup';
import {
  applyPreset,
  defaultPresetForHostType,
  eventPreset,
  type EventPresetId,
  type PresetApplication,
} from '@/utils/eventPresets';
import { applyPresetSettings } from '@/services/eventPresetSettings';
import { eventNeedsExplicitPlace, hostCopy } from '@/utils/hostCopy';
import { effectiveStanding, standingNotice, trustErrorKind, trustErrorMessage } from '@/utils/hostTrust';
import { HostTipCard } from '@/components/HostTipCard';
import { useHostTip } from '@/hooks/useHostTip';
import { EventPreviewSheet } from '@/components/EventPreviewSheet';
import { EventPublishedSheet, type PublishedEventInfo } from '@/components/EventPublishedSheet';
import { formToPreviewEvent, previewGaps } from '@/utils/eventFormPreview';
import {
  FIRST_EVENT_STEPS,
  dismissFirstEventGuide,
  initialEventLocation,
  readFirstEventGuideDismissed,
  shouldShowFirstEventGuide,
} from '@/utils/firstEventGuide';
import { StartHostingLanding } from '@/components/StartHostingLanding';
import { EventPresetPicker } from '@/components/EventPresetPicker';
import { CategorySelectGrid } from '@/components/CategorySelectGrid';
import { ImagePickerButton, type ImageAsset } from '@/components/ImagePickerButton';
import { WebDateTimeInput } from '@/components/WebDateTimeInput';
import { RecurrenceEndRow } from '@/components/RecurrenceEndRow';
import {
  EventLinksEditor,
  normalizeLinkUrl,
  type EventLinkDraft,
} from '@/components/EventLinksEditor';
import {
  RecurrencePicker,
  getRecurrenceLabel,
  type RecurrencePickerHandle,
} from '@/components/RecurrencePicker';
import { eventsService } from '@/services/events';
import { useCategories } from '@/hooks/useCategories';
import { businessesService } from '@/services/businesses';
import { alpha, Colors, Shadows, Spacing, Typography, BorderRadius } from '@/constants/theme';
import { eventLocationStore } from '@/stores/eventLocationStore';
import { parseRecurrenceEndDate, type RecurrenceOption } from '@/utils/recurrence';
import { notify, notifyConfirm } from '@/utils/notify';
import { withShiftedEnd } from '@/utils/eventDatetime';
import { getDeviceTimeZone, pickerDateToInstant, zoneDisplayLabel } from '@/utils/timezone';
import { TimeZonePicker } from '@/components/TimeZonePicker';
import {
  EventExtrasFields,
  EMPTY_EXTRAS,
  validateExtras,
  type EventExtrasDraft,
} from '@/components/EventExtrasFields';
import { a11yState, announce } from '@/utils/accessibility';
import { validationSummary } from '@/utils/validationSummary';
import { uuidv4 } from '@/utils/uuid';

const DEFAULT_LOCATION = { lat: 37.7749, lng: -122.4194 };
const MAX_EVENT_DATE = new Date();
MAX_EVENT_DATE.setFullYear(MAX_EVENT_DATE.getFullYear() + 10);

/** Which form section each validation key belongs to (for scroll-to-error). */
const FIELD_SECTION: Record<string, string> = {
  extras: 'extras',
  title: 'basic',
  description: 'basic',
  categoryId: 'category',
  startDatetime: 'datetime',
  endDatetime: 'datetime',
  maxAttendees: 'capacity',
  links: 'links',
  recurrenceEnd: 'datetime',
  location: 'location',
};

const TITLE_MAX = 100;
const DESCRIPTION_MAX = 2000;

const Palette = {
  gradientStart: Colors.primary,
  gradientEnd: Colors.accent,
  cardBg: Colors.surface,
  surfaceMuted: Colors.background.primary,
  accentSoft: Colors.primarySoft,
  separator: Colors.border.light,
  badge: Colors.primary,
};

export default function CreateScreen() {
  const insets = useSafeAreaInsets();
  const { hasBusiness, userBusiness, refreshBusiness, loading: appLoading } = useApp();
  const {
    currentPlan,
    eventCount,
    eventLimit,
    loading: premiumLoading,
    refreshSubscription,
  } = usePremium();
  const { isBanned, user } = useAuth();
  const [loading, setLoading] = useState(false);
  /** "Uploading photo 2 of 5…" while photos go up; null otherwise. */
  const [uploadProgress, setUploadProgress] = useState<string | null>(null);
  const isPremiumBusiness = userBusiness?.subscription_tier === 'premium';
  // Monthly quota, shown up front so hosts don't fill the whole form before
  // learning they're out of events. The server re-checks on publish.
  const atEventLimit = !premiumLoading && eventCount >= eventLimit;
  // Set once the host picks a venue in this session; stops the business-
  // address seeding below from silently overwriting their choice when the
  // business object is refreshed.
  const venueChosenRef = useRef(false);
  // One key per event being written: a retried Publish after a lost response
  // returns the event that was already created instead of making a second one.
  // Separate keys for draft and publish: a lost "Save as draft" followed by
  // Publish must create (or find) a published event, not return the draft.
  const requestKeyRef = useRef({ draft: uuidv4(), published: uuidv4() });

  /**
   * Where the form starts. A venue prefills its street address; a host with
   * only a home area gets the map centred there but no address, because an
   * area is not an event address (utils/firstEventGuide).
   */
  const hostStartLocation = initialEventLocation(userBusiness);
  const copy = hostCopy(userBusiness);
  // Host standing (Stage 6). The server refuses publishing when restricted;
  // the client says so up front and keeps Save as draft available.
  const standing = standingNotice(userBusiness);
  const publishingPaused =
    effectiveStanding(userBusiness) === 'restricted' || !!userBusiness?.archived_at;
  const businessLocation = businessPin(userBusiness);

  const [formData, setFormData] = useState({
    title: '',
    description: '',
    categoryId: '',
    startDatetime: new Date(Date.now() + 60 * 60 * 1000),
    endDatetime: new Date(Date.now() + 3 * 60 * 60 * 1000),
    recurrence: null as RecurrenceOption,
    address: '',
    lat: DEFAULT_LOCATION.lat,
    lng: DEFAULT_LOCATION.lng,
    images: [] as ImageAsset[],
    maxAttendees: '',
    links: [] as EventLinkDraft[],
    // Dates above are wall-clock values in this zone (the picker edits local
    // components; pickerDateToInstant converts on submit).
    timezone: getDeviceTimeZone(),
    extras: EMPTY_EXTRAS as EventExtrasDraft,
  });
  // Local draft (docs/OFFLINE_PLAN.md §3.7): what the host types is kept on
  // the device until it's published or saved as a draft, so a dropped
  // connection, a failed save or a killed app doesn't lose it.
  const draftKey = user ? draftKeys.createEvent(user.id) : null;
  const [draftReady, setDraftReady] = useState(false);
  const hasContent = !!(
    formData.title.trim() ||
    formData.description.trim() ||
    formData.categoryId ||
    formData.images.length ||
    formData.links.length ||
    formData.maxAttendees.trim()
  );
  const { readDraft, clearDraft } = useFormDraft(draftKey, formData, { shouldSave: hasContent, ready: draftReady });

  const resetForm = () => {
    clearDraft();
    setPresetId(null);
    setPresetApplication(null);
    setPresetKept(null);
    requestKeyRef.current = { draft: uuidv4(), published: uuidv4() };
    venueChosenRef.current = false;
    setFormData({
      title: '',
      description: '',
      categoryId: '',
      startDatetime: new Date(Date.now() + 60 * 60 * 1000),
      endDatetime: new Date(Date.now() + 3 * 60 * 60 * 1000),
      recurrence: null,
      address: hostStartLocation.address,
      lat: hostStartLocation.lat ?? DEFAULT_LOCATION.lat,
      lng: hostStartLocation.lng ?? DEFAULT_LOCATION.lng,
      images: [],
      maxAttendees: '',
      links: [],
      timezone: getDeviceTimeZone(),
      extras: EMPTY_EXTRAS,
    });
  };

  useEffect(() => {
    if (!draftKey) return;
    let cancelled = false;
    void readDraft().then(async (draft) => {
      if (cancelled) return;
      if (draft && typeof draft.title === 'string' && draft.startDatetime instanceof Date && draft.endDatetime instanceof Date) {
        setFormData((f) => ({ ...f, ...draft, extras: { ...f.extras, ...draft.extras } }));
        // A restored venue must not be overwritten by the business address.
        if (draft.address) venueChosenRef.current = true;
        notify.withAction('Restored the event you were writing.', { label: 'Start over', onPress: resetForm });
      } else {
        // No draft: start from the category this business used last time.
        // The host can still change it; a stale id (retired category) is
        // simply not in the grid and leaves the field unselected.
        const last = await readLastCategory(userBusiness?.id);
        if (!cancelled && last) setFormData((f) => (f.categoryId ? f : { ...f, categoryId: last }));
      }
      if (!cancelled) setDraftReady(true);
    });
    return () => {
      cancelled = true;
    };
    // Read once per signed-in user.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draftKey]);

  /**
   * Event size preset (prefill only). `presetApplication` remembers what the
   * preset wrote so switching presets replaces its own values but never the
   * host's; `presetKept` explains a value that was left alone.
   *
   * Nothing is applied automatically: the host type only *suggests* a chip.
   * Auto-applying would silently cap a venue's first event at the preset
   * number, which is exactly the surprise presets are meant to avoid.
   */
  const [presetId, setPresetId] = useState<EventPresetId | null>(null);
  const [presetApplication, setPresetApplication] = useState<PresetApplication | null>(null);
  const [presetKept, setPresetKept] = useState<string | null>(null);
  const suggestedPreset = defaultPresetForHostType(effectiveHostType(userBusiness));

  /**
   * Guided first event: shown only to a host who has never created one.
   * `null` while the count is loading, so the card never flashes at a host
   * with a full back catalogue.
   */
  const [totalEvents, setTotalEvents] = useState<number | null>(null);
  const [guideDismissed, setGuideDismissed] = useState(false);
  const showGuide = shouldShowFirstEventGuide({ totalEvents, dismissed: guideDismissed });
  const businessIdForGuide = userBusiness?.id;
  useEffect(() => {
    if (!businessIdForGuide) return;
    let cancelled = false;
    void (async () => {
      const dismissed = await readFirstEventGuideDismissed(businessIdForGuide);
      if (cancelled) return;
      setGuideDismissed(dismissed);
      if (dismissed) return;
      try {
        const count = await eventsService.getBusinessEventsCount(businessIdForGuide, { scope: 'all' });
        if (!cancelled) setTotalEvents(count);
      } catch {
        // Unknown count: leave the guide hidden rather than guess.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [businessIdForGuide]);

  /** Preview sheet: built from the unsaved form on demand. */
  const [previewOpen, setPreviewOpen] = useState(false);
  /**
   * Post-publish sheet. It stays on Create until dismissed, then navigates to
   * the event — a Modal owned by this screen cannot reliably sit above a
   * screen pushed on top of it.
   */
  const [publishedEvent, setPublishedEvent] = useState<PublishedEventInfo | null>(null);
  const [publishedFollowers, setPublishedFollowers] = useState<number | null>(null);
  const [publishedIsFirst, setPublishedIsFirst] = useState(false);

  /**
   * In guided mode Publish opens the preview first (validation runs, so the
   * host never previews a form that cannot be published). Outside guided mode
   * the Preview button is there for anyone who wants it.
   */
  // Deliberately not memoised: it must see the current form. A useCallback
  // here once captured the first render's empty form, so guided Publish
  // always failed validation.
  const handlePublishPress = () => {
    if (!showGuide) {
      void handleSubmit('publish');
      return;
    }
    if (validate().length > 0) {
      void handleSubmit('publish'); // reuses the scroll-to-error reporting
      return;
    }
    setPreviewOpen(true);
  };

  /**
   * One-time tip: a free host with one publish left this month. Shown only
   * while a slot remains — at zero the existing limit banner takes over.
   */
  const { tip: hostTipId, dismiss: dismissHostTip } = useHostTip(
    {
      eventsUsed: premiumLoading ? null : eventCount,
      eventsAllowed: premiumLoading ? null : eventLimit,
      isPremium: isPremiumBusiness,
    },
    // One piece of guidance at a time: a brand-new host is already reading
    // the first-event card, and the quota pill shows the count anyway.
    !premiumLoading && !atEventLimit && !showGuide
  );

  const handleDismissGuide = useCallback(() => {
    setGuideDismissed(true);
    if (businessIdForGuide) void dismissFirstEventGuide(businessIdForGuide);
  }, [businessIdForGuide]);

  const [linkErrors, setLinkErrors] = useState<Record<number, string>>({});
  const [extrasErrors, setExtrasErrors] = useState<Partial<Record<keyof EventExtrasDraft, string>>>({});
  const [showExtras, setShowExtras] = useState(false);

  const handleSelectPreset = useCallback(
    (id: EventPresetId) => {
      const { values, application, kept } = applyPreset(
        { maxAttendees: formData.maxAttendees },
        id,
        presetApplication
      );
      setPresetId(id);
      setPresetApplication(application);
      setPresetKept(
        kept.includes('maxAttendees')
          ? 'Your attendee limit was kept. Clear it to use the preset\u2019s suggestion.'
          : null
      );
      setFormData((f) => ({ ...f, maxAttendees: values.maxAttendees }));
      if (eventPreset(id).expandExtras) setShowExtras(true);
    },
    [formData.maxAttendees, presetApplication]
  );

  const [savingDraft, setSavingDraft] = useState(false);
  const [tzPickerOpen, setTzPickerOpen] = useState(false);
  const recurrencePickerRef = useRef<RecurrencePickerHandle>(null);
  const scrollViewRef = useRef<ScrollView>(null);
  /**
   * Y offset of each form section, captured on layout so a validation error
   * can scroll to the field that actually failed. Scrolling to the top was
   * wrong whenever the only problem was Capacity or Links at the bottom.
   */
  const sectionY = useRef<Record<string, number>>({});
  const captureSection = useCallback(
    (key: string) => (e: { nativeEvent: { layout: { y: number } } }) => {
      sectionY.current[key] = e.nativeEvent.layout.y;
    },
    []
  );

  useEffect(() => {
    if (hostStartLocation.lat == null || hostStartLocation.lng == null) return;
    if (venueChosenRef.current) return;
    setFormData((f) => ({
      ...f,
      address: hostStartLocation.address,
      lat: hostStartLocation.lat as number,
      lng: hostStartLocation.lng as number,
    }));
  }, [hostStartLocation.lat, hostStartLocation.lng, hostStartLocation.address]);

  const [errors, setErrors] = useState<Record<string, string>>({});
  const [showStartPicker, setShowStartPicker] = useState(false);
  const [showEndPicker, setShowEndPicker] = useState(false);

  // Categories are required to publish. They come from the shared cached
  // query (available offline once loaded); with nothing loaded, a failed
  // load offers a retry instead of leaving an empty picker.
  const { categories, isError: categoriesFailed, refetch: refetchCategories } = useCategories();
  useEffect(() => {
    if (!categoriesFailed || categories.length > 0) return;
    notify.error("Couldn't load categories.", { label: 'Retry', onPress: () => void refetchCategories() });
  }, [categoriesFailed, categories.length, refetchCategories]);

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
        minimumDate: new Date(),
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

  useFocusEffect(
    useCallback(
      () => () => {
        setShowStartPicker(false);
        setShowEndPicker(false);
      },
      []
    )
  );

  useFocusEffect(
    useCallback(() => {
      const loc = eventLocationStore.consume();
      if (loc) {
        venueChosenRef.current = true;
        setFormData((f) => ({
          ...f,
          address: loc.formattedAddress,
          lat: loc.lat,
          lng: loc.lng,
        }));
      }
    }, [])
  );

  /** Returns the list of failing field keys (empty when the form is valid). */
  const validate = (): string[] => {
    const e: Record<string, string> = {};
    if (!formData.title.trim()) e.title = 'Title is required';
    if (!formData.description.trim()) e.description = 'Description is required';
    if (!formData.categoryId) e.categoryId = 'Select a category';
    // Hosts without a street address have nothing to fall back to: without
    // this the event would publish at the map's default pin.
    if (eventNeedsExplicitPlace(userBusiness, { address: formData.address, placeChosen: venueChosenRef.current })) {
      e.location = 'Set where this event happens';
    }
    if (pickerDateToInstant(formData.startDatetime, formData.timezone).getTime() <= Date.now()) {
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
      if (!link.url.trim() && !link.label.trim()) return; // blank row: ignored
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
    lastErrorsRef.current = e;
    return Object.keys(e);
  };
  // Last validation result, for the spoken summary.
  const lastErrorsRef = useRef<Record<string, string>>({});

  const handleSubmit = async (mode: 'publish' | 'draft' = 'publish') => {
    if (blockedOffline('save or publish events. Your form is kept on this device')) return;
    const problems = validate();
    if (problems.length > 0) {
      // Screen readers otherwise hear nothing when Publish is refused.
      announce(validationSummary(lastErrorsRef.current));
      // Scroll to the first failing section rather than the top, so the
      // message the user needs to read is on screen.
      const target = problems
        .map((key) => sectionY.current[FIELD_SECTION[key] ?? ''])
        .filter((y): y is number => typeof y === 'number')
        .sort((a, b) => a - b)[0];
      scrollViewRef.current?.scrollTo({
        y: Math.max(0, (target ?? 0) - 12),
        animated: true,
      });
      return;
    }
    if (!userBusiness) {
      notify.error(copy.profileLoading);
      return;
    }
    if (isBanned) {
      notify.error('Your account has been suspended. Please contact support.');
      return;
    }
    // Lock the button before the first network call: a second tap during the
    // limit check used to re-enter here and publish the event twice.
    if (loading) return;
    setLoading(true);

    const address = formData.address.trim() || (businessLocation?.address ?? '');
    const lat = formData.address.trim()
      ? formData.lat
      : (businessLocation?.lat ?? formData.lat);
    const lng = formData.address.trim()
      ? formData.lng
      : (businessLocation?.lng ?? formData.lng);

    try {
      // Drafts are free; the allowance is checked again at publish time. A
      // retry after a lost response skips the pre-check: the first attempt
      // may have used the last slot on this very event (the server still
      // enforces the limit if it didn't).
      const { canCreate, currentCount, maxCount } =
        mode === 'draft' || eventsService.hasUncertainCreate(requestKeyRef.current.published)
          ? { canCreate: true, currentCount: 0, maxCount: 0 }
          : await businessesService.checkEventLimit(userBusiness.id);
      if (!canCreate) {
        notifyConfirm({
          title: 'Monthly event limit reached',
          message: `You've created ${currentCount} of ${maxCount} events this month. Upgrade to Premium for more events.`,
          cancelLabel: 'OK',
          confirmLabel: 'Upgrade',
          onConfirm: () => router.push('/premium/plans' as never),
        });
        return;
      }

      // Create the event FIRST so a create failure never leaves orphaned
      // uploads; images are uploaded and attached afterwards, non-fatally.
      const maxAttendeesValue = formData.maxAttendees.trim()
        ? Number(formData.maxAttendees.trim())
        : null;
      if (mode === 'draft') setSavingDraft(true);
      const { id: eventId, capacityApplied, timezoneApplied, extrasApplied, recovered } = await eventsService.createEvent({
        requestKey: requestKeyRef.current[mode === 'draft' ? 'draft' : 'published'],
        businessId: userBusiness.id,
        title: formData.title.trim(),
        description: formData.description.trim(),
        categoryId: formData.categoryId,
        startDatetime: pickerDateToInstant(formData.startDatetime, formData.timezone).toISOString(),
        endDatetime: pickerDateToInstant(formData.endDatetime, formData.timezone).toISOString(),
        timezone: formData.timezone,
        address,
        lat,
        lng,
        coverImageUrl: null,
        isRecurring: formData.recurrence != null,
        recurrencePattern: formData.recurrence ?? undefined,
        maxAttendees: maxAttendeesValue,
        publishState: mode === 'draft' ? 'draft' : 'published',
        extras: {
          visibility: formData.extras.visibility,
          ticketUrl: formData.extras.ticketUrl,
          priceLabel: formData.extras.priceLabel,
          ageRestriction: formData.extras.ageRestriction,
          accessibilityNotes: formData.extras.accessibilityNotes,
          whatToBring: formData.extras.whatToBring,
        },
      });
      // The service sets the cap in the create RPC (or, pre-migration, in a
      // second write); a failure there is non-fatal and reported below.
      const capacityFailed = !capacityApplied;

      // Upload and attach photos; failures are non-fatal (event stays
      // published, successes are kept).
      let photoFailures = 0;
      const uploadedUrls: string[] = [];
      for (const [i, img] of formData.images.entries()) {
        setUploadProgress(`Uploading photo ${i + 1} of ${formData.images.length}…`);
        try {
          const url = await eventsService.uploadEventImage({
            uri: img.uri,
            name: img.name,
            type: img.type,
          });
          // Position in the list, so an earlier failure doesn't shift the rest.
          await eventsService.addEventPhoto(eventId, url, i);
          uploadedUrls.push(url);
        } catch {
          photoFailures += 1;
        }
      }
      if (uploadedUrls.length > 0) {
        try {
          await eventsService.updateEvent(eventId, {
            cover_image_url: uploadedUrls[0],
          });
        } catch {
          // Non-fatal: the first photo still shows via event_photos fallback.
        }
      }

      // Links: saved after the event row, non-fatal like photos.
      let linksFailed = false;
      const linkRows = formData.links.flatMap((link) => {
        const url = normalizeLinkUrl(link.url);
        return url ? [{ label: link.label.trim() || null, url }] : [];
      });
      if (linkRows.length > 0) {
        try {
          linksFailed = !(await eventsService.syncEventLinks(eventId, linkRows));
        } catch {
          linksFailed = true;
        }
      }

      // Captured before resetForm() clears the form, for the published sheet.
      const publishedInfo: PublishedEventInfo = {
        id: eventId,
        title: formData.title.trim(),
        startIso: pickerDateToInstant(formData.startDatetime, formData.timezone).toISOString(),
        endIso: pickerDateToInstant(formData.endDatetime, formData.timezone).toISOString(),
        address,
        description: formData.description.trim(),
        timezone: formData.timezone,
      };
      const wasFirstEvent = totalEvents === 0;

      // Preset settings (waitlist / chat) need the event row, so they are
      // applied last and never block publishing.
      let presetSettingsFailed: string[] = [];
      if (presetId) {
        const result = await applyPresetSettings(eventId, presetId);
        presetSettingsFailed = result.failed;
      }

      // Reset the form so re-tapping Publish can't create a duplicate event.
      resetForm();
      setErrors({});
      setLinkErrors({});

      const warnings: string[] = [];
      if (photoFailures > 0) {
        warnings.push(
          `${photoFailures} photo(s) failed to upload — you can add them by editing the event.`
        );
      }
      if (capacityFailed) {
        warnings.push(
          'the attendee limit could not be saved — set it again by editing the event.'
        );
      }
      if (linksFailed) {
        warnings.push('some links could not be saved — add them again by editing the event.');
      }
      if (!timezoneApplied) {
        warnings.push('the time zone could not be saved yet — times will show in each viewer\'s own zone.');
      }
      if (presetSettingsFailed.length > 0) {
        warnings.push(
          `${presetSettingsFailed.join(' and ')} from the preset could not be saved — set them in Manage event.`
        );
      }
      if (!extrasApplied) {
        warnings.push('the extra details (tickets, age, accessibility) could not be saved yet — add them by editing the event.');
      }
      // A clean publish says nothing here: the published sheet opens and
      // already announces it. Warnings and the retry case still toast.
      if (warnings.length > 0 || mode === 'draft' || recovered) {
        notify.success(
          warnings.length > 0
            ? `${mode === 'draft' ? 'Draft saved' : 'Event published'}, but ${warnings.join(' Also, ')}`
            : mode === 'draft'
              ? 'Draft saved. Publish it from Manage event when ready.'
              : 'Event created. Your earlier attempt had already gone through.'
        );
      }
      // Keep the quota pill current for the next event.
      void refreshSubscription();
      rememberLastCategory(userBusiness?.id, formData.categoryId);
      if (mode === 'draft') {
        // Drafts go straight to the hub, where Publish lives.
        router.push(`/business/manage-event/${eventId}` as never);
      } else {
        // Published: offer share / notify / calendar / manage first; the
        // sheet navigates to the event when it closes.
        setPublishedIsFirst(wasFirstEvent);
        setPublishedFollowers(null);
        setPublishedEvent(publishedInfo);
        setTotalEvents((n) => (n == null ? n : n + 1));
        if (userBusiness) {
          void businessesService
            .getFollowerCount(userBusiness.id)
            .then((count) => setPublishedFollowers(count))
            .catch(() => setPublishedFollowers(null));
        }
      }
    } catch (err: unknown) {
      const message =
        err instanceof Error
          ? err.message
          : (err as { message?: string })?.message ?? 'Failed to create event';
      if (__DEV__) console.error('[CreateEvent]', err);
      const trust = trustErrorKind(err);
      if (trust === 'guidelines_required' && userBusiness) {
        // Nothing was created (the guard rejects the insert), so the same
        // request key is safe to retry after accepting.
        notifyConfirm({
          title: 'Accept the host guidelines',
          message: `${HOST_GUIDELINES.map((g, i) => `${i + 1}. ${g}`).join('\n')}\n\nYour event is kept; it publishes once you accept.`,
          cancelLabel: 'Not now',
          confirmLabel: 'Accept and publish',
          onConfirm: async () => {
            try {
              await businessesService.acceptHostTerms(userBusiness.id);
              await refreshBusiness();
              void handleSubmit(mode);
            } catch {
              notify.error('Could not save your acceptance. Please try again.');
            }
          },
        });
      } else if (trust === 'host_restricted' || trust === 'host_archived') {
        notify.error(trustErrorMessage(trust));
        void refreshBusiness();
      } else {
        notify.error(recurrenceErrorMessage(err) ?? message);
      }
    } finally {
      setLoading(false);
      setSavingDraft(false);
      setUploadProgress(null);
    }
  };

  const formatDateTime = (d: Date) =>
    d.toLocaleString(undefined, {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    });

  /* ── No host profile yet: explain hosting and hand off to setup ── */
  if (!hasBusiness) {
    if (appLoading) {
      return (
        <View style={styles.loadingState}>
          <ActivityIndicator size="large" color={Colors.primary} />
        </View>
      );
    }
    return <StartHostingLanding />;
  }

  /* ── Main form ── */
  return (
    <KeyboardAvoidingView
      style={styles.root}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <ScrollView
        ref={scrollViewRef}
        style={styles.scroll}
        contentContainerStyle={[
          styles.scrollContent,
          { paddingTop: insets.top + 16, paddingBottom: insets.bottom + 40 },
        ]}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {/* ── Page header ── */}
        <View style={styles.pageHeader}>
          <Image
            source={require('@/assets/images/EMlogo.png')}
            style={styles.pageHeaderLogo}
            resizeMode="contain"
          />
          <View style={styles.pageHeaderText}>
            <Text style={styles.pageTitle} accessibilityRole="header">Create Event</Text>
            <Text style={styles.pageSubtitle}>
              Fill in the details below to publish
            </Text>
          </View>
          {!premiumLoading ? (
            <View
              style={[styles.quotaPill, atEventLimit && styles.quotaPillFull]}
              accessibilityLabel={`${eventCount} of ${eventLimit} events used this month`}
            >
              <Text style={[styles.quotaPillText, atEventLimit && styles.quotaPillTextFull]}>
                {eventCount}/{eventLimit} this month
              </Text>
            </View>
          ) : null}
        </View>

        {atEventLimit ? (
          <TouchableOpacity
            style={styles.limitBanner}
            onPress={() => router.push('/premium/plans' as never)}
            activeOpacity={0.85}
            accessibilityRole="button"
            accessibilityLabel="Monthly event limit reached. Upgrade to Premium for more events"
          >
            <Sparkles size={18} color={Colors.primary} />
            <View style={styles.limitBannerText}>
              <Text style={styles.limitBannerTitle}>{"You've used this month's events"}</Text>
              <Text style={styles.limitBannerBody}>
                Free plans include {eventLimit} per month. Upgrade to Premium to keep publishing.
              </Text>
            </View>
            <ChevronRight size={18} color={Colors.primary} />
          </TouchableOpacity>
        ) : null}

        <HostTipCard
          tip={hostTipId}
          onDismiss={dismissHostTip}
          onAction={() => router.push('/premium/plans' as never)}
          style={styles.hostTip}
        />

        {standing ? (
          <View
            style={[styles.standingBanner, standing.tone === 'danger' && styles.standingBannerDanger]}
            accessibilityRole="alert"
          >
            <Text style={styles.standingTitle}>{standing.title}</Text>
            <Text style={styles.standingBody}>{standing.body}</Text>
          </View>
        ) : null}

        {/* ── Guided first event ── */}
        {showGuide ? (
          <View style={styles.guideCard}>
            <View style={styles.guideHeader}>
              <Sparkles size={18} color={Colors.primary} />
              <Text style={styles.guideTitle} accessibilityRole="header">
                Your first event: three things that matter
              </Text>
              <TouchableOpacity
                onPress={handleDismissGuide}
                accessibilityRole="button"
                accessibilityLabel="Hide first event tips"
                style={styles.guideDismissBtn}
              >
                <Text style={styles.guideDismiss}>Hide</Text>
              </TouchableOpacity>
            </View>
            {FIRST_EVENT_STEPS.map((step, i) => (
              <View key={step.key} style={styles.guideStep}>
                <Text style={styles.guideStepNum}>{i + 1}</Text>
                <View style={styles.fieldContent}>
                  <Text style={styles.guideStepTitle}>{step.title}</Text>
                  <Text style={styles.guideStepHint}>{step.short}</Text>
                </View>
              </View>
            ))}
            <Text style={styles.guideFootnote}>
              Everything else is optional. You can edit the event after publishing.
            </Text>
          </View>
        ) : null}

        {/* ── Event size preset (prefill only) ── */}
        <Text style={styles.sectionLabel} onLayout={captureSection('preset')}>Event size</Text>
        <View style={[styles.card, styles.presetCard]}>
          <EventPresetPicker
            value={presetId}
            suggested={suggestedPreset}
            onSelect={handleSelectPreset}
            keptNotice={presetKept}
          />
        </View>

        {/* ── Section: Basic Info ── */}
        <Text style={styles.sectionLabel} onLayout={captureSection('basic')}>Basic Information</Text>
        {showGuide ? (
          <Text style={styles.guideInlineHint}>Step 1 of 3 · {FIRST_EVENT_STEPS[0].hint}</Text>
        ) : null}
        <View style={styles.card}>
          <View style={styles.fieldRow}>
            <View style={styles.fieldContent}>
              <Input
                label="Title"
                value={formData.title}
                onChangeText={(t) => setFormData((f) => ({ ...f, title: t }))}
                placeholder="Event name"
                maxLength={TITLE_MAX}
                error={errors.title}
              />
            </View>
          </View>

          <View style={styles.fieldSeparator} />

          <View style={styles.fieldRow}>
            <View style={styles.fieldContent}>
              <Input
                label="Description"
                value={formData.description}
                onChangeText={(t) =>
                  setFormData((f) => ({ ...f, description: t }))
                }
                placeholder="What's this event about?"
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
            </View>
          </View>
        </View>

        {/* ── Section: Category ── */}
        <Text style={styles.sectionLabel} onLayout={captureSection('category')}>Category</Text>
        <View style={styles.card}>
          <View style={styles.catGridWrap}>
            <CategorySelectGrid
              categories={categories}
              selectedId={formData.categoryId}
              onSelect={(id) => setFormData((f) => ({ ...f, categoryId: id }))}
              title={formData.title}
              description={formData.description}
            />
          </View>
          {errors.categoryId && (
            <View style={styles.inlineError}>
              <Text style={styles.errorText}>{errors.categoryId}</Text>
            </View>
          )}
        </View>

        {/* ── Section: Date & Time ── */}
        <Text style={styles.sectionLabel} onLayout={captureSection('datetime')}>Date & Time</Text>
        {showGuide ? (
          <Text style={styles.guideInlineHint}>Step 2 of 3 · {FIRST_EVENT_STEPS[1].hint}</Text>
        ) : null}
        <View style={styles.card}>
          <TouchableOpacity
            style={styles.dateRow}
            activeOpacity={0.6}
            onPress={() => setTzPickerOpen(true)}
            accessibilityRole="button"
            accessibilityLabel={`Time zone: ${zoneDisplayLabel(formData.timezone, formData.startDatetime)}. Change`}
          >
            <View style={styles.dateTextBlock}>
              <Text style={styles.dateLabel}>Time zone</Text>
              <Text style={styles.dateValue}>{zoneDisplayLabel(formData.timezone, formData.startDatetime)}</Text>
              <Text style={styles.locationNote}>
                {formData.timezone === getDeviceTimeZone()
                  ? 'Your device zone. Times below are entered in it.'
                  : 'Times below are entered in this zone, not your device zone.'}
              </Text>
            </View>
            <ChevronRight size={18} color={Colors.text.tertiary} />
          </TouchableOpacity>
          <View style={styles.fieldSeparator} />
          {/* Start */}
          <TouchableOpacity
            style={styles.dateRow}
            activeOpacity={0.6}
            onPress={() => {
              if (Platform.OS === 'android') {
                openAndroidPicker(formData.startDatetime, 'start');
              } else {
                setShowEndPicker(false);
                setShowStartPicker((prev) => !prev);
              }
            }}
          >
            <View style={styles.dateTextBlock}>
              <Text style={styles.dateLabel}>Starts</Text>
              <Text style={styles.dateValue}>
                {formatDateTime(formData.startDatetime)}
              </Text>
            </View>
            {showStartPicker ? (
              <ChevronDown size={18} color={Colors.primary} />
            ) : (
              <ChevronRight size={18} color={Colors.text.tertiary} />
            )}
          </TouchableOpacity>

          {errors.startDatetime && (
            <View style={styles.inlineError}>
              <Text style={styles.errorText}>{errors.startDatetime}</Text>
            </View>
          )}

          {/* Web: the community picker renders nothing in a browser, so use a
              native datetime-local input instead. */}
          {Platform.OS === 'web' && showStartPicker && (
            <View style={styles.inlinePickerContainer}>
              <WebDateTimeInput
                value={formData.startDatetime}
                minimumDate={new Date()}
                maximumDate={MAX_EVENT_DATE}
                accessibilityLabel="Event start date and time"
                onChange={(d) => setFormData((f) => withShiftedEnd(f, d))}
              />
            </View>
          )}

          {/* Inline iOS picker — directly beneath its own row */}
          {Platform.OS === 'ios' && showStartPicker && (
            <View style={styles.inlinePickerContainer}>
              <DateTimePicker
                value={formData.startDatetime}
                mode="datetime"
                display="spinner"
                minimumDate={new Date()}
                maximumDate={MAX_EVENT_DATE}
                textColor={Colors.text.primary}
                themeVariant="light"
                onChange={(_, d) => {
                  if (d) setFormData((f) => withShiftedEnd(f, d));
                }}
                style={styles.picker}
              />
              <TouchableOpacity
                style={styles.pickerDoneButton}
                onPress={() => setShowStartPicker(false)}
                activeOpacity={0.7}
              >
                <Text style={styles.pickerDoneText}>Done</Text>
              </TouchableOpacity>
            </View>
          )}

          <View style={styles.fieldSeparator} />

          {/* End */}
          <TouchableOpacity
            style={styles.dateRow}
            activeOpacity={0.6}
            onPress={() => {
              if (Platform.OS === 'android') {
                openAndroidPicker(formData.endDatetime, 'end');
              } else {
                setShowStartPicker(false);
                setShowEndPicker((prev) => !prev);
              }
            }}
          >
            <View style={styles.dateTextBlock}>
              <Text style={styles.dateLabel}>Ends</Text>
              <Text style={styles.dateValue}>
                {formatDateTime(formData.endDatetime)}
              </Text>
            </View>
            {showEndPicker ? (
              <ChevronDown size={18} color={Colors.primary} />
            ) : (
              <ChevronRight size={18} color={Colors.text.tertiary} />
            )}
          </TouchableOpacity>

          {errors.endDatetime && (
            <View style={styles.inlineError}>
              <Text style={styles.errorText}>{errors.endDatetime}</Text>
            </View>
          )}

          {Platform.OS === 'web' && showEndPicker && (
            <View style={styles.inlinePickerContainer}>
              <WebDateTimeInput
                value={formData.endDatetime}
                minimumDate={formData.startDatetime}
                maximumDate={MAX_EVENT_DATE}
                accessibilityLabel="Event end date and time"
                onChange={(d) => setFormData((f) => ({ ...f, endDatetime: d }))}
              />
            </View>
          )}

          {/* Inline iOS picker — directly beneath its own row */}
          {Platform.OS === 'ios' && showEndPicker && (
            <View style={styles.inlinePickerContainer}>
              <DateTimePicker
                value={formData.endDatetime}
                mode="datetime"
                display="spinner"
                minimumDate={formData.startDatetime}
                maximumDate={MAX_EVENT_DATE}
                textColor={Colors.text.primary}
                themeVariant="light"
                onChange={(_, d) => {
                  if (d) setFormData((f) => ({ ...f, endDatetime: d }));
                }}
                style={styles.picker}
              />
              <TouchableOpacity
                style={styles.pickerDoneButton}
                onPress={() => setShowEndPicker(false)}
                activeOpacity={0.7}
              >
                <Text style={styles.pickerDoneText}>Done</Text>
              </TouchableOpacity>
            </View>
          )}

          <View style={styles.fieldSeparator} />

          {/* Repeat (Premium only) */}
          <TouchableOpacity
            style={styles.dateRow}
            activeOpacity={0.6}
            onPress={() => {
              if (!isPremiumBusiness) {
                notifyConfirm({
                  title: 'Premium Feature',
                  message:
                    copy.recurringPremium,
                  cancelLabel: 'OK',
                  confirmLabel: 'Upgrade',
                  onConfirm: () => router.push('/premium/plans' as never),
                });
                return;
              }
              recurrencePickerRef.current?.present();
            }}
          >
            <View style={styles.dateTextBlock}>
              <Text style={styles.dateLabel}>Repeat</Text>
              <Text style={styles.dateValue}>
                {getRecurrenceLabel(formData.recurrence, formData.startDatetime)}
                {!isPremiumBusiness && ' (Premium)'}
              </Text>
            </View>
            <ChevronRight size={18} color={Colors.text.tertiary} />
          </TouchableOpacity>

          {formData.recurrence ? (
            <>
              <View style={styles.fieldSeparator} />
              <RecurrenceEndRow
                pattern={formData.recurrence}
                seriesStart={formData.startDatetime}
                onChange={(next) => setFormData((f) => ({ ...f, recurrence: next }))}
              />
              {errors.recurrenceEnd && (
                <View style={styles.inlineError}>
                  <Text style={styles.errorText}>{errors.recurrenceEnd}</Text>
                </View>
              )}
            </>
          ) : null}
        </View>

        {/* ── Section: Location ── */}
        <Text style={styles.sectionLabel} onLayout={captureSection('location')}>Location</Text>
        {showGuide ? (
          <Text style={styles.guideInlineHint}>Step 3 of 3 · {FIRST_EVENT_STEPS[2].hint}</Text>
        ) : null}
        <View style={styles.card}>
          <View style={styles.fieldRow}>
            <View style={styles.fieldContent}>
              <Text style={styles.locationNote}>
                {copy.locationNote}
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
                      : copy.locationPlaceholder}
                  </Text>
                </View>
                {/* Only a place the host actually picked counts: a map centred on
                    their home area is not a location. */}
                {!formData.address?.trim() && venueChosenRef.current && (
                  <Text style={styles.addressCoords}>Location set</Text>
                )}
              </TouchableOpacity>
              {errors.location ? <Text style={styles.errorText}>{errors.location}</Text> : null}
            </View>
          </View>
        </View>

        {/* ── Section: Capacity ── */}
        <Text style={styles.sectionLabel} onLayout={captureSection('capacity')}>Capacity</Text>
        <View style={styles.card}>
          <View style={styles.fieldRow}>
            <View style={styles.fieldContent}>
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
              <Text style={styles.locationNote}>
                Only &quot;going&quot; RSVPs count toward the limit — marking interested
                doesn&apos;t hold a spot.
              </Text>
            </View>
          </View>
        </View>

        {/* ── Section: More options ── */}
        <Text style={styles.sectionLabel} onLayout={captureSection('extras')}>More options</Text>
        <View style={styles.card}>
          <TouchableOpacity
            style={styles.dateRow}
            onPress={() => setShowExtras((v) => !v)}
            activeOpacity={0.6}
            accessibilityRole="button"
            {...a11yState({ expanded: showExtras })}
            accessibilityLabel="More options: visibility, tickets, age, accessibility"
          >
            <View style={styles.dateTextBlock}>
              <Text style={styles.dateLabel}>Visibility, tickets, age, accessibility</Text>
              <Text style={styles.dateValue}>{showExtras ? 'Hide' : 'Show options'}</Text>
            </View>
            <ChevronRight
              size={18}
              color={Colors.text.tertiary}
              style={showExtras ? { transform: [{ rotate: '90deg' }] } : undefined}
            />
          </TouchableOpacity>
          {showExtras ? (
            <>
              <View style={styles.fieldSeparator} />
              <View style={styles.fieldRow}>
                <View style={styles.fieldContent}>
                  <EventExtrasFields
                    value={formData.extras}
                    errors={extrasErrors}
                    onChange={(extras) => {
                      setExtrasErrors({});
                      setFormData((f) => ({ ...f, extras }));
                    }}
                  />
                </View>
              </View>
            </>
          ) : null}
        </View>

        {/* ── Section: Links ── */}
        <Text style={styles.sectionLabel} onLayout={captureSection('links')}>Links</Text>
        <View style={styles.card}>
          <View style={styles.fieldRow}>
            <View style={styles.fieldContent}>
              <EventLinksEditor
                links={formData.links}
                errors={linkErrors}
                onChange={(links) => {
                  setLinkErrors({});
                  setFormData((f) => ({ ...f, links }));
                }}
              />
            </View>
          </View>
        </View>

        {/* ── Section: Photos ── */}
        <Text style={styles.sectionLabel} onLayout={captureSection('photos')}>Photos</Text>
        <View style={styles.card}>
          <View style={styles.fieldRow}>
            <View style={styles.fieldContent}>
              <Text style={styles.locationNote}>
                First image becomes the cover photo
              </Text>
              <ImagePickerButton
                images={formData.images}
                onChange={(imgs) => setFormData((f) => ({ ...f, images: imgs }))}
                maxImages={currentPlan?.max_photos_per_event ?? 5}
              />
            </View>
          </View>
        </View>

        {/* ── Submit ── */}
        <Button
          label={
            uploadProgress ??
            (publishingPaused ? 'Publishing paused' : atEventLimit ? 'Monthly limit reached' : 'Publish Event')
          }
          onPress={handlePublishPress}
          loading={loading && !savingDraft}
          disabled={atEventLimit || loading || publishingPaused}
          size="lg"
          fullWidth
          gradient
          icon={<Sparkles size={18} color="#FFFFFF" />}
          style={styles.submitWrap}
        />
        <Button
          label="Preview"
          variant="secondary"
          onPress={() => setPreviewOpen(true)}
          disabled={loading}
          fullWidth
          accessibilityLabel="Preview how your event will look to attendees"
          style={styles.draftWrap}
        />
        <Button
          label="Save as draft"
          variant="secondary"
          onPress={() => void handleSubmit('draft')}
          loading={savingDraft}
          disabled={loading}
          fullWidth
          accessibilityLabel="Save as draft: only you can see it and it does not count toward your monthly events"
          style={styles.draftWrap}
        />
        <Text style={styles.draftHint}>
          Drafts are private and free; publish from Manage event when ready.
        </Text>
      </ScrollView>

      <EventPreviewSheet
        visible={previewOpen}
        event={
          previewOpen
            ? formToPreviewEvent(formData, {
                business: userBusiness ?? null,
                category: categories.find((c) => c.id === formData.categoryId) ?? null,
              })
            : null
        }
        gaps={previewGaps(formData)}
        publishing={loading && !savingDraft}
        savingDraft={savingDraft}
        onClose={() => setPreviewOpen(false)}
        onPublish={() => {
          setPreviewOpen(false);
          // The preview stays available while paused, but publishing does not.
          if (publishingPaused) {
            notify.error(trustErrorMessage('host_restricted'));
            return;
          }
          void handleSubmit('publish');
        }}
        onSaveDraft={() => {
          setPreviewOpen(false);
          void handleSubmit('draft');
        }}
      />

      <EventPublishedSheet
        visible={publishedEvent != null}
        event={publishedEvent}
        followerCount={publishedFollowers}
        isFirstEvent={publishedIsFirst}
        businessId={userBusiness?.id}
        eventsLeftThisMonth={
          !premiumLoading && eventLimit > 0 ? Math.max(0, eventLimit - eventCount) : null
        }
        onClose={() => {
          const id = publishedEvent?.id;
          setPublishedEvent(null);
          if (id) router.push(`/event/${id}` as never);
        }}
        onOpenManage={() => {
          const id = publishedEvent?.id;
          setPublishedEvent(null);
          if (id) router.push(`/business/manage-event/${id}` as never);
        }}
      />

      <TimeZonePicker
        visible={tzPickerOpen}
        value={formData.timezone}
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
        onSelect={(v) =>
          setFormData((f) => ({
            ...f,
            // Changing the cadence keeps any end date already chosen, unless
            // "Ends after N times" sends its own endDate, which wins.
            recurrence: v ? { ...(f.recurrence?.endDate ? { endDate: f.recurrence.endDate } : {}), ...v } : null,
          }))
        }
      />
    </KeyboardAvoidingView>
  );
}

/* ────────────────────────── STYLES ────────────────────────── */

const styles = StyleSheet.create({
  presetCard: { padding: 14 },
  hostTip: { marginBottom: 16 },
  standingBanner: {
    marginBottom: 16,
    padding: 14,
    borderRadius: BorderRadius.lg,
    borderWidth: 1,
    borderColor: Colors.warningText,
    backgroundColor: Colors.surface,
    gap: 4,
  },
  standingBannerDanger: { borderColor: Colors.error },
  standingTitle: { fontSize: Typography.sizes.md, fontFamily: Typography.labelFontFamilies.medium, color: Colors.text.primary },
  standingBody: { fontSize: Typography.sizes.sm, fontFamily: Typography.fontFamily, color: Colors.text.secondary, lineHeight: 19 },
  guideCard: {
    backgroundColor: Colors.primarySoft,
    borderRadius: BorderRadius.lg,
    padding: 16,
    marginBottom: 20,
    gap: 12,
  },
  guideHeader: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  guideTitle: {
    flex: 1,
    fontSize: Typography.sizes.md,
    fontFamily: Typography.labelFontFamilies.medium,
    color: Colors.text.primary,
  },
  guideDismissBtn: {
    minWidth: 44,
    minHeight: 44,
    alignItems: 'flex-end',
    justifyContent: 'center',
  },
  guideDismiss: {
    fontSize: Typography.sizes.sm,
    fontFamily: Typography.labelFontFamilies.medium,
    color: Colors.primary,
  },
  guideStep: { flexDirection: 'row', gap: 10 },
  guideStepNum: {
    width: 18,
    fontSize: Typography.sizes.sm,
    fontFamily: Typography.labelFontFamilies.medium,
    color: Colors.primary,
  },
  guideStepTitle: {
    fontSize: Typography.sizes.sm,
    fontFamily: Typography.labelFontFamilies.medium,
    color: Colors.text.primary,
  },
  guideStepHint: {
    marginTop: 2,
    fontSize: Typography.sizes.sm,
    fontFamily: Typography.fontFamily,
    color: Colors.text.secondary,
    lineHeight: 19,
  },
  guideFootnote: {
    fontSize: Typography.sizes.xs,
    fontFamily: Typography.fontFamily,
    // tertiary grey failed WCAG AA contrast on the pink card (axe).
    color: Colors.text.secondary,
  },
  guideInlineHint: {
    marginTop: -8,
    marginBottom: 8,
    fontSize: Typography.sizes.xs,
    fontFamily: Typography.fontFamily,
    color: Colors.text.secondary,
    lineHeight: 16,
  },
  loadingState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.background.primary,
  },
  root: {
    flex: 1,
    backgroundColor: Palette.surfaceMuted,
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: 20,
  },

  /* ── Page header ── */
  pageHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    marginBottom: 28,
  },
  pageHeaderText: {
    flex: 1,
    minWidth: 0,
  },
  quotaPill: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: BorderRadius.round,
    backgroundColor: Palette.accentSoft,
  },
  quotaPillFull: {
    backgroundColor: Colors.errorSoft,
  },
  quotaPillText: {
    fontSize: Typography.sizes.xs,
    color: Colors.primary,
    fontFamily: Typography.labelFontFamilies.semibold,
  },
  quotaPillTextFull: {
    color: Colors.error,
  },
  limitBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    padding: Spacing.md,
    marginBottom: Spacing.lg,
    borderRadius: BorderRadius.lg,
    borderWidth: 1,
    borderColor: alpha(Colors.primary, 0.27),
    backgroundColor: Palette.accentSoft,
  },
  limitBannerText: {
    flex: 1,
    minWidth: 0,
  },
  limitBannerTitle: {
    fontSize: Typography.sizes.sm,
    color: Colors.text.primary,
    fontFamily: Typography.fontFamilies.semibold,
    fontWeight: Typography.weights.semibold,
  },
  limitBannerBody: {
    marginTop: 2,
    fontSize: Typography.sizes.xs,
    lineHeight: 16,
    color: Colors.text.secondary,
    fontFamily: Typography.fontFamilies.regular,
  },
  pageHeaderIcon: {
    width: 48,
    height: 48,
    borderRadius: 14,
    backgroundColor: Palette.accentSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pageHeaderLogo: {
    width: 48,
    height: 48,
    borderRadius: 14,
    tintColor: Colors.primary,
  },
  pageTitle: {
    fontSize: Typography.sizes.xl,
    fontFamily: Typography.displayFontFamilies.bold,
    fontWeight: Typography.weights.bold,
    color: Colors.text.primary,
  },
  pageSubtitle: {
    fontSize: Typography.sizes.sm,
    fontFamily: Typography.fontFamily,
    color: Colors.text.tertiary,
    marginTop: 2,
  },

  /* ── Section labels ── */
  sectionLabel: {
    fontSize: Typography.sizes.sm,
    fontFamily: Typography.fontFamilies.semibold,
    fontWeight: Typography.weights.semibold,
    color: Colors.text.tertiary,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    marginBottom: 10,
    marginLeft: 4,
    marginTop: 24,
  },

  /* ── Card ── */
  card: {
    backgroundColor: Palette.cardBg,
    borderRadius: 20,
    overflow: 'hidden',
    ...Shadows.card,
  },

  /* ── Field rows ── */
  fieldRow: {
    flexDirection: 'row',
    paddingHorizontal: 16,
    paddingVertical: 14,
    gap: 14,
  },
  fieldRowNoPad: {
    flexDirection: 'row',
    paddingLeft: 16,
    paddingRight: 0,
    gap: 10,
  },
  fieldContent: {
    flex: 1,
  },
  fieldSeparator: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: Palette.separator,
    marginLeft: 16,
  },

  textArea: {
    minHeight: 90,
    textAlignVertical: 'top',
  },
  charCounter: {
    fontSize: Typography.sizes.xs,
    color: Colors.text.tertiary,
  },

  /* ── Category grid ── */
  catGridWrap: {
    padding: Spacing.md,
  },

  /* ── Date rows ── */
  dateRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 14,
    gap: 14,
  },
  dateTextBlock: {
    flex: 1,
  },
  dateLabel: {
    fontSize: 12,
    fontFamily: Typography.fontFamilies.medium,
    fontWeight: Typography.weights.medium,
    color: Colors.text.tertiary,
    marginBottom: 2,
  },
  dateValue: {
    fontSize: Typography.sizes.md,
    fontFamily: Typography.fontFamilies.semibold,
    fontWeight: Typography.weights.semibold,
    color: Colors.text.primary,
  },
  /* ── Inline picker (inside the grouped card, under its own row) ── */
  inlinePickerContainer: {
    paddingBottom: 8,
  },
  picker: {
    height: 200,
    width: '100%',
  },
  pickerDoneButton: {
    alignSelf: 'center',
    paddingHorizontal: 32,
    paddingVertical: 10,
    backgroundColor: Palette.accentSoft,
    borderRadius: 12,
    marginTop: 4,
    marginBottom: 8,
  },
  pickerDoneText: {
    fontSize: Typography.sizes.md,
    fontFamily: Typography.fontFamilies.semibold,
    fontWeight: Typography.weights.semibold,
    color: Colors.primary,
  },

  /* ── Errors ── */
  inlineError: {
    paddingHorizontal: 16,
    paddingBottom: 12,
    paddingTop: 4,
  },
  errorText: {
    fontSize: 12,
    fontFamily: Typography.fontFamilies.medium,
    fontWeight: Typography.weights.medium,
    color: Colors.error,
  },

  /* ── Location ── */
  locationNote: {
    fontSize: 12,
    fontFamily: Typography.fontFamily,
    color: Colors.text.tertiary,
    marginBottom: Spacing.sm,
  },
  addressTouchable: {
    borderWidth: 1,
    borderColor: Colors.border.light,
    borderRadius: BorderRadius.md,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm + 4,
    backgroundColor: Colors.background.primary,
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

  /* ── Submit ── */
  draftWrap: {
    marginTop: Spacing.sm,
  },
  draftHint: {
    marginTop: Spacing.sm,
    textAlign: 'center',
    fontSize: Typography.sizes.xs,
    fontFamily: Typography.fontFamily,
    color: Colors.text.tertiary,
  },
  submitWrap: {
    marginTop: Spacing.xl,
    ...Platform.select({
      ios: {
        shadowColor: Colors.primary,
        shadowOffset: { width: 0, height: 6 },
        shadowOpacity: 0.3,
        shadowRadius: 14,
      },
      android: { elevation: 8 },
    }),
  },
  /* ── No-business state ── */
});
