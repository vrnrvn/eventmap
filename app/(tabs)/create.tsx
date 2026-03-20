import { useState, useEffect, useCallback, useRef } from 'react';
import { useFocusEffect } from 'expo-router';
import {
  View,
  Text,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  ActivityIndicator,
  Alert,
  TouchableOpacity,
  Image,
  TextInput,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import DateTimePicker, {
  DateTimePickerAndroid,
} from '@react-native-community/datetimepicker';
import {
  X,
  CalendarDays,
  Clock3,
  Repeat,
  MapPin,
  Navigation,
  ImagePlus,
  Rocket,
} from 'lucide-react-native';
import { useApp } from '@/contexts/AppContext';
import { useAuth } from '@/contexts/AuthContext';
import { router } from 'expo-router';
import { AddressSearchInput } from '@/components/AddressSearchInput';
import { CategoryIcon } from '@/components/CategoryIcon';
import { GoogleMapView } from '@/components/GoogleMapView';
import { ImagePickerButton, type ImageAsset } from '@/components/ImagePickerButton';
import {
  RecurrencePicker,
  getRecurrenceLabel,
  type RecurrencePickerHandle,
} from '@/components/RecurrencePicker';
import { geocodingService } from '@/services/geocoding';
import { eventsService } from '@/services/events';
import { categoriesService } from '@/services/categories';
import { businessesService } from '@/services/businesses';
import { Category } from '@/types/database';
import { Colors, Typography, BorderRadius } from '@/constants/theme';
import type { RecurrenceOption } from '@/utils/recurrence';

const DEFAULT_LOCATION = { lat: 37.7749, lng: -122.4194 };
const MAX_EVENT_DATE = new Date();
MAX_EVENT_DATE.setFullYear(MAX_EVENT_DATE.getFullYear() + 10);

const Design = {
  surface: '#F6F6F6',
  surfaceCard: '#FFFFFF',
  surfaceMuted: '#F0F1F1',
  surfaceSoft: '#E7E8E8',
  surfaceStrong: '#DBDDDD',
  text: '#2D2F2F',
  textMuted: '#5A5C5C',
  outline: '#ACADAD',
  primary: '#B41924',
  secondary: '#9B3E20',
  primarySoft: 'rgba(180, 25, 36, 0.1)',
  shadow: 'rgba(16, 24, 40, 0.08)',
};

export default function CreateScreen() {
  const insets = useSafeAreaInsets();
  const { hasBusiness, userBusiness } = useApp();
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
    startDatetime: new Date(),
    endDatetime: new Date(Date.now() + 2 * 60 * 60 * 1000),
    recurrence: null as RecurrenceOption,
    address: '',
    lat: DEFAULT_LOCATION.lat,
    lng: DEFAULT_LOCATION.lng,
    images: [] as ImageAsset[],
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
    if (isBanned) {
      Alert.alert('Account Suspended', 'Your account has been suspended. Please contact support.');
      return;
    }

    const { canCreate, currentCount, maxCount } =
      await businessesService.checkEventLimit(userBusiness.id);
    if (!canCreate) {
      Alert.alert(
        'Limit Reached',
        `You've created ${currentCount} of ${maxCount} events this month. Upgrade to Premium for more events.`,
        [{ text: 'OK' }]
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
      let coverImageUrl: string | null = null;
      const uploadedUrls: string[] = [];
      for (const img of formData.images) {
        const url = await eventsService.uploadEventImage({
          uri: img.uri,
          name: img.name,
          type: img.type,
        });
        uploadedUrls.push(url);
      }
      if (uploadedUrls.length > 0) {
        coverImageUrl = uploadedUrls[0];
      }

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
        coverImageUrl,
        isRecurring: formData.recurrence != null,
        recurrencePattern: formData.recurrence ?? undefined,
      });

      for (let i = 0; i < uploadedUrls.length; i++) {
        await eventsService.addEventPhoto(eventId, uploadedUrls[i], i);
      }

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
      const message =
        err instanceof Error
          ? err.message
          : (err as { message?: string })?.message ?? 'Failed to create event';
      if (__DEV__) console.error('[CreateEvent]', err);
      Alert.alert('Error', message);
    } finally {
      setLoading(false);
    }
  };

  const formatDateValue = (d: Date) =>
    d.toLocaleDateString('en-US', {
      month: '2-digit',
      day: '2-digit',
      year: '2-digit',
    });

  const formatTimeValue = (d: Date) =>
    d.toLocaleTimeString('en-US', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    });

  const closeScreen = () => {
    if (router.canGoBack()) {
      router.back();
      return;
    }
    router.replace('/(tabs)/discover');
  };

  if (!hasBusiness) {
    return (
      <View style={[styles.noBizContainer, { paddingTop: insets.top + 48 }]}>
        <View style={styles.noBizBadge}>
          <Image
            source={require('@/assets/images/EMlogo.png')}
            style={styles.noBizLogo}
            resizeMode="contain"
          />
        </View>
        <Text style={styles.noBizTitle}>Host Event</Text>
        <Text style={styles.noBizSubtitle}>
          Create your business profile first so we can attach events to the right venue.
        </Text>
        <TouchableOpacity
          style={styles.noBizButton}
          onPress={() => router.push('/(tabs)/profile')}
          activeOpacity={0.88}
        >
          <LinearGradient
            colors={[Design.primary, Design.secondary]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 0 }}
            style={styles.noBizButtonGradient}
          >
            <Text style={styles.noBizButtonText}>Set Up Business</Text>
          </LinearGradient>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      style={styles.root}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <View
        style={[
          styles.headerWrap,
          { top: insets.top + 12, left: 20, right: 20 },
        ]}
      >
        <View style={styles.header}>
          <TouchableOpacity
            style={styles.headerButton}
            onPress={closeScreen}
            activeOpacity={0.75}
          >
            <X size={24} color={Design.text} />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Host Event</Text>
          <View style={styles.headerSpacer} />
        </View>
      </View>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={{
          paddingTop: insets.top + 92,
          paddingBottom: insets.bottom + 148,
          paddingHorizontal: 24,
        }}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <Text style={styles.sectionEyebrow}>Event Banner</Text>
        <View style={styles.bannerCard}>
          <View style={styles.bannerPreview}>
            {formData.images[0] ? (
              <Image source={{ uri: formData.images[0].uri }} style={styles.bannerImage} />
            ) : null}
            <View
              style={[
                styles.bannerPlaceholder,
                formData.images[0] && styles.bannerPlaceholderOverlay,
              ]}
            >
              <View style={styles.bannerBadge}>
                <ImagePlus size={28} color={Design.primary} />
              </View>
              <Text style={styles.bannerTitle}>Upload cover image</Text>
              <Text style={styles.bannerSubtitle}>
                High resolution PNG or JPG preferred
              </Text>
            </View>
          </View>
          <View style={styles.bannerPickerRow}>
            <ImagePickerButton
              images={formData.images}
              onChange={(imgs) => setFormData((f) => ({ ...f, images: imgs }))}
              maxImages={5}
            />
          </View>
        </View>

        <View style={styles.sectionBlock}>
          <View style={styles.infoCard}>
            <View style={styles.infoSection}>
              <Text style={styles.fieldEyebrow}>What Is It Called?</Text>
              <TextInput
                style={styles.titleInput}
                value={formData.title}
                onChangeText={(t) => setFormData((f) => ({ ...f, title: t }))}
                placeholder="The Sunset Rooftop Mixer"
                placeholderTextColor={Design.surfaceStrong}
              />
              {errors.title ? <Text style={styles.errorText}>{errors.title}</Text> : null}
            </View>
            <View style={styles.infoDivider} />
            <View style={styles.infoSection}>
              <Text style={styles.fieldEyebrow}>Details</Text>
              <TextInput
                style={styles.detailsInput}
                value={formData.description}
                onChangeText={(t) => setFormData((f) => ({ ...f, description: t }))}
                placeholder="Tell your guests about the experience, the vibe, and what to bring..."
                placeholderTextColor={Design.textMuted}
                multiline
                textAlignVertical="top"
              />
              {errors.description ? (
                <Text style={styles.errorText}>{errors.description}</Text>
              ) : null}
            </View>
          </View>
        </View>

        <View style={styles.sectionBlock}>
          <Text style={styles.sectionEyebrow}>Category</Text>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.categoryRow}
          >
            {categories.map((category) => {
              const selected = formData.categoryId === category.id;
              return (
                <TouchableOpacity
                  key={category.id}
                  style={[styles.categoryChip, selected && styles.categoryChipSelected]}
                  onPress={() => setFormData((f) => ({ ...f, categoryId: category.id }))}
                  activeOpacity={0.75}
                >
                  <CategoryIcon
                    category={category.slug}
                    size="sm"
                    variant="pill"
                  />
                  <Text
                    style={[
                      styles.categoryChipText,
                      selected && styles.categoryChipTextSelected,
                    ]}
                  >
                    {category.label}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </ScrollView>
          {errors.categoryId ? <Text style={styles.errorText}>{errors.categoryId}</Text> : null}
        </View>

        <View style={styles.sectionBlock}>
          <View style={styles.dateTimeRow}>
            <TouchableOpacity
              style={styles.dateTimeCard}
              activeOpacity={0.8}
              onPress={() => {
                if (Platform.OS === 'android') {
                  openAndroidPicker(formData.startDatetime, 'start');
                } else {
                  setShowEndPicker(false);
                  setShowStartPicker((prev) => !prev);
                }
              }}
            >
              <View style={styles.dateIconWrap}>
                <CalendarDays size={20} color={Design.primary} />
              </View>
              <View style={styles.dateTimeCopy}>
                <Text style={styles.dateTimeLabel}>Date</Text>
                <Text style={styles.dateTimeValue}>{formatDateValue(formData.startDatetime)}</Text>
              </View>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.dateTimeCard}
              activeOpacity={0.8}
              onPress={() => {
                if (Platform.OS === 'android') {
                  openAndroidPicker(formData.endDatetime, 'end');
                } else {
                  setShowStartPicker(false);
                  setShowEndPicker((prev) => !prev);
                }
              }}
            >
              <View style={styles.dateIconWrap}>
                <Clock3 size={20} color={Design.primary} />
              </View>
              <View style={styles.dateTimeCopy}>
                <Text style={styles.dateTimeLabel}>Time</Text>
                <Text style={styles.dateTimeValue}>{formatTimeValue(formData.startDatetime)}</Text>
              </View>
            </TouchableOpacity>
          </View>

          {Platform.OS !== 'android' && showStartPicker ? (
            <View style={styles.pickerCard}>
              <DateTimePicker
                value={formData.startDatetime}
                mode="datetime"
                display="spinner"
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
                activeOpacity={0.75}
              >
                <Text style={styles.pickerDoneText}>Done</Text>
              </TouchableOpacity>
            </View>
          ) : null}

          {Platform.OS !== 'android' && showEndPicker ? (
            <View style={styles.pickerCard}>
              <DateTimePicker
                value={formData.endDatetime}
                mode="datetime"
                display="spinner"
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
                activeOpacity={0.75}
              >
                <Text style={styles.pickerDoneText}>Done</Text>
              </TouchableOpacity>
            </View>
          ) : null}

          {errors.endDatetime ? <Text style={styles.errorText}>{errors.endDatetime}</Text> : null}

          <TouchableOpacity
            style={styles.recurrenceCard}
            activeOpacity={0.82}
            onPress={() => {
              if (userBusiness?.subscription_tier !== 'premium') {
                Alert.alert(
                  'Premium Feature',
                  'Recurring events are only available for Premium businesses. Upgrade to create recurring events.',
                  [
                    { text: 'OK' },
                    {
                      text: 'Upgrade',
                      onPress: () => router.push('/(tabs)/profile'),
                    },
                  ]
                );
                return;
              }
              recurrencePickerRef.current?.present();
            }}
          >
            <View style={styles.recurrenceIconWrap}>
              <Repeat size={18} color={Design.primary} />
            </View>
            <View style={styles.recurrenceCopy}>
              <Text style={styles.fieldEyebrow}>Repeat</Text>
              <Text style={styles.recurrenceValue}>
                {getRecurrenceLabel(formData.recurrence)}
                {userBusiness?.subscription_tier !== 'premium' ? ' (Premium)' : ''}
              </Text>
            </View>
          </TouchableOpacity>
        </View>

        <View style={styles.sectionBlock}>
          <View style={styles.locationCard}>
            <View style={styles.locationSearchRow}>
              <MapPin size={20} color={Design.primary} />
              <View style={styles.locationInputWrap}>
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
                  placeholder="Search for a venue or address..."
                  approximate={false}
                  showSetButton={false}
                  showClearButton
                  style={styles.addressSearch}
                />
              </View>
            </View>

            <View style={styles.mapShell}>
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
                style={styles.map}
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
              <View style={styles.mapPinBadge}>
                <MapPin size={24} color="#FFFFFF" fill="#FFFFFF" />
              </View>
              <View style={styles.mapHint}>
                <Navigation size={12} color={Design.primary} />
                <Text style={styles.mapHintText}>Tap map to set exact location</Text>
              </View>
            </View>
          </View>
        </View>
      </ScrollView>

      <View
        style={[
          styles.bottomBar,
          { paddingBottom: Math.max(insets.bottom, 14), paddingHorizontal: 24 },
        ]}
      >
        <TouchableOpacity
          style={styles.submitWrap}
          onPress={handleSubmit}
          disabled={loading}
          activeOpacity={0.9}
        >
          <LinearGradient
            colors={loading ? ['#C96B72', '#B96C57'] : [Design.primary, Design.secondary]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 0 }}
            style={styles.submitGradient}
          >
            {loading ? (
              <ActivityIndicator color="#FFFFFF" />
            ) : (
              <>
                <Text style={styles.submitText}>Launch Event</Text>
                <Rocket size={20} color="#FFFFFF" />
              </>
            )}
          </LinearGradient>
        </TouchableOpacity>
      </View>

      <RecurrencePicker
        ref={recurrencePickerRef}
        selectedValue={formData.recurrence}
        onSelect={(v) => setFormData((f) => ({ ...f, recurrence: v }))}
      />
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: Design.surface,
  },
  scroll: {
    flex: 1,
  },
  headerWrap: {
    position: 'absolute',
    zIndex: 10,
  },
  header: {
    height: 72,
    borderRadius: 24,
    backgroundColor: 'rgba(255,255,255,0.88)',
    borderWidth: 1,
    borderColor: 'rgba(0,0,0,0.05)',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 18,
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.06,
    shadowRadius: 20,
    elevation: 5,
  },
  headerButton: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: BorderRadius.round,
  },
  headerTitle: {
    fontSize: 18,
    fontFamily: Typography.displayFontFamilies.bold,
    fontWeight: Typography.weights.bold,
    color: Design.text,
  },
  headerSpacer: {
    width: 40,
  },
  sectionBlock: {
    marginTop: 32,
  },
  sectionEyebrow: {
    marginLeft: 4,
    marginBottom: 14,
    color: Design.textMuted,
    fontSize: 11,
    letterSpacing: 1.8,
    textTransform: 'uppercase',
    fontFamily: Typography.fontFamilies.bold,
    fontWeight: Typography.weights.bold,
  },
  fieldEyebrow: {
    color: Design.text,
    fontSize: 11,
    letterSpacing: 1.6,
    textTransform: 'uppercase',
    fontFamily: Typography.fontFamilies.bold,
    fontWeight: Typography.weights.bold,
    marginBottom: 14,
  },
  bannerCard: {
    gap: 12,
  },
  bannerPreview: {
    aspectRatio: 16 / 9,
    borderRadius: 30,
    overflow: 'hidden',
    borderWidth: 2,
    borderStyle: 'dashed',
    borderColor: 'rgba(172, 173, 173, 0.5)',
    backgroundColor: Design.surfaceSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  bannerImage: {
    ...StyleSheet.absoluteFillObject,
    width: '100%',
    height: '100%',
  },
  bannerPlaceholder: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  bannerPlaceholderOverlay: {
    backgroundColor: 'rgba(255,255,255,0.48)',
    paddingVertical: 24,
    paddingHorizontal: 20,
    borderRadius: 24,
  },
  bannerBadge: {
    width: 56,
    height: 56,
    borderRadius: BorderRadius.round,
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 18,
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 5 },
    shadowOpacity: 0.08,
    shadowRadius: 10,
    elevation: 4,
  },
  bannerTitle: {
    fontSize: 15,
    color: Design.text,
    fontFamily: Typography.fontFamilies.bold,
    fontWeight: Typography.weights.bold,
  },
  bannerSubtitle: {
    marginTop: 6,
    fontSize: 12,
    color: Design.textMuted,
    fontFamily: Typography.fontFamily,
    textAlign: 'center',
  },
  bannerPickerRow: {
    marginTop: -2,
  },
  infoCard: {
    backgroundColor: Design.surfaceCard,
    borderRadius: 24,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: 'rgba(0,0,0,0.05)',
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.05,
    shadowRadius: 20,
    elevation: 4,
  },
  infoSection: {
    paddingHorizontal: 20,
    paddingVertical: 22,
  },
  infoDivider: {
    height: 1,
    backgroundColor: 'rgba(0,0,0,0.06)',
  },
  titleInput: {
    fontSize: 22,
    color: Design.text,
    fontFamily: Typography.displayFontFamilies.extrabold,
    fontWeight: '800',
    paddingVertical: 0,
  },
  detailsInput: {
    minHeight: 112,
    fontSize: 16,
    lineHeight: 30,
    color: Design.textMuted,
    fontFamily: Typography.fontFamily,
    paddingVertical: 0,
  },
  categoryRow: {
    gap: 10,
    paddingRight: 24,
  },
  categoryChip: {
    minHeight: 50,
    paddingHorizontal: 20,
    borderRadius: BorderRadius.round,
    backgroundColor: Design.surfaceCard,
    borderWidth: 1,
    borderColor: 'rgba(0,0,0,0.05)',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  categoryChipSelected: {
    backgroundColor: Design.primary,
    borderColor: Design.primary,
    shadowColor: Design.primary,
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.18,
    shadowRadius: 16,
    elevation: 4,
  },
  categoryChipText: {
    fontSize: 15,
    color: Design.text,
    fontFamily: Typography.fontFamilies.semibold,
    fontWeight: Typography.weights.semibold,
  },
  categoryChipTextSelected: {
    color: '#FFFFFF',
  },
  dateTimeRow: {
    flexDirection: 'row',
    gap: 12,
  },
  dateTimeCard: {
    flex: 1,
    backgroundColor: Design.surfaceCard,
    borderRadius: 22,
    borderWidth: 1,
    borderColor: 'rgba(0,0,0,0.05)',
    paddingHorizontal: 16,
    paddingVertical: 18,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.04,
    shadowRadius: 16,
    elevation: 3,
  },
  dateIconWrap: {
    width: 42,
    height: 42,
    borderRadius: BorderRadius.round,
    backgroundColor: Design.primarySoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dateTimeCopy: {
    flex: 1,
  },
  dateTimeLabel: {
    color: Design.textMuted,
    fontSize: 11,
    letterSpacing: 1.2,
    textTransform: 'uppercase',
    marginBottom: 6,
    fontFamily: Typography.fontFamilies.bold,
    fontWeight: Typography.weights.bold,
  },
  dateTimeValue: {
    color: Design.text,
    fontSize: 16,
    fontFamily: Typography.displayFontFamilies.bold,
    fontWeight: Typography.weights.bold,
  },
  pickerCard: {
    marginTop: 12,
    backgroundColor: Design.surfaceCard,
    borderRadius: 22,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: 'rgba(0,0,0,0.05)',
  },
  picker: {
    height: 210,
    width: '100%',
  },
  pickerDoneButton: {
    alignSelf: 'center',
    marginBottom: 16,
    backgroundColor: Design.primarySoft,
    paddingHorizontal: 22,
    paddingVertical: 10,
    borderRadius: BorderRadius.round,
  },
  pickerDoneText: {
    color: Design.primary,
    fontSize: 14,
    fontFamily: Typography.fontFamilies.bold,
    fontWeight: Typography.weights.bold,
  },
  recurrenceCard: {
    marginTop: 14,
    backgroundColor: Design.surfaceCard,
    borderRadius: 22,
    borderWidth: 1,
    borderColor: 'rgba(0,0,0,0.05)',
    paddingHorizontal: 16,
    paddingVertical: 16,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  recurrenceIconWrap: {
    width: 42,
    height: 42,
    borderRadius: BorderRadius.round,
    backgroundColor: Design.primarySoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  recurrenceCopy: {
    flex: 1,
  },
  recurrenceValue: {
    fontSize: 15,
    color: Design.textMuted,
    fontFamily: Typography.fontFamilies.semibold,
    fontWeight: Typography.weights.semibold,
  },
  locationCard: {
    backgroundColor: Design.surfaceCard,
    borderRadius: 24,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: 'rgba(0,0,0,0.05)',
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.05,
    shadowRadius: 20,
    elevation: 4,
  },
  locationSearchRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    paddingHorizontal: 18,
    paddingTop: 18,
    paddingBottom: 8,
  },
  locationInputWrap: {
    flex: 1,
    minWidth: 0,
  },
  addressSearch: {
    marginBottom: 0,
  },
  mapShell: {
    height: 240,
    position: 'relative',
    overflow: 'hidden',
    borderTopWidth: 1,
    borderTopColor: 'rgba(0,0,0,0.05)',
  },
  map: {
    flex: 1,
  },
  mapPinBadge: {
    position: 'absolute',
    top: '50%',
    left: '50%',
    width: 56,
    height: 56,
    marginLeft: -28,
    marginTop: -28,
    borderRadius: BorderRadius.round,
    backgroundColor: Design.primary,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: Design.primary,
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.22,
    shadowRadius: 16,
    elevation: 5,
  },
  mapHint: {
    position: 'absolute',
    bottom: 12,
    alignSelf: 'center',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: 'rgba(255,255,255,0.9)',
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: BorderRadius.round,
  },
  mapHintText: {
    color: Design.primary,
    fontSize: 12,
    fontFamily: Typography.fontFamilies.semibold,
    fontWeight: Typography.weights.semibold,
  },
  bottomBar: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    paddingTop: 24,
    backgroundColor: 'rgba(246,246,246,0.96)',
  },
  submitWrap: {
    borderRadius: BorderRadius.round,
    overflow: 'hidden',
    shadowColor: Design.primary,
    shadowOffset: { width: 0, height: 18 },
    shadowOpacity: 0.24,
    shadowRadius: 28,
    elevation: 8,
  },
  submitGradient: {
    minHeight: 68,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
  },
  submitText: {
    color: '#FFFFFF',
    fontSize: 18,
    fontFamily: Typography.displayFontFamilies.extrabold,
    fontWeight: '800',
  },
  errorText: {
    marginTop: 10,
    color: Colors.error,
    fontSize: 12,
    fontFamily: Typography.fontFamilies.medium,
    fontWeight: Typography.weights.medium,
  },
  noBizContainer: {
    flex: 1,
    backgroundColor: Design.surface,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
  },
  noBizBadge: {
    width: 88,
    height: 88,
    borderRadius: 28,
    backgroundColor: Design.primarySoft,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 24,
  },
  noBizLogo: {
    width: 54,
    height: 54,
  },
  noBizTitle: {
    color: Design.text,
    fontSize: 28,
    fontFamily: Typography.displayFontFamilies.bold,
    fontWeight: Typography.weights.bold,
    marginBottom: 10,
  },
  noBizSubtitle: {
    color: Design.textMuted,
    fontSize: 15,
    textAlign: 'center',
    lineHeight: 24,
    marginBottom: 28,
    fontFamily: Typography.fontFamily,
  },
  noBizButton: {
    borderRadius: BorderRadius.round,
    overflow: 'hidden',
  },
  noBizButtonGradient: {
    paddingHorizontal: 28,
    paddingVertical: 16,
  },
  noBizButtonText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontFamily: Typography.fontFamilies.bold,
    fontWeight: Typography.weights.bold,
  },
});
