import { useState, useEffect, useCallback, useRef } from 'react';
import { useFocusEffect } from 'expo-router';
import {
  View,
  Text,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  TouchableOpacity,
  Image,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import DateTimePicker, {
  DateTimePickerAndroid,
} from '@react-native-community/datetimepicker';
import {
  ChevronRight,
  ChevronDown,
  Type,
  AlignLeft,
  Tag,
  Clock,
  CalendarDays,
  Repeat,
  MapPin,
  Sparkles,
  Navigation,
  ImageIcon,
  Users,
} from 'lucide-react-native';
import { useApp } from '@/contexts/AppContext';
import { usePremium } from '@/contexts/PremiumContext';
import { useAuth } from '@/contexts/AuthContext';
import { router } from 'expo-router';
import { Input } from '@/components/Input';
import { Button } from '@/components/ui/Button';
import { CategoryIcon } from '@/components/CategoryIcon';
import { ImagePickerButton, type ImageAsset } from '@/components/ImagePickerButton';
import {
  RecurrencePicker,
  getRecurrenceLabel,
  type RecurrencePickerHandle,
} from '@/components/RecurrencePicker';
import { eventsService } from '@/services/events';
import { categoriesService } from '@/services/categories';
import { businessesService } from '@/services/businesses';
import { Category } from '@/types/database';
import { Colors, Spacing, Typography, BorderRadius } from '@/constants/theme';
import { eventLocationStore } from '@/stores/eventLocationStore';
import type { RecurrenceOption } from '@/utils/recurrence';
import { notify, notifyConfirm } from '@/utils/notify';

const DEFAULT_LOCATION = { lat: 37.7749, lng: -122.4194 };
const MAX_EVENT_DATE = new Date();
MAX_EVENT_DATE.setFullYear(MAX_EVENT_DATE.getFullYear() + 10);

const Palette = {
  gradientStart: Colors.primary,
  gradientEnd: Colors.accent,
  cardBg: Colors.background.primary,
  surfaceMuted: Colors.background.primary,
  accentSoft: Colors.primarySoft,
  separator: Colors.border.light,
  badge: Colors.primary,
};

export default function CreateScreen() {
  const insets = useSafeAreaInsets();
  const { hasBusiness, userBusiness } = useApp();
  const { currentPlan } = usePremium();
  const { isBanned } = useAuth();
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(false);

  const businessLocation = userBusiness
    ? { lat: userBusiness.lat, lng: userBusiness.lng, address: userBusiness.address }
    : null;

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
  const [showStartPicker, setShowStartPicker] = useState(false);
  const [showEndPicker, setShowEndPicker] = useState(false);

  useEffect(() => {
    categoriesService.getAllCategories().then(setCategories);
  }, []);

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
        minimumDate: new Date(),
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
        setFormData((f) => ({
          ...f,
          address: loc.formattedAddress,
          lat: loc.lat,
          lng: loc.lng,
        }));
      }
    }, [])
  );

  const validate = () => {
    const e: Record<string, string> = {};
    if (!formData.title.trim()) e.title = 'Title is required';
    if (!formData.description.trim()) e.description = 'Description is required';
    if (!formData.categoryId) e.categoryId = 'Select a category';
    if (formData.startDatetime.getTime() <= Date.now()) {
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
    if (!validate() || !userBusiness) return;
    if (isBanned) {
      notify.error('Your account has been suspended. Please contact support.');
      return;
    }

    const { canCreate, currentCount, maxCount } =
      await businessesService.checkEventLimit(userBusiness.id);
    if (!canCreate) {
      notify.error(
        `You've created ${currentCount} of ${maxCount} events this month. Upgrade to Premium for more events.`
      );
      return;
    }

    const address = formData.address.trim() || (businessLocation?.address ?? '');
    const lat = formData.address.trim()
      ? formData.lat
      : (businessLocation?.lat ?? formData.lat);
    const lng = formData.address.trim()
      ? formData.lng
      : (businessLocation?.lng ?? formData.lng);

    setLoading(true);
    try {
      // Create the event FIRST so a create failure never leaves orphaned
      // uploads; images are uploaded and attached afterwards, non-fatally.
      const eventId = await eventsService.createEvent({
        businessId: userBusiness.id,
        title: formData.title.trim(),
        description: formData.description.trim(),
        categoryId: formData.categoryId,
        startDatetime: formData.startDatetime.toISOString(),
        endDatetime: formData.endDatetime.toISOString(),
        address,
        lat,
        lng,
        coverImageUrl: null,
        isRecurring: formData.recurrence != null,
        recurrencePattern: formData.recurrence ?? undefined,
      });

      // Optional capacity: the column only exists once 20261030108000 is
      // applied, so a missing-column error is tolerated.
      let capacityUnavailable = false;
      const maxAttendeesValue = formData.maxAttendees.trim()
        ? Number(formData.maxAttendees.trim())
        : null;
      if (maxAttendeesValue != null) {
        try {
          await eventsService.updateEvent(eventId, {
            max_attendees: maxAttendeesValue,
          } as never);
        } catch (capErr: unknown) {
          const code = (capErr as { code?: string })?.code;
          // TODO: remove once 20261030108000 is applied
          if (code === '42703' || code === 'PGRST204') {
            capacityUnavailable = true;
          } else {
            capacityUnavailable = true; // non-fatal either way
          }
        }
      }

      // Upload and attach photos; failures are non-fatal (event stays
      // published, successes are kept).
      let photoFailures = 0;
      const uploadedUrls: string[] = [];
      for (const img of formData.images) {
        try {
          const url = await eventsService.uploadEventImage({
            uri: img.uri,
            name: img.name,
            type: img.type,
          });
          await eventsService.addEventPhoto(eventId, url, uploadedUrls.length);
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

      // Reset the form so re-tapping Publish can't create a duplicate event.
      setFormData({
        title: '',
        description: '',
        categoryId: '',
        startDatetime: new Date(Date.now() + 60 * 60 * 1000),
        endDatetime: new Date(Date.now() + 3 * 60 * 60 * 1000),
        recurrence: null,
        address: businessLocation?.address ?? '',
        lat: businessLocation?.lat ?? DEFAULT_LOCATION.lat,
        lng: businessLocation?.lng ?? DEFAULT_LOCATION.lng,
        images: [],
        maxAttendees: '',
      });
      setErrors({});

      const warnings: string[] = [];
      if (photoFailures > 0) {
        warnings.push(
          `${photoFailures} photo(s) failed to upload — you can add them by editing the event.`
        );
      }
      if (capacityUnavailable) {
        warnings.push(
          'Attendee capacity is not enabled yet, so the limit was not saved.'
        );
      }
      notify.success(
        warnings.length > 0
          ? `Event published, but ${warnings.join(' Also, ')}`
          : 'Event created!'
      );
      router.push({
        pathname: '/(tabs)/discover',
        params: { centerLat: lat.toString(), centerLng: lng.toString() },
      });
    } catch (err: unknown) {
      const message =
        err instanceof Error
          ? err.message
          : (err as { message?: string })?.message ?? 'Failed to create event';
      if (__DEV__) console.error('[CreateEvent]', err);
      notify.error(message);
    } finally {
      setLoading(false);
    }
  };

  const formatDateTime = (d: Date) =>
    d.toLocaleString('en-US', {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    });

  /* ── No business state ── */
  if (!hasBusiness) {
    return (
      <View style={[styles.noBizContainer, { paddingTop: insets.top + 40 }]}>
        <View style={styles.noBizIconWrap}>
          <Image
            source={require('@/assets/images/EMlogo.png')}
            style={styles.noBizLogo}
            resizeMode="contain"
          />
        </View>
        <Text style={styles.noBizTitle}>Create Events</Text>
        <Text style={styles.noBizSubtitle}>
          You need a business profile to start posting events and reaching your
          community.
        </Text>
        <TouchableOpacity
          style={styles.noBizCta}
          onPress={() => router.push('/(tabs)/profile')}
          activeOpacity={0.85}
        >
          <LinearGradient
            colors={[Colors.primary, Palette.gradientEnd]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 0 }}
            style={styles.noBizCtaGradient}
          >
            <Text style={styles.noBizCtaText}>Set Up Business</Text>
            <ChevronRight size={18} color="#fff" />
          </LinearGradient>
        </TouchableOpacity>
      </View>
    );
  }

  /* ── Main form ── */
  return (
    <KeyboardAvoidingView
      style={styles.root}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <ScrollView
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
          <View>
            <Text style={styles.pageTitle}>Create Event</Text>
            <Text style={styles.pageSubtitle}>
              Fill in the details below to publish
            </Text>
          </View>
        </View>

        {/* ── Section: Basic Info ── */}
        <Text style={styles.sectionLabel}>Basic Information</Text>
        <View style={styles.card}>
          <View style={styles.fieldRow}>
            <View style={styles.fieldIcon}>
              <Type size={16} color={Colors.primary} />
            </View>
            <View style={styles.fieldContent}>
              <Input
                label="Title"
                value={formData.title}
                onChangeText={(t) => setFormData((f) => ({ ...f, title: t }))}
                placeholder="Event name"
                error={errors.title}
              />
            </View>
          </View>

          <View style={styles.fieldSeparator} />

          <View style={styles.fieldRow}>
            <View style={styles.fieldIcon}>
              <AlignLeft size={16} color={Colors.primary} />
            </View>
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
                style={styles.textArea}
                error={errors.description}
              />
            </View>
          </View>
        </View>

        {/* ── Section: Category ── */}
        <Text style={styles.sectionLabel}>Category</Text>
        <View style={styles.card}>
          <View style={styles.fieldRowNoPad}>
            <View style={[styles.fieldIcon, { marginTop: 14 }]}>
              <Tag size={16} color={Colors.primary} />
            </View>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              style={styles.catScroll}
              contentContainerStyle={styles.catScrollContent}
            >
              {categories.map((c) => {
                const selected = formData.categoryId === c.id;
                return (
                  <TouchableOpacity
                    key={c.id}
                    style={[styles.catChip, selected && styles.catChipSelected]}
                    onPress={() =>
                      setFormData((f) => ({ ...f, categoryId: c.id }))
                    }
                    activeOpacity={0.7}
                  >
                    <CategoryIcon category={c.slug} size="sm" variant="pill" />
                    <Text
                      style={[
                        styles.catChipText,
                        selected && styles.catChipTextSelected,
                      ]}
                    >
                      {c.label}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
          </View>
          {errors.categoryId && (
            <View style={styles.inlineError}>
              <Text style={styles.errorText}>{errors.categoryId}</Text>
            </View>
          )}
        </View>

        {/* ── Section: Date & Time ── */}
        <Text style={styles.sectionLabel}>Date & Time</Text>
        <View style={styles.card}>
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
            <View style={styles.fieldIcon}>
              <Clock size={16} color={Colors.primary} />
            </View>
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
        </View>

        {/* Start picker rendered OUTSIDE the card */}
        {Platform.OS !== 'android' && showStartPicker && (
          <View style={styles.pickerContainer}>
            <DateTimePicker
              value={formData.startDatetime}
              mode="datetime"
              display="spinner"
              minimumDate={new Date()}
              maximumDate={MAX_EVENT_DATE}
              textColor={Colors.text.primary}
              themeVariant="light"
              onChange={(_, d) => {
                if (d) setFormData((f) => ({ ...f, startDatetime: d }));
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

        <View style={styles.dateCardSpacing}>
          <View style={styles.card}>
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
              <View style={styles.fieldIcon}>
                <CalendarDays size={16} color={Colors.primary} />
              </View>
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
          </View>
        </View>

        {/* End picker rendered OUTSIDE the card */}
        {Platform.OS !== 'android' && showEndPicker && (
          <View style={styles.pickerContainer}>
            <DateTimePicker
              value={formData.endDatetime}
              mode="datetime"
              display="spinner"
              minimumDate={new Date()}
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

        {/* Recurrence (Premium only) */}
        <View style={styles.dateCardSpacing}>
          <View style={styles.card}>
            <TouchableOpacity
              style={styles.dateRow}
              activeOpacity={0.6}
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
              <View style={styles.fieldIcon}>
                <Repeat size={16} color={Colors.primary} />
              </View>
              <View style={styles.dateTextBlock}>
                <Text style={styles.dateLabel}>Repeat</Text>
                <Text style={styles.dateValue}>
                  {getRecurrenceLabel(formData.recurrence)}
                  {userBusiness?.subscription_tier !== 'premium' && ' (Premium)'}
                </Text>
              </View>
              <ChevronRight size={18} color={Colors.text.tertiary} />
            </TouchableOpacity>
          </View>
        </View>

        {/* ── Section: Location ── */}
        <Text style={styles.sectionLabel}>Location</Text>
        <View style={styles.card}>
          <View style={styles.fieldRow}>
            <View style={styles.fieldIcon}>
              <Navigation size={16} color={Colors.primary} />
            </View>
            <View style={styles.fieldContent}>
              <Text style={styles.locationNote}>
                Defaults to your business address if you do not set a different venue
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
                      : 'Tap to set venue on map'}
                  </Text>
                </View>
                {!!formData.address?.trim() && (
                  <Text style={styles.addressCoords}>
                    {formData.lat.toFixed(4)}, {formData.lng.toFixed(4)}
                  </Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </View>

        {/* ── Section: Capacity ── */}
        <Text style={styles.sectionLabel}>Capacity</Text>
        <View style={styles.card}>
          <View style={styles.fieldRow}>
            <View style={styles.fieldIcon}>
              <Users size={16} color={Colors.primary} />
            </View>
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
            </View>
          </View>
        </View>

        {/* ── Section: Photos ── */}
        <Text style={styles.sectionLabel}>Photos</Text>
        <View style={styles.card}>
          <View style={styles.fieldRow}>
            <View style={styles.fieldIcon}>
              <ImageIcon size={16} color={Colors.primary} />
            </View>
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
          label="Publish Event"
          onPress={handleSubmit}
          loading={loading}
          size="lg"
          fullWidth
          gradient
          icon={<Sparkles size={18} color="#FFFFFF" />}
          style={styles.submitWrap}
        />
      </ScrollView>

      <RecurrencePicker
        ref={recurrencePickerRef}
        selectedValue={formData.recurrence}
        onSelect={(v) => setFormData((f) => ({ ...f, recurrence: v }))}
      />
    </KeyboardAvoidingView>
  );
}

/* ────────────────────────── STYLES ────────────────────────── */

const styles = StyleSheet.create({
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
    fontSize: 24,
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
    ...Platform.select({
      ios: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.06,
        shadowRadius: 10,
      },
      android: { elevation: 3 },
    }),
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
  fieldIcon: {
    width: 36,
    height: 36,
    borderRadius: 10,
    backgroundColor: Palette.accentSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  fieldContent: {
    flex: 1,
  },
  fieldSeparator: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: Palette.separator,
    marginLeft: 66,
  },

  textArea: {
    minHeight: 90,
    textAlignVertical: 'top',
  },

  /* ── Category chips ── */
  catScroll: {
    flex: 1,
  },
  catScrollContent: {
    flexDirection: 'row',
    gap: 8,
    paddingVertical: 14,
    paddingRight: 16,
  },
  catChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 9,
    borderRadius: 20,
    backgroundColor: Palette.surfaceMuted,
    borderWidth: 1.5,
    borderColor: Palette.separator,
  },
  catChipSelected: {
    backgroundColor: Palette.badge,
    borderColor: Palette.badge,
  },
  catChipText: {
    fontSize: Typography.sizes.sm,
    fontFamily: Typography.fontFamilies.medium,
    fontWeight: Typography.weights.medium,
    color: Colors.text.primary,
  },
  catChipTextSelected: {
    color: '#FFFFFF',
    fontFamily: Typography.fontFamilies.semibold,
    fontWeight: Typography.weights.semibold,
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
  dateCardSpacing: {
    marginTop: 8,
  },

  /* ── Picker container (outside card) ── */
  pickerContainer: {
    backgroundColor: Palette.cardBg,
    borderRadius: 16,
    marginTop: 8,
    paddingBottom: 8,
    overflow: 'visible',
    ...Platform.select({
      ios: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.06,
        shadowRadius: 10,
      },
      android: { elevation: 3 },
    }),
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
  noBizContainer: {
    flex: 1,
    backgroundColor: Palette.surfaceMuted,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 40,
  },
  noBizIconWrap: {
    width: 80,
    height: 80,
    borderRadius: 24,
    backgroundColor: Palette.accentSoft,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 24,
  },
  noBizLogo: {
    width: 48,
    height: 48,
    tintColor: Colors.primary,
  },
  noBizTitle: {
    fontSize: 22,
    fontFamily: Typography.displayFontFamilies.bold,
    fontWeight: Typography.weights.bold,
    color: Colors.text.primary,
    marginBottom: 8,
  },
  noBizSubtitle: {
    fontSize: Typography.sizes.md,
    fontFamily: Typography.fontFamily,
    color: Colors.text.tertiary,
    textAlign: 'center',
    lineHeight: 22,
    marginBottom: 28,
  },
  noBizCta: {
    borderRadius: 16,
    overflow: 'hidden',
  },
  noBizCtaGradient: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 15,
    paddingHorizontal: 32,
  },
  noBizCtaText: {
    fontSize: 16,
    fontFamily: Typography.fontFamilies.bold,
    fontWeight: Typography.weights.bold,
    color: '#FFFFFF',
  },
});
