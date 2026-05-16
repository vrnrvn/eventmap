import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { useFocusEffect } from 'expo-router';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Alert,
  KeyboardAvoidingView,
  Platform,
  Switch,
} from 'react-native';
import * as Haptics from 'expo-haptics';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { useAuth } from '@/contexts/AuthContext';
import { useApp } from '@/contexts/AppContext';
import { usePremium } from '@/contexts/PremiumContext';
import { premiumService } from '@/services/premium';
import { profilesService } from '@/services/profiles';
import { businessesService } from '@/services/businesses';
import { eventsService } from '@/services/events';
import { Input } from '@/components/Input';
import { businessLocationStore } from '@/stores/businessLocationStore';
import { profileLocationStore } from '@/stores/profileLocationStore';
import { CategoryIcon } from '@/components/CategoryIcon';
import { ImagePickerButton, type ImageAsset } from '@/components/ImagePickerButton';
import { Colors, Spacing, Typography, BorderRadius, Shadows } from '@/constants/theme';
import {
  ArrowLeft,
  User,
  Building2,
  Settings,
  Mail,
  Heart,
  MapPin,
  Tag,
  AtSign,
  Navigation,
  Check,
  Image as ImageIcon,
  Shield,
  FileText,
  Bell,
  ChevronRight,
} from 'lucide-react-native';

const Palette = {
  gradientStart: Colors.primary,
  gradientEnd: Colors.accent,
  cardBg: Colors.background.primary,
  surfaceMuted: Colors.background.primary,
  accentSoft: 'rgba(196, 92, 62, 0.12)',
  textOnGradient: Colors.text.inverse,
  textOnGradientMuted: 'rgba(250, 248, 245, 0.75)',
  separator: Colors.border.light,
  badge: Colors.primary,
  successSoft: 'rgba(45, 138, 110, 0.12)',
  successDot: Colors.success,
};

const EVENT_REMINDER_OPTIONS: { value: number | null; label: string }[] = [
  { value: null, label: 'Off' },
  { value: 10, label: '10 minutes' },
  { value: 30, label: '30 minutes' },
  { value: 60, label: '1 hour' },
  { value: 120, label: '2 hours' },
  { value: 1440, label: '24 hours' },
];

const BUSINESS_CATEGORIES = [
  'Restaurant',
  'Bar & Nightlife',
  'Fitness & Wellness',
  'Coffee Shop',
  'Entertainment',
  'Arts & Culture',
  'Sports & Recreation',
  'Education',
  'Community',
  'Other',
];

export default function SettingsScreen() {
  const insets = useSafeAreaInsets();
  const { user, profile, refreshProfile } = useAuth();
  const { userBusiness, refreshBusiness, userMode, hasBusiness } = useApp();
  const { isPremium, refreshSubscription } = usePremium();
  const [saving, setSaving] = useState<'user' | 'business' | null>(null);
  const [savedSection, setSavedSection] = useState<'user' | 'business' | null>(null);

  const isBizMode = hasBusiness && userMode === 'business';
  const accentColor = isBizMode ? Colors.secondary : Colors.primary;
  const accentGradient: [string, string] = isBizMode
    ? [Colors.secondary, Colors.secondaryLight]
    : [Palette.gradientStart, Palette.gradientEnd];
  const accentSoft = isBizMode ? 'rgba(13, 79, 79, 0.12)' : Palette.accentSoft;

  const [userForm, setUserForm] = useState({
    name: '',
    bio: '',
    hobbies: '',
    instagram: '',
    facebook: '',
    city: '',
    lat: null as number | null,
    lng: null as number | null,
  });

  const [privacyForm, setPrivacyForm] = useState({
    showProfileToOthers: true,
    showAttendancePublicly: true,
    showFutureEvents: true,
  });

  const [notificationForm, setNotificationForm] = useState({
    newFollower: true,
    newEventFromFollowed: true,
    eventUpdate: true,
    rsvp: true,
    nearbyEvent: true,
    eventReminderEnabled: true,
    eventReminderMinutes: 60 as number | null,
  });

  const [businessNotificationForm, setBusinessNotificationForm] = useState({
    notificationsEnabled: true,
  });

  const [businessForm, setBusinessForm] = useState({
    name: '',
    category: '',
    contactEmail: '',
    address: '',
    lat: 0,
    lng: 0,
    googleReviewsUrl: '',
    instagram: '',
    facebook: '',
    venuePhotos: [] as ImageAsset[],
  });
  const originalVenuePhotoIds = useRef<string[]>([]);

  const [errors, setErrors] = useState<Record<string, string>>({});

  useFocusEffect(
    useCallback(() => {
      const biz = businessLocationStore.consume();
      if (biz) {
        setBusinessForm((p) => ({
          ...p,
          address: biz.formattedAddress,
          lat: biz.lat,
          lng: biz.lng,
        }));
      }
      const profileLoc = profileLocationStore.consume();
      if (profileLoc) {
        setUserForm((p) => ({
          ...p,
          city: profileLoc.formattedAddress,
          lat: profileLoc.lat,
          lng: profileLoc.lng,
        }));
      }
    }, [])
  );

  useEffect(() => {
    if (profile) {
      const handles = (profile.social_handles as { instagram?: string; facebook?: string } | null) ?? {};
      setUserForm({
        name: profile.name ?? '',
        bio: profile.bio ?? '',
        hobbies: profile.hobbies ?? '',
        instagram: handles.instagram ?? '',
        facebook: handles.facebook ?? '',
        city: profile.city ?? '',
        lat: profile.lat ?? null,
        lng: profile.lng ?? null,
      });
      setPrivacyForm({
        showProfileToOthers: !(profile.is_profile_private ?? false),
        showAttendancePublicly: profile.show_attendance_publicly ?? true,
        showFutureEvents: profile.show_future_events ?? true,
      });
      const prefs = (profile.notification_preferences as Record<string, boolean> | null) ?? {};
      setNotificationForm({
        newFollower: prefs.new_follower ?? true,
        newEventFromFollowed: prefs.new_event_from_followed ?? true,
        eventUpdate: prefs.event_update ?? true,
        rsvp: prefs.rsvp ?? true,
        nearbyEvent: prefs.nearby_event ?? true,
        eventReminderEnabled: profile.event_reminder_enabled ?? true,
        eventReminderMinutes: profile.event_reminder_minutes ?? 60,
      });
    }
  }, [profile]);

  useEffect(() => {
    if (userBusiness) {
      const load = async () => {
        const photos = await businessesService
          .getBusinessPhotos(userBusiness.id)
          .catch(() => []);
        const venuePhotos: ImageAsset[] = photos
          .sort((a, b) => a.sort_order - b.sort_order)
          .map((p) => ({
            uri: p.image_url,
            name: `venue-${p.id}`,
            type: 'image/jpeg',
            remoteUrl: p.image_url,
            photoId: p.id,
          }));
        originalVenuePhotoIds.current = venuePhotos
          .map((img) => img.photoId)
          .filter(Boolean) as string[];
        const handles = (userBusiness.social_handles as { instagram?: string; facebook?: string } | null) ?? {};
        setBusinessForm({
          name: userBusiness.name ?? '',
          category: userBusiness.category ?? '',
          contactEmail: userBusiness.contact_email ?? '',
          address: userBusiness.address ?? '',
          lat: userBusiness.lat ?? 0,
          lng: userBusiness.lng ?? 0,
          googleReviewsUrl: userBusiness.google_reviews_url ?? '',
          instagram: handles.instagram ?? '',
          facebook: handles.facebook ?? '',
          venuePhotos,
        });
        setBusinessNotificationForm({
          notificationsEnabled: userBusiness.notifications_enabled ?? true,
        });
      };
      load();
    }
  }, [userBusiness]);

  const showSavedFeedback = (section: 'user' | 'business') => {
    setSavedSection(section);
    setTimeout(() => setSavedSection(null), 2000);
  };

  const validateUser = () => {
    const next: Record<string, string> = {};
    if (!userForm.name.trim()) next.name = 'Name is required';
    setErrors((prev) => ({ ...prev, ...next }));
    return Object.keys(next).length === 0;
  };

  const validateBusiness = () => {
    const next: Record<string, string> = {};
    if (!businessForm.name.trim()) next.businessName = 'Business name is required';
    if (!businessForm.category) next.category = 'Category is required';
    setErrors((prev) => ({ ...prev, ...next }));
    return Object.keys(next).length === 0;
  };

  const handleSaveUser = async () => {
    if (!user || !validateUser()) return;
    setSaving('user');
    try {
      await profilesService.updateProfile(user.id, {
        name: userForm.name.trim(),
        bio: userForm.bio.trim() || null,
        hobbies: userForm.hobbies.trim() || null,
        social_handles: {
          instagram: userForm.instagram.trim() || undefined,
          facebook: userForm.facebook.trim() || undefined,
        },
        city: userForm.city.trim() || null,
        lat: userForm.lat,
        lng: userForm.lng,
      });
      await refreshProfile();
      showSavedFeedback('user');
    } catch (e) {
      Alert.alert('Error', 'Failed to save profile. Please try again.');
    } finally {
      setSaving(null);
    }
  };

  const handleSaveBusiness = async () => {
    if (!userBusiness || !validateBusiness()) return;
    setSaving('business');
    try {
      await businessesService.updateBusiness(userBusiness.id, {
        name: businessForm.name.trim(),
        category: businessForm.category,
        contact_email: businessForm.contactEmail.trim() || null,
        address: businessForm.address.trim(),
        lat: businessForm.lat,
        lng: businessForm.lng,
        google_reviews_url: businessForm.googleReviewsUrl.trim() || null,
        social_handles: {
          instagram: businessForm.instagram.trim() || undefined,
          facebook: businessForm.facebook.trim() || undefined,
        },
      });

      const { venuePhotos } = businessForm;
      const currentPhotoIds = venuePhotos.map((img) => img.photoId).filter(Boolean) as string[];
      const removedIds = originalVenuePhotoIds.current.filter((pid) => !currentPhotoIds.includes(pid));
      for (const pid of removedIds) {
        await businessesService.deleteBusinessPhoto(pid);
      }

      const uploadedUrls: string[] = [];
      for (const img of venuePhotos) {
        if (!img.photoId) {
          const url = await eventsService.uploadEventImage(
            { uri: img.uri, name: img.name, type: img.type },
            'venues'
          );
          uploadedUrls.push(url);
        }
      }

      const existingCount = venuePhotos.filter((i) => i.photoId).length;
      for (let i = 0; i < uploadedUrls.length; i++) {
        await businessesService.addBusinessPhoto(userBusiness.id, uploadedUrls[i], existingCount + i);
      }

      const updatedPhotos = await businessesService.getBusinessPhotos(userBusiness.id);
      const updatedVenuePhotos: ImageAsset[] = updatedPhotos
        .sort((a, b) => a.sort_order - b.sort_order)
        .map((p) => ({
          uri: p.image_url,
          name: `venue-${p.id}`,
          type: 'image/jpeg',
          remoteUrl: p.image_url,
          photoId: p.id,
        }));
      originalVenuePhotoIds.current = updatedVenuePhotos
        .map((img) => img.photoId)
        .filter(Boolean) as string[];
      setBusinessForm((prev) => ({ ...prev, venuePhotos: updatedVenuePhotos }));

      await refreshBusiness();
      showSavedFeedback('business');
    } catch (e) {
      Alert.alert('Error', 'Failed to save business. Please try again.');
    } finally {
      setSaving(null);
    }
  };

  const handleNotificationToggle = async (
    field: keyof typeof notificationForm,
    value: boolean | number | null
  ) => {
    if (!user) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    const next = { ...notificationForm, [field]: value };
    setNotificationForm(next);
    try {
      const prefs = {
        new_follower: next.newFollower,
        new_event_from_followed: next.newEventFromFollowed,
        event_update: next.eventUpdate,
        rsvp: next.rsvp,
        nearby_event: next.nearbyEvent,
      };
      const reminderEnabled = next.eventReminderMinutes != null;
      const reminderMinutes = next.eventReminderMinutes ?? null;
      await profilesService.updateProfile(user.id, {
        notification_preferences: prefs,
        event_reminder_enabled: reminderEnabled,
        event_reminder_minutes: reminderMinutes,
      });
      await refreshProfile();
    } catch (e) {
      setNotificationForm(notificationForm);
      Alert.alert('Error', 'Failed to update notification settings. Please try again.');
    }
  };

  const handleBusinessNotificationToggle = async (value: boolean) => {
    if (!userBusiness) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    const prev = businessNotificationForm.notificationsEnabled;
    setBusinessNotificationForm({ notificationsEnabled: value });
    try {
      await businessesService.updateBusiness(userBusiness.id, {
        notifications_enabled: value,
      });
      await refreshBusiness();
    } catch (e) {
      setBusinessNotificationForm({ notificationsEnabled: prev });
      Alert.alert('Error', 'Failed to update notification settings. Please try again.');
    }
  };

  const handlePrivacyToggle = async (
    field: 'showProfileToOthers' | 'showAttendancePublicly' | 'showFutureEvents',
    value: boolean
  ) => {
    if (!user) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    const next = { ...privacyForm, [field]: value };
    setPrivacyForm(next);
    try {
      await profilesService.updateProfile(user.id, {
        is_profile_private: !next.showProfileToOthers,
        show_attendance_publicly: next.showAttendancePublicly,
        show_future_events: next.showFutureEvents,
      });
      await refreshProfile();
      if (field === 'showProfileToOthers' && !value) {
        Alert.alert(
          'Profile is now private',
          "Others won't be able to see your profile or find you in search."
        );
      }
    } catch (e) {
      setPrivacyForm(privacyForm);
      Alert.alert('Error', 'Failed to update privacy settings. Please try again.');
    }
  };

  const userFormDirty = useMemo(() => {
    if (!profile) return false;
    const handles = (profile.social_handles as { instagram?: string; facebook?: string } | null) ?? {};
    return (
      (userForm.name ?? '') !== (profile.name ?? '') ||
      (userForm.bio ?? '') !== (profile.bio ?? '') ||
      (userForm.hobbies ?? '') !== (profile.hobbies ?? '') ||
      (userForm.instagram ?? '') !== (handles.instagram ?? '') ||
      (userForm.facebook ?? '') !== (handles.facebook ?? '') ||
      (userForm.city ?? '') !== (profile.city ?? '') ||
      userForm.lat !== (profile.lat ?? null) ||
      userForm.lng !== (profile.lng ?? null)
    );
  }, [profile, userForm]);

  const businessFormDirty = useMemo(() => {
    if (!userBusiness) return false;
    const handles = (userBusiness.social_handles as { instagram?: string; facebook?: string } | null) ?? {};
    const currentPhotoIds = businessForm.venuePhotos
      .map((img) => img.photoId)
      .filter(Boolean) as string[];
    const originalIds = originalVenuePhotoIds.current;
    const photosChanged =
      currentPhotoIds.length !== originalIds.length ||
      currentPhotoIds.some((id) => !originalIds.includes(id)) ||
      originalIds.some((id) => !currentPhotoIds.includes(id));
    return (
      (businessForm.name ?? '') !== (userBusiness.name ?? '') ||
      (businessForm.category ?? '') !== (userBusiness.category ?? '') ||
      (businessForm.contactEmail ?? '') !== (userBusiness.contact_email ?? '') ||
      (businessForm.address ?? '') !== (userBusiness.address ?? '') ||
      businessForm.lat !== (userBusiness.lat ?? 0) ||
      businessForm.lng !== (userBusiness.lng ?? 0) ||
      (businessForm.googleReviewsUrl ?? '') !== (userBusiness.google_reviews_url ?? '') ||
      (businessForm.instagram ?? '') !== (handles.instagram ?? '') ||
      (businessForm.facebook ?? '') !== (handles.facebook ?? '') ||
      photosChanged
    );
  }, [userBusiness, businessForm]);

  const handleUnsubscribePremium = async () => {
    if (!userBusiness || !isPremium) return;
    Alert.alert(
      'Unsubscribe from Premium',
      'Are you sure you want to go back to a regular account? You will lose premium features.',
      [
        { text: 'Keep Premium', style: 'cancel' },
        {
          text: 'Unsubscribe',
          style: 'destructive',
          onPress: async () => {
            try {
              // Mock downgrade to free plan
              await premiumService.subscribeToPlan(userBusiness.id, 'free', 'monthly');
              await refreshBusiness();
              await refreshSubscription();
              Alert.alert('Premium canceled', 'You are now on a regular account.');
            } catch (e) {
              console.error('Failed to unsubscribe from premium', e);
              Alert.alert('Error', 'Failed to unsubscribe. Please try again.');
            }
          },
        },
      ]
    );
  };

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      {/* ── Header ── */}
      <View style={styles.header}>
        <TouchableOpacity
          style={styles.backBtn}
          onPress={() => router.back()}
          activeOpacity={0.7}
        >
          <ArrowLeft size={22} color={Colors.text.primary} />
        </TouchableOpacity>
        <View style={styles.headerCenter}>
          <View style={[styles.headerIconWrap, { backgroundColor: accentSoft }]}>
            {isBizMode ? (
              <Building2 size={18} color={accentColor} />
            ) : (
              <Settings size={18} color={accentColor} />
            )}
          </View>
          <Text style={styles.headerTitle}>
            {isBizMode ? 'Business Settings' : 'Settings'}
          </Text>
        </View>
        {isBizMode && userBusiness ? (
          <TouchableOpacity
            onPress={handleSaveBusiness}
            disabled={saving !== null || !businessFormDirty}
            activeOpacity={0.7}
            style={styles.headerSaveWrap}
          >
            <Text
              style={[
                styles.headerSaveText,
                {
                  color: businessFormDirty && saving === null ? accentColor : Colors.text.tertiary,
                },
              ]}
            >
              {saving === 'business' ? '...' : 'Save'}
            </Text>
          </TouchableOpacity>
        ) : (
          <TouchableOpacity
            onPress={handleSaveUser}
            disabled={saving !== null || !userFormDirty}
            activeOpacity={0.7}
            style={styles.headerSaveWrap}
          >
            <Text
              style={[
                styles.headerSaveText,
                {
                  color: userFormDirty && saving === null ? accentColor : Colors.text.tertiary,
                },
              ]}
            >
              {saving === 'user' ? '...' : 'Save'}
            </Text>
          </TouchableOpacity>
        )}
      </View>

      <KeyboardAvoidingView
        style={styles.keyboardView}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView
          style={styles.scroll}
          contentContainerStyle={[
            styles.scrollContent,
            { paddingBottom: insets.bottom + 40 },
          ]}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {isBizMode && userBusiness ? (
            <>
              {/* ── Business Profile Section ── */}
              <View style={styles.sectionLabelRow}>
                <Text style={styles.sectionLabel}>Business Profile</Text>
                {savedSection === 'business' && (
                  <View style={styles.savedBadge}>
                    <Check size={12} color={Palette.successDot} />
                    <Text style={styles.savedBadgeText}>Saved</Text>
                  </View>
                )}
              </View>

              <View style={styles.card}>
                {/* Business Name */}
                <View style={styles.fieldRow}>
                  <View style={[styles.fieldIcon, { backgroundColor: accentSoft }]}>
                    <Building2 size={16} color={accentColor} />
                  </View>
                  <View style={styles.fieldContent}>
                    <Input
                      label="Business Name"
                      value={businessForm.name}
                      onChangeText={(t) =>
                        setBusinessForm((p) => ({ ...p, name: t }))
                      }
                      placeholder="Business name"
                      error={errors.businessName}
                    />
                  </View>
                </View>

                <View style={styles.fieldSeparator} />

                {/* Category */}
                <View style={styles.fieldRowNoPad}>
                  <View style={[styles.fieldIcon, { marginTop: 14, backgroundColor: accentSoft }]}>
                    <Tag size={16} color={accentColor} />
                  </View>
                  <View style={styles.catContainer}>
                    <Text style={styles.catLabel}>Category</Text>
                    <ScrollView
                      horizontal
                      showsHorizontalScrollIndicator={false}
                      contentContainerStyle={styles.catScrollContent}
                    >
                      {BUSINESS_CATEGORIES.map((cat) => {
                        const selected = businessForm.category === cat;
                        return (
                          <TouchableOpacity
                            key={cat}
                            style={[
                              styles.catChip,
                              selected && { backgroundColor: accentColor, borderColor: accentColor },
                            ]}
                            onPress={() =>
                              setBusinessForm((p) => ({ ...p, category: cat }))
                            }
                            activeOpacity={0.7}
                          >
                            <CategoryIcon category={cat} size="sm" variant="pill" />
                            <Text
                              style={[
                                styles.catChipText,
                                selected && styles.catChipTextSelected,
                              ]}
                            >
                              {cat}
                            </Text>
                          </TouchableOpacity>
                        );
                      })}
                    </ScrollView>
                    {errors.category && (
                      <Text style={styles.errorText}>{errors.category}</Text>
                    )}
                  </View>
                </View>

                <View style={styles.fieldSeparator} />

                {/* Contact Email */}
                <View style={styles.fieldRow}>
                  <View style={[styles.fieldIcon, { backgroundColor: accentSoft }]}>
                    <AtSign size={16} color={accentColor} />
                  </View>
                  <View style={styles.fieldContent}>
                    <Input
                      label="Contact Email"
                      value={businessForm.contactEmail}
                      onChangeText={(t) =>
                        setBusinessForm((p) => ({ ...p, contactEmail: t }))
                      }
                      placeholder="Business contact email"
                      keyboardType="email-address"
                      autoCapitalize="none"
                    />
                  </View>
                </View>

                <View style={styles.fieldSeparator} />

                {/* Google Reviews URL */}
                <View style={styles.fieldRow}>
                  <View style={[styles.fieldIcon, { backgroundColor: accentSoft }]}>
                    <FileText size={16} color={accentColor} />
                  </View>
                  <View style={styles.fieldContent}>
                    <Input
                      label="Google Reviews URL"
                      value={businessForm.googleReviewsUrl}
                      onChangeText={(t) =>
                        setBusinessForm((p) => ({ ...p, googleReviewsUrl: t }))
                      }
                      placeholder="https://g.page/your-business/review"
                      autoCapitalize="none"
                      autoCorrect={false}
                    />
                  </View>
                </View>

                <View style={styles.fieldSeparator} />

                {/* Instagram */}
                <View style={styles.fieldRow}>
                  <View style={[styles.fieldIcon, { backgroundColor: accentSoft }]}>
                    <AtSign size={16} color={accentColor} />
                  </View>
                  <View style={styles.fieldContent}>
                    <Input
                      label="Instagram"
                      value={businessForm.instagram}
                      onChangeText={(t) =>
                        setBusinessForm((p) => ({ ...p, instagram: t }))
                      }
                      placeholder="@username or username"
                      autoCapitalize="none"
                      autoCorrect={false}
                    />
                  </View>
                </View>

                <View style={styles.fieldSeparator} />

                {/* Facebook */}
                <View style={styles.fieldRow}>
                  <View style={[styles.fieldIcon, { backgroundColor: accentSoft }]}>
                    <AtSign size={16} color={accentColor} />
                  </View>
                  <View style={styles.fieldContent}>
                    <Input
                      label="Facebook"
                      value={businessForm.facebook}
                      onChangeText={(t) =>
                        setBusinessForm((p) => ({ ...p, facebook: t }))
                      }
                      placeholder="Username or page URL"
                      autoCapitalize="none"
                      autoCorrect={false}
                    />
                  </View>
                </View>

                <View style={styles.fieldSeparator} />

                {/* Business Address */}
                <View style={styles.fieldRow}>
                  <View style={[styles.fieldIcon, { backgroundColor: accentSoft }]}>
                    <Navigation size={16} color={accentColor} />
                  </View>
                  <View style={styles.fieldContent}>
                    <Text style={styles.addressLabel}>Business Location</Text>
                    <TouchableOpacity
                      style={styles.addressTouchable}
                      onPress={() =>
                        router.push({
                          pathname: '/business-location',
                          params: {
                            address: businessForm.address,
                            lat: String(businessForm.lat),
                            lng: String(businessForm.lng),
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
                            !businessForm.address && styles.addressPlaceholder,
                          ]}
                          numberOfLines={2}
                        >
                          {businessForm.address || 'Tap to set location on map'}
                        </Text>
                      </View>
                      {(businessForm.lat !== 0 || businessForm.lng !== 0) && (
                        <Text style={styles.addressCoords}>
                          {businessForm.lat.toFixed(4)}, {businessForm.lng.toFixed(4)}
                        </Text>
                      )}
                    </TouchableOpacity>
                  </View>
                </View>

                <View style={styles.fieldSeparator} />

                {/* Venue Photos */}
                <View style={styles.fieldRowNoPad}>
                  <View style={[styles.fieldIcon, { marginTop: 14, backgroundColor: accentSoft }]}>
                    <ImageIcon size={16} color={accentColor} />
                  </View>
                  <View style={styles.fieldContent}>
                    <Text style={styles.venuePhotosLabel}>Venue Photos</Text>
                    <Text style={styles.venuePhotosHint}>
                      Add photos of your venue, gym, or place. Shown on your business page.
                    </Text>
                    <ImagePickerButton
                      images={businessForm.venuePhotos}
                      onChange={(imgs) =>
                        setBusinessForm((p) => ({ ...p, venuePhotos: imgs }))
                      }
                      maxImages={10}
                    />
                  </View>
                </View>
              </View>

              {/* ── Business Notifications ── */}
              <View style={[styles.sectionLabelRow, { marginTop: 32 }]}>
                <Text style={styles.sectionLabel}>Notifications</Text>
              </View>
              <View style={styles.card}>
                <View style={styles.privacyRow}>
                  <View style={[styles.fieldIcon, { backgroundColor: accentSoft }]}>
                    <Bell size={16} color={accentColor} />
                  </View>
                  <View style={styles.privacyContent}>
                    <Text style={styles.privacyTitle}>Receive notifications</Text>
                    <Text style={styles.privacyDesc}>
                      RSVPs and new followers
                    </Text>
                  </View>
                  <Switch
                    value={businessNotificationForm.notificationsEnabled}
                    onValueChange={handleBusinessNotificationToggle}
                    trackColor={{ false: Colors.border.medium, true: Colors.primary + '80' }}
                    thumbColor={
                      businessNotificationForm.notificationsEnabled
                        ? Colors.primary
                        : Colors.background.secondary
                    }
                  />
                </View>
              </View>

              {/* Unsubscribe from premium – only for premium business users */}
              {isBizMode && userBusiness && isPremium && (
                <TouchableOpacity
                  style={styles.unsubscribeWrap}
                  onPress={handleUnsubscribePremium}
                  activeOpacity={0.85}
                >
                  <Text style={styles.unsubscribeText}>Unsubscribe from premium</Text>
                </TouchableOpacity>
              )}
            </>
          ) : (
            <>
              {/* ── User Profile Section ── */}
              <View style={styles.sectionLabelRow}>
                <Text style={styles.sectionLabel}>Personal Profile</Text>
                {savedSection === 'user' && (
                  <View style={styles.savedBadge}>
                    <Check size={12} color={Palette.successDot} />
                    <Text style={styles.savedBadgeText}>Saved</Text>
                  </View>
                )}
              </View>

              <View style={styles.card}>
                {/* Name */}
                <View style={styles.fieldRow}>
                  <View style={styles.fieldIcon}>
                    <User size={16} color={accentColor} />
                  </View>
                  <View style={styles.fieldContent}>
                    <Input
                      label="Name"
                      value={userForm.name}
                      onChangeText={(t) => setUserForm((p) => ({ ...p, name: t }))}
                      placeholder="Your name"
                      error={errors.name}
                    />
                  </View>
                </View>

                <View style={styles.fieldSeparator} />

                {/* About me */}
                <View style={styles.fieldRow}>
                  <View style={[styles.fieldIcon, { backgroundColor: accentSoft }]}>
                    <FileText size={16} color={accentColor} />
                  </View>
                  <View style={styles.fieldContent}>
                    <Input
                      label="About me"
                      value={userForm.bio}
                      onChangeText={(t) => setUserForm((p) => ({ ...p, bio: t }))}
                      placeholder="A short bio about yourself"
                      multiline
                      numberOfLines={3}
                    />
                  </View>
                </View>

                <View style={styles.fieldSeparator} />

                {/* Hobbies */}
                <View style={styles.fieldRow}>
                  <View style={styles.fieldIcon}>
                    <Heart size={16} color={accentColor} />
                  </View>
                  <View style={styles.fieldContent}>
                    <Input
                      label="Hobbies"
                      value={userForm.hobbies}
                      onChangeText={(t) =>
                        setUserForm((p) => ({ ...p, hobbies: t }))
                      }
                      placeholder="e.g. hiking, music, cooking"
                      error={errors.hobbies}
                    />
                  </View>
                </View>

                <View style={styles.fieldSeparator} />

                {/* Instagram */}
                <View style={styles.fieldRow}>
                  <View style={[styles.fieldIcon, { backgroundColor: accentSoft }]}>
                    <AtSign size={16} color={accentColor} />
                  </View>
                  <View style={styles.fieldContent}>
                    <Input
                      label="Instagram"
                      value={userForm.instagram}
                      onChangeText={(t) => setUserForm((p) => ({ ...p, instagram: t }))}
                      placeholder="@username or username"
                      autoCapitalize="none"
                      autoCorrect={false}
                    />
                  </View>
                </View>

                <View style={styles.fieldSeparator} />

                {/* Facebook */}
                <View style={styles.fieldRow}>
                  <View style={[styles.fieldIcon, { backgroundColor: accentSoft }]}>
                    <AtSign size={16} color={accentColor} />
                  </View>
                  <View style={styles.fieldContent}>
                    <Input
                      label="Facebook"
                      value={userForm.facebook}
                      onChangeText={(t) => setUserForm((p) => ({ ...p, facebook: t }))}
                      placeholder="Username or profile URL"
                      autoCapitalize="none"
                      autoCorrect={false}
                    />
                  </View>
                </View>

                <View style={styles.fieldSeparator} />

                {/* Email (read-only) */}
                <View style={styles.fieldRow}>
                  <View style={[styles.fieldIcon, styles.fieldIconMuted]}>
                    <Mail size={16} color={Colors.text.tertiary} />
                  </View>
                  <View style={styles.fieldContent}>
                    <Input
                      label="Email"
                      value={user?.email ?? ''}
                      editable={false}
                      placeholder="Email"
                    />
                  </View>
                </View>

                <View style={styles.fieldSeparator} />

                {/* Location */}
                <View style={styles.fieldRow}>
                  <View style={styles.fieldIcon}>
                    <Navigation size={16} color={accentColor} />
                  </View>
                  <View style={styles.fieldContent}>
                    <Text style={styles.addressLabel}>Location</Text>
                    <TouchableOpacity
                      style={styles.addressTouchable}
                      onPress={() =>
                        router.push({
                          pathname: '/business-location',
                          params: {
                            context: 'profile',
                            address: userForm.city ?? '',
                            lat:
                              userForm.lat != null && !Number.isNaN(userForm.lat)
                                ? String(userForm.lat)
                                : '',
                            lng:
                              userForm.lng != null && !Number.isNaN(userForm.lng)
                                ? String(userForm.lng)
                                : '',
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
                            !userForm.city && styles.addressPlaceholder,
                          ]}
                          numberOfLines={2}
                        >
                          {userForm.city || 'Tap to set location on map'}
                        </Text>
                      </View>
                      {userForm.lat != null &&
                        userForm.lng != null &&
                        !Number.isNaN(userForm.lat) &&
                        !Number.isNaN(userForm.lng) && (
                          <Text style={styles.addressCoords}>
                            {userForm.lat.toFixed(4)}, {userForm.lng.toFixed(4)}
                          </Text>
                        )}
                    </TouchableOpacity>
                  </View>
                </View>
              </View>

              {/* ── Privacy & Visibility Section ── */}
              <View style={[styles.sectionLabelRow, { marginTop: 32 }]}>
                <Text style={styles.sectionLabel}>Privacy & Visibility</Text>
              </View>
              <View style={styles.card}>
                <View style={styles.privacyRow}>
                  <View style={[styles.fieldIcon, { backgroundColor: accentSoft }]}>
                    <Shield size={16} color={accentColor} />
                  </View>
                  <View style={styles.privacyContent}>
                    <Text style={styles.privacyTitle}>Show my profile to others</Text>
                    <Text style={styles.privacyDesc}>
                      Let others view your profile, bio, and social links
                    </Text>
                  </View>
                  <Switch
                    value={privacyForm.showProfileToOthers}
                    onValueChange={(v) => handlePrivacyToggle('showProfileToOthers', v)}
                    trackColor={{ false: Colors.border.medium, true: Colors.primary + '80' }}
                    thumbColor={
                      privacyForm.showProfileToOthers ? Colors.primary : Colors.background.secondary
                    }
                  />
                </View>
                <View style={styles.fieldSeparator} />
                <View style={styles.privacyRow}>
                  <View style={[styles.fieldIcon, { backgroundColor: accentSoft }]}>
                    <Shield size={16} color={accentColor} />
                  </View>
                  <View style={styles.privacyContent}>
                    <Text style={styles.privacyTitle}>Allow others to see which events I attend?</Text>
                    <Text style={styles.privacyDesc}>
                      Show your name in the "Who's Going" list when you RSVP
                    </Text>
                  </View>
                  <Switch
                    value={privacyForm.showAttendancePublicly}
                    onValueChange={(v) => handlePrivacyToggle('showAttendancePublicly', v)}
                    trackColor={{ false: Colors.border.medium, true: Colors.primary + '80' }}
                    thumbColor={
                      privacyForm.showAttendancePublicly
                        ? Colors.primary
                        : Colors.background.secondary
                    }
                  />
                </View>
                <View style={styles.fieldSeparator} />
                <View style={styles.privacyRow}>
                  <View style={[styles.fieldIcon, { backgroundColor: accentSoft }]}>
                    <Shield size={16} color={accentColor} />
                  </View>
                  <View style={styles.privacyContent}>
                    <Text style={styles.privacyTitle}>Show my upcoming events on my profile?</Text>
                    <Text style={styles.privacyDesc}>
                      Display events you're planning to attend on your public profile
                    </Text>
                  </View>
                  <Switch
                    value={privacyForm.showFutureEvents}
                    onValueChange={(v) => handlePrivacyToggle('showFutureEvents', v)}
                    trackColor={{ false: Colors.border.medium, true: Colors.primary + '80' }}
                    thumbColor={
                      privacyForm.showFutureEvents ? Colors.primary : Colors.background.secondary
                    }
                  />
                </View>
              </View>

              {/* ── Notifications Section ── */}
              <View style={[styles.sectionLabelRow, { marginTop: 32 }]}>
                <Text style={styles.sectionLabel}>Notifications</Text>
              </View>
              <View style={styles.card}>
                <View style={styles.privacyRow}>
                  <View style={[styles.fieldIcon, { backgroundColor: accentSoft }]}>
                    <Bell size={16} color={accentColor} />
                  </View>
                  <View style={styles.privacyContent}>
                    <Text style={styles.privacyTitle}>New followers</Text>
                    <Text style={styles.privacyDesc}>When someone follows your business</Text>
                  </View>
                  <Switch
                    value={notificationForm.newFollower}
                    onValueChange={(v) => handleNotificationToggle('newFollower', v)}
                    trackColor={{ false: Colors.border.medium, true: Colors.primary + '80' }}
                    thumbColor={
                      notificationForm.newFollower ? Colors.primary : Colors.background.secondary
                    }
                  />
                </View>
                <View style={styles.fieldSeparator} />
                <View style={styles.privacyRow}>
                  <View style={[styles.fieldIcon, { backgroundColor: accentSoft }]}>
                    <Bell size={16} color={accentColor} />
                  </View>
                  <View style={styles.privacyContent}>
                    <Text style={styles.privacyTitle}>New events from followed businesses</Text>
                    <Text style={styles.privacyDesc}>When a business you follow posts an event</Text>
                  </View>
                  <Switch
                    value={notificationForm.newEventFromFollowed}
                    onValueChange={(v) => handleNotificationToggle('newEventFromFollowed', v)}
                    trackColor={{ false: Colors.border.medium, true: Colors.primary + '80' }}
                    thumbColor={
                      notificationForm.newEventFromFollowed
                        ? Colors.primary
                        : Colors.background.secondary
                    }
                  />
                </View>
                <View style={styles.fieldSeparator} />
                <View style={styles.privacyRow}>
                  <View style={[styles.fieldIcon, { backgroundColor: accentSoft }]}>
                    <Bell size={16} color={accentColor} />
                  </View>
                  <View style={styles.privacyContent}>
                    <Text style={styles.privacyTitle}>Event updates</Text>
                    <Text style={styles.privacyDesc}>When an event you RSVP'd to changes</Text>
                  </View>
                  <Switch
                    value={notificationForm.eventUpdate}
                    onValueChange={(v) => handleNotificationToggle('eventUpdate', v)}
                    trackColor={{ false: Colors.border.medium, true: Colors.primary + '80' }}
                    thumbColor={
                      notificationForm.eventUpdate ? Colors.primary : Colors.background.secondary
                    }
                  />
                </View>
                <View style={styles.fieldSeparator} />
                <View style={styles.privacyRow}>
                  <View style={[styles.fieldIcon, { backgroundColor: accentSoft }]}>
                    <Bell size={16} color={accentColor} />
                  </View>
                  <View style={styles.privacyContent}>
                    <Text style={styles.privacyTitle}>RSVPs</Text>
                    <Text style={styles.privacyDesc}>When someone RSVPs to your event</Text>
                  </View>
                  <Switch
                    value={notificationForm.rsvp}
                    onValueChange={(v) => handleNotificationToggle('rsvp', v)}
                    trackColor={{ false: Colors.border.medium, true: Colors.primary + '80' }}
                    thumbColor={
                      notificationForm.rsvp ? Colors.primary : Colors.background.secondary
                    }
                  />
                </View>
                <View style={styles.fieldSeparator} />
                <View style={styles.privacyRow}>
                  <View style={[styles.fieldIcon, { backgroundColor: accentSoft }]}>
                    <Bell size={16} color={accentColor} />
                  </View>
                  <View style={styles.privacyContent}>
                    <Text style={styles.privacyTitle}>Nearby events</Text>
                    <Text style={styles.privacyDesc}>Events starting soon near you</Text>
                  </View>
                  <Switch
                    value={notificationForm.nearbyEvent}
                    onValueChange={(v) => handleNotificationToggle('nearbyEvent', v)}
                    trackColor={{ false: Colors.border.medium, true: Colors.primary + '80' }}
                    thumbColor={
                      notificationForm.nearbyEvent ? Colors.primary : Colors.background.secondary
                    }
                  />
                </View>
                <View style={styles.fieldSeparator} />
                <View style={styles.privacyRow}>
                  <View style={[styles.fieldIcon, { backgroundColor: accentSoft }]}>
                    <Bell size={16} color={accentColor} />
                  </View>
                  <View style={styles.privacyContent}>
                    <Text style={styles.privacyTitle}>Event reminder</Text>
                    <Text style={styles.privacyDesc}>
                      Remind me before events I'm attending
                    </Text>
                  </View>
                  <Switch
                    value={notificationForm.eventReminderMinutes != null}
                    onValueChange={(v) =>
                      handleNotificationToggle(
                        'eventReminderMinutes',
                        v ? 60 : null
                      )
                    }
                    trackColor={{ false: Colors.border.medium, true: Colors.primary + '80' }}
                    thumbColor={
                      notificationForm.eventReminderMinutes != null
                        ? Colors.primary
                        : Colors.background.secondary
                    }
                  />
                </View>
                {notificationForm.eventReminderMinutes != null && (
                  <>
                    <View style={styles.fieldSeparator} />
                    <View style={styles.fieldRowNoPad}>
                      <View style={[styles.fieldIcon, { marginTop: 14, backgroundColor: accentSoft }]}>
                        <Bell size={16} color={accentColor} />
                      </View>
                      <View style={styles.fieldContent}>
                        <Text style={styles.catLabel}>Remind me</Text>
                        <ScrollView
                          horizontal
                          showsHorizontalScrollIndicator={false}
                          contentContainerStyle={styles.catScrollContent}
                        >
                          {EVENT_REMINDER_OPTIONS.filter((o) => o.value != null).map((opt) => {
                            const selected =
                              notificationForm.eventReminderMinutes === opt.value;
                            return (
                              <TouchableOpacity
                                key={String(opt.value)}
                                style={[
                                  styles.catChip,
                                  selected && {
                                    backgroundColor: accentColor,
                                    borderColor: accentColor,
                                  },
                                ]}
                                onPress={() =>
                                  handleNotificationToggle('eventReminderMinutes', opt.value)
                                }
                                activeOpacity={0.7}
                              >
                                <Text
                                  style={[
                                    styles.catChipText,
                                    selected && styles.catChipTextSelected,
                                  ]}
                                >
                                  {opt.label}
                                </Text>
                              </TouchableOpacity>
                            );
                          })}
                        </ScrollView>
                      </View>
                    </View>
                  </>
                )}
              </View>

              {/* ── About Section ── */}
              <View style={[styles.sectionLabelRow, { marginTop: 32 }]}> 
                <Text style={styles.sectionLabel}>About</Text>
              </View>
              <View style={styles.card}>
                <TouchableOpacity
                  style={styles.aboutRow}
                  onPress={() => router.push('/settings/faq')}
                  activeOpacity={0.7}
                >
                  <View style={[styles.fieldIcon, { backgroundColor: accentSoft }]}>
                    <FileText size={16} color={accentColor} />
                  </View>
                  <View style={styles.privacyContent}>
                    <Text style={styles.privacyTitle}>FAQ</Text>
                    <Text style={styles.privacyDesc}>Quick answers to common questions</Text>
                  </View>
                  <ChevronRight size={18} color={Colors.text.tertiary} />
                </TouchableOpacity>

                <View style={styles.fieldSeparator} />

                <TouchableOpacity
                  style={styles.aboutRow}
                  onPress={() => router.push('/settings/disclaimers')}
                  activeOpacity={0.7}
                >
                  <View style={[styles.fieldIcon, { backgroundColor: accentSoft }]}>
                    <Shield size={16} color={accentColor} />
                  </View>
                  <View style={styles.privacyContent}>
                    <Text style={styles.privacyTitle}>Disclaimers</Text>
                    <Text style={styles.privacyDesc}>Important notes about events, safety, and accuracy</Text>
                  </View>
                  <ChevronRight size={18} color={Colors.text.tertiary} />
                </TouchableOpacity>
              </View>
            </>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

/* ────────────────────────── STYLES ────────────────────────── */

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: Palette.surfaceMuted,
  },

  /* ── Header ── */
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 14,
    backgroundColor: Palette.cardBg,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Palette.separator,
  },
  backBtn: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: Palette.surfaceMuted,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerCenter: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  headerIconWrap: {
    width: 34,
    height: 34,
    borderRadius: 10,
    backgroundColor: Palette.accentSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: {
    fontSize: Typography.sizes.lg,
    fontFamily: Typography.fontFamilies.bold,
    fontWeight: Typography.weights.bold,
    color: Colors.text.primary,
  },
  headerSaveWrap: {
    paddingVertical: 8,
    paddingHorizontal: 12,
    minWidth: 48,
    alignItems: 'flex-end',
  },
  headerSaveText: {
    fontSize: Typography.sizes.md,
    fontFamily: Typography.fontFamilies.semibold,
    fontWeight: Typography.weights.semibold,
  },

  keyboardView: {
    flex: 1,
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: 20,
    paddingTop: 24,
  },

  /* ── Section label ── */
  sectionLabelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 10,
    marginLeft: 4,
  },
  sectionLabel: {
    fontSize: Typography.sizes.sm,
    fontFamily: Typography.fontFamilies.semibold,
    fontWeight: Typography.weights.semibold,
    color: Colors.text.tertiary,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
  },
  savedBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: Palette.successSoft,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 10,
  },
  savedBadgeText: {
    fontSize: Typography.sizes.xs,
    fontFamily: Typography.fontFamilies.semibold,
    fontWeight: Typography.weights.semibold,
    color: Palette.successDot,
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
  fieldIconMuted: {
    backgroundColor: Palette.surfaceMuted,
  },
  fieldContent: {
    flex: 1,
  },
  fieldSeparator: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: Palette.separator,
    marginLeft: 66,
  },

  /* ── Privacy rows ── */
  privacyRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 14,
    gap: 14,
  },
  aboutRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 14,
    gap: 14,
  },
  privacyContent: {
    flex: 1,
  },
  privacyTitle: {
    fontSize: Typography.sizes.md,
    fontFamily: Typography.fontFamilies.semibold,
    fontWeight: Typography.weights.semibold,
    color: Colors.text.primary,
    marginBottom: 2,
  },
  privacyDesc: {
    fontSize: Typography.sizes.sm,
    fontFamily: Typography.fontFamily,
    color: Colors.text.tertiary,
    lineHeight: 18,
  },

  /* ── Category chips ── */
  catContainer: {
    flex: 1,
    paddingVertical: 10,
  },
  venuePhotosLabel: {
    fontSize: Typography.sizes.sm,
    fontFamily: Typography.fontFamilies.medium,
    fontWeight: Typography.weights.medium,
    color: Colors.text.secondary,
    marginBottom: 4,
  },
  venuePhotosHint: {
    fontSize: Typography.sizes.xs,
    fontFamily: Typography.fontFamily,
    color: Colors.text.tertiary,
    marginBottom: Spacing.sm,
    lineHeight: 18,
  },
  catLabel: {
    fontSize: Typography.sizes.xs,
    fontFamily: Typography.fontFamilies.medium,
    fontWeight: Typography.weights.medium,
    color: Colors.text.tertiary,
    marginBottom: 8,
    marginLeft: 4,
  },
  catScrollContent: {
    flexDirection: 'row',
    gap: 8,
    paddingRight: 16,
    paddingBottom: 4,
  },
  catChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 14,
    paddingVertical: 8,
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

  /* ── Address touchable ── */
  addressLabel: {
    fontSize: Typography.sizes.sm,
    fontFamily: Typography.fontFamilies.medium,
    fontWeight: Typography.weights.medium,
    color: Colors.text.primary,
    marginBottom: Spacing.xs,
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
    fontFamily: Typography.fontFamilies.regular ?? Typography.fontFamily,
    color: Colors.text.tertiary,
    marginTop: 4,
  },

  /* ── Error ── */
  errorText: {
    fontSize: Typography.sizes.xs,
    fontFamily: Typography.fontFamily,
    color: Colors.error,
    marginTop: 4,
    marginLeft: 4,
  },

  unsubscribeWrap: {
    marginTop: 12,
    alignItems: 'center',
    paddingVertical: 10,
  },
  unsubscribeText: {
    fontSize: Typography.sizes.sm,
    fontFamily: Typography.fontFamilies.medium,
    fontWeight: Typography.weights.medium,
    color: Colors.text.tertiary,
    textDecorationLine: 'underline',
  },

  /* ── No-business empty (not used but kept consistent) ── */
});