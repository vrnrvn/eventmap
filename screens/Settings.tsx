import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { useFocusEffect } from 'expo-router';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  KeyboardAvoidingView,
  Platform,
  Switch,
  ActivityIndicator,
} from 'react-native';
import Constants from 'expo-constants';
import * as Haptics from 'expo-haptics';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { useAuth } from '@/contexts/AuthContext';
import { useApp } from '@/contexts/AppContext';
import { usePremium } from '@/contexts/PremiumContext';
import { profilesService } from '@/services/profiles';
import { businessesService } from '@/services/businesses';
import { eventsService } from '@/services/events';
import { Input } from '@/components/Input';
import { ScreenHeader } from '@/components/ui/ScreenHeader';
import { businessLocationStore } from '@/stores/businessLocationStore';
import { profileLocationStore } from '@/stores/profileLocationStore';
import { CategoryIcon } from '@/components/CategoryIcon';
import { ImagePickerButton, type ImageAsset } from '@/components/ImagePickerButton';
import { alpha, Colors, Spacing, Typography, BorderRadius, Shadows } from '@/constants/theme';
import { clearOnboardingDraft } from '@/utils/onboardingDraft';
import { confirmAction } from '@/utils/confirm';
import { notify, notifyConfirm } from '@/utils/notify';
import { authService } from '@/services/auth';
import { deleteAccount, AccountDeletionUnavailableError } from '@/services/account';
import { supabase } from '@/services/supabase';
import {
  User,
  Building2,
  Mail,
  Heart,
  MapPin,
  Tag,
  Navigation,
  Check,
  Image as ImageIcon,
  Shield,
  RotateCcw,
  FileText,
  Bell,
  ChevronRight,
  MessageCircle,
  KeyRound,
  LogOut,
  Info,
  Trash2,
  Instagram,
  Facebook,
  Star,
  Eye,
  Users,
  CalendarDays,
  CalendarPlus,
  CalendarClock,
  CalendarCheck,
  UserPlus,
  Sparkles,
  Clock,
} from 'lucide-react-native';

const Palette = {
  gradientStart: Colors.primary,
  gradientEnd: Colors.accent,
  cardBg: Colors.surface,
  surfaceMuted: Colors.background.secondary,
  accentSoft: Colors.primarySoft,
  textOnGradient: Colors.text.inverse,
  textOnGradientMuted: alpha(Colors.surface, 0.75),
  separator: Colors.border.light,
  badge: Colors.primary,
  successSoft: Colors.successSoft,
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
  const { user, profile, refreshProfile, signOut } = useAuth();
  const { userBusiness, refreshBusiness, userMode, hasBusiness } = useApp();
  const { isPremium } = usePremium();
  const [saving, setSaving] = useState<'user' | 'business' | null>(null);
  const [savedSection, setSavedSection] = useState<'user' | 'business' | null>(null);

  const isBizMode = hasBusiness && userMode === 'business';
  const accentColor = isBizMode ? Colors.secondary : Colors.primary;
  const accentGradient: [string, string] = isBizMode
    ? [Colors.secondary, Colors.secondaryLight]
    : [Palette.gradientStart, Palette.gradientEnd];
  const accentSoft = isBizMode ? alpha(Colors.secondary, 0.12) : Palette.accentSoft;

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
    chatMessage: true,
    eventReminderEnabled: true,
    interestedReminder: true,
    eventReminderMinutes: 60 as number | null,
  });

  const [businessNotificationForm, setBusinessNotificationForm] = useState({
    notificationsEnabled: true,
  });

  const [businessForm, setBusinessForm] = useState({
    name: '',
    description: '',
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

  const [emailForm, setEmailForm] = useState({ open: false, value: '', saving: false });
  const [deletingAccount, setDeletingAccount] = useState(false);

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
        chatMessage: prefs.chat_message ?? true,
        eventReminderEnabled: profile.event_reminder_enabled ?? true,
        // Respect a saved "off" state: only default to 60 when the reminder is
        // enabled (or never configured) but has no stored minutes.
        eventReminderMinutes:
          profile.event_reminder_enabled === false
            ? null
            : profile.event_reminder_minutes ?? 60,
        interestedReminder: prefs.interested_reminder ?? true,
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
          description: userBusiness.description ?? '',
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
    // Rebuild from scratch so resolved errors clear on re-validation.
    const next: Record<string, string> = {};
    if (!userForm.name.trim()) next.name = 'Name is required';
    setErrors(next);
    return Object.keys(next).length === 0;
  };

  const validateBusiness = () => {
    // Rebuild from scratch so resolved errors clear on re-validation.
    const next: Record<string, string> = {};
    if (!businessForm.name.trim()) next.businessName = 'Business name is required';
    // Description stays optional on update: businesses created before the field
    // was required must not be blocked from saving unrelated edits.
    if (!businessForm.category) next.category = 'Category is required';
    setErrors(next);
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
      notify.error('Failed to save profile. Please try again.');
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
        description: businessForm.description.trim(),
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
      notify.error('Failed to save business. Please try again.');
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
        chat_message: next.chatMessage,
        interested_reminder: next.interestedReminder,
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
      notify.error('Failed to update notification settings. Please try again.');
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
      notify.error('Failed to update notification settings. Please try again.');
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
        notify.success("Profile is now private. Others won't see you or find you in search.");
      }
    } catch (e) {
      setPrivacyForm(privacyForm);
      notify.error('Failed to update privacy settings. Please try again.');
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
      (businessForm.description ?? '') !== (userBusiness.description ?? '') ||
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

  const handleRestartOnboarding = async () => {
    if (!user) return;
    const ok = await confirmAction({
      title: 'Redo setup?',
      message: 'Walk through the setup steps again. Your current answers are kept and shown as defaults.',
      confirmLabel: 'Start',
    });
    if (!ok) return;
    try {
      await clearOnboardingDraft(user.id);
      await profilesService.updateProfile(user.id, { has_completed_onboarding: false });
      await refreshProfile();
      router.replace('/(onboarding)' as never);
    } catch {
      notify.error('Could not restart setup. Please try again.');
    }
  };

  const handleChangePassword = () => {
    router.push('/(auth)/reset-password?mode=change' as never);
  };

  const handleChangeEmail = async () => {
    const newEmail = emailForm.value.trim();
    if (!/\S+@\S+\.\S+/.test(newEmail)) {
      notify.error('Please enter a valid email address.');
      return;
    }
    if (newEmail.toLowerCase() === (user?.email ?? '').toLowerCase()) {
      notify.error('That is already your email address.');
      return;
    }
    setEmailForm((p) => ({ ...p, saving: true }));
    try {
      await authService.updateEmail(newEmail);
      notify.success(
        `Confirmation email sent to ${newEmail}. Your email changes once you confirm it.`
      );
      setEmailForm({ open: false, value: '', saving: false });
    } catch (e) {
      notify.error(e instanceof Error ? e.message : 'Could not change email. Please try again.');
      setEmailForm((p) => ({ ...p, saving: false }));
    }
  };

  // Single cancel flow lives in /premium/manage.
  const handleManageSubscription = () => {
    router.push('/premium/manage' as never);
  };

  const handleBack = () => {
    const dirty = isBizMode ? businessFormDirty : userFormDirty;
    if (!dirty) {
      router.back();
      return;
    }
    notifyConfirm({
      title: 'Discard changes?',
      message: 'You have unsaved changes. Go back and lose them?',
      confirmLabel: 'Discard',
      cancelLabel: 'Keep editing',
      destructive: true,
      onConfirm: () => router.back(),
    });
  };

  const handleSignOut = async () => {
    const ok = await confirmAction({
      title: 'Sign Out',
      message: 'Are you sure you want to sign out?',
      confirmLabel: 'Sign Out',
      destructive: true,
    });
    if (!ok) return;
    await signOut();
    router.replace('/');
  };

  const performDeleteAccount = async () => {
    if (deletingAccount) return;
    setDeletingAccount(true);
    try {
      await deleteAccount();
      // Explicit confirmation before the auth listener routes away.
      notify.success('Your account has been deleted');
      // The session is already invalid server-side; clear the local one so the
      // auth state routes away. Failures here are harmless.
      try {
        await supabase.auth.signOut();
      } catch {
        // ignored — session is gone either way
      }
    } catch (e) {
      if (e instanceof AccountDeletionUnavailableError) {
        notify.error("Account deletion isn't enabled on this server yet.");
      } else {
        notify.error('Failed to delete account. Please try again.');
      }
    } finally {
      setDeletingAccount(false);
    }
  };

  const handleDeleteAccount = () => {
    notifyConfirm({
      title: 'Delete account?',
      message:
        'This permanently deletes your account and everything tied to it: your profile, business and its events, RSVPs, saved events, reviews, chat messages, and notifications. This cannot be undone.',
      confirmLabel: 'Continue',
      cancelLabel: 'Cancel',
      destructive: true,
      onConfirm: () => {
        notifyConfirm({
          title: 'Are you absolutely sure?',
          message: 'Your account and all of its data will be erased immediately and forever.',
          confirmLabel: 'Delete my account',
          cancelLabel: 'Keep my account',
          destructive: true,
          onConfirm: () => void performDeleteAccount(),
        });
      },
    });
  };

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      {/* ── Header ── */}
      <ScreenHeader
        title={isBizMode ? 'Business Settings' : 'Settings'}
        onBack={handleBack}
        safeArea={false}
        backgroundColor={Palette.cardBg}
        style={styles.headerBorder}
        right={
          isBizMode && userBusiness ? (
            <TouchableOpacity
              onPress={handleSaveBusiness}
              disabled={saving !== null || !businessFormDirty}
              activeOpacity={0.7}
              style={styles.headerSaveWrap}
              accessibilityRole="button"
              accessibilityLabel="Save business settings"
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              {saving === 'business' ? (
                <ActivityIndicator size="small" color={accentColor} />
              ) : (
                <Text
                  style={[
                    styles.headerSaveText,
                    {
                      color: businessFormDirty ? accentColor : Colors.text.tertiary,
                    },
                  ]}
                >
                  Save
                </Text>
              )}
            </TouchableOpacity>
          ) : (
            <TouchableOpacity
              onPress={handleSaveUser}
              disabled={saving !== null || !userFormDirty}
              activeOpacity={0.7}
              style={styles.headerSaveWrap}
              accessibilityRole="button"
              accessibilityLabel="Save settings"
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              {saving === 'user' ? (
                <ActivityIndicator size="small" color={accentColor} />
              ) : (
                <Text
                  style={[
                    styles.headerSaveText,
                    {
                      color: userFormDirty ? accentColor : Colors.text.tertiary,
                    },
                  ]}
                >
                  Save
                </Text>
              )}
            </TouchableOpacity>
          )
        }
      />

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
                      maxLength={80}
                      error={errors.businessName}
                    />
                  </View>
                </View>

                <View style={styles.fieldSeparator} />

                {/* Description */}
                <View style={styles.fieldRow}>
                  <View style={[styles.fieldIcon, { backgroundColor: accentSoft }]}>
                    <FileText size={16} color={accentColor} />
                  </View>
                  <View style={styles.fieldContent}>
                    <Input
                      label="Description"
                      value={businessForm.description}
                      onChangeText={(t) =>
                        setBusinessForm((p) => ({ ...p, description: t }))
                      }
                      placeholder="Tell people about your business"
                      maxLength={500}
                      multiline
                      numberOfLines={4}
                      error={errors.businessDescription}
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
                            accessibilityRole="button"
                            accessibilityLabel={cat}
                            accessibilityState={{ selected }}
                            hitSlop={{ top: 6, bottom: 6, left: 4, right: 4 }}
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
                    <Mail size={16} color={accentColor} />
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
                    <Star size={16} color={accentColor} />
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
                    <Instagram size={16} color={accentColor} />
                  </View>
                  <View style={styles.fieldContent}>
                    <Input
                      label="Instagram"
                      value={businessForm.instagram}
                      onChangeText={(t) =>
                        setBusinessForm((p) => ({ ...p, instagram: t }))
                      }
                      placeholder="@username or username"
                      maxLength={80}
                      autoCapitalize="none"
                      autoCorrect={false}
                    />
                  </View>
                </View>

                <View style={styles.fieldSeparator} />

                {/* Facebook */}
                <View style={styles.fieldRow}>
                  <View style={[styles.fieldIcon, { backgroundColor: accentSoft }]}>
                    <Facebook size={16} color={accentColor} />
                  </View>
                  <View style={styles.fieldContent}>
                    <Input
                      label="Facebook"
                      value={businessForm.facebook}
                      onChangeText={(t) =>
                        setBusinessForm((p) => ({ ...p, facebook: t }))
                      }
                      placeholder="Username or page URL"
                      maxLength={200}
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
                      accessibilityRole="button"
                      accessibilityLabel={
                        businessForm.address
                          ? `Business location, ${businessForm.address}`
                          : 'Set business location on map'
                      }
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
                    accessibilityLabel="Receive notifications"
                    accessibilityHint="RSVPs and new followers"
                    trackColor={{ false: Colors.border.medium, true: alpha(Colors.primary, 0.5) }}
                    thumbColor={
                      businessNotificationForm.notificationsEnabled
                        ? Colors.primary
                        : Colors.background.secondary
                    }
                  />
                </View>
              </View>

              {/* Manage subscription – only for premium business users */}
              {isBizMode && userBusiness && isPremium && (
                <TouchableOpacity
                  style={styles.unsubscribeWrap}
                  onPress={handleManageSubscription}
                  activeOpacity={0.85}
                  accessibilityRole="button"
                  accessibilityLabel="Manage subscription"
                  hitSlop={{ top: 4, bottom: 4, left: 12, right: 12 }}
                >
                  <Text style={styles.unsubscribeText}>Manage subscription</Text>
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
                      maxLength={80}
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
                      maxLength={500}
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
                      maxLength={200}
                      error={errors.hobbies}
                    />
                  </View>
                </View>

                <View style={styles.fieldSeparator} />

                {/* Instagram */}
                <View style={styles.fieldRow}>
                  <View style={[styles.fieldIcon, { backgroundColor: accentSoft }]}>
                    <Instagram size={16} color={accentColor} />
                  </View>
                  <View style={styles.fieldContent}>
                    <Input
                      label="Instagram"
                      value={userForm.instagram}
                      onChangeText={(t) => setUserForm((p) => ({ ...p, instagram: t }))}
                      placeholder="@username or username"
                      maxLength={80}
                      autoCapitalize="none"
                      autoCorrect={false}
                    />
                  </View>
                </View>

                <View style={styles.fieldSeparator} />

                {/* Facebook */}
                <View style={styles.fieldRow}>
                  <View style={[styles.fieldIcon, { backgroundColor: accentSoft }]}>
                    <Facebook size={16} color={accentColor} />
                  </View>
                  <View style={styles.fieldContent}>
                    <Input
                      label="Facebook"
                      value={userForm.facebook}
                      onChangeText={(t) => setUserForm((p) => ({ ...p, facebook: t }))}
                      placeholder="Username or profile URL"
                      maxLength={200}
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
                      accessibilityRole="button"
                      accessibilityLabel={
                        userForm.city ? `Location, ${userForm.city}` : 'Set location on map'
                      }
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
                    <Eye size={16} color={accentColor} />
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
                    accessibilityLabel="Show my profile to others"
                    accessibilityHint="Let others view your profile, bio, and social links"
                    trackColor={{ false: Colors.border.medium, true: alpha(Colors.primary, 0.5) }}
                    thumbColor={
                      privacyForm.showProfileToOthers ? Colors.primary : Colors.background.secondary
                    }
                  />
                </View>
                <View style={styles.fieldSeparator} />
                <View style={styles.privacyRow}>
                  <View style={[styles.fieldIcon, { backgroundColor: accentSoft }]}>
                    <Users size={16} color={accentColor} />
                  </View>
                  <View style={styles.privacyContent}>
                    <Text style={styles.privacyTitle}>Show my event attendance</Text>
                    <Text style={styles.privacyDesc}>
                      Show your name in the &quot;Who&apos;s Going&quot; list when you RSVP
                    </Text>
                  </View>
                  <Switch
                    value={privacyForm.showAttendancePublicly}
                    onValueChange={(v) => handlePrivacyToggle('showAttendancePublicly', v)}
                    accessibilityLabel="Show my event attendance"
                    accessibilityHint="Show your name in the Who's Going list when you RSVP"
                    trackColor={{ false: Colors.border.medium, true: alpha(Colors.primary, 0.5) }}
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
                    <CalendarDays size={16} color={accentColor} />
                  </View>
                  <View style={styles.privacyContent}>
                    <Text style={styles.privacyTitle}>Show my future events</Text>
                    <Text style={styles.privacyDesc}>
                      Display events you&apos;re planning to attend on your public profile
                    </Text>
                  </View>
                  <Switch
                    value={privacyForm.showFutureEvents}
                    onValueChange={(v) => handlePrivacyToggle('showFutureEvents', v)}
                    accessibilityLabel="Show my future events"
                    accessibilityHint="Display events you're planning to attend on your public profile"
                    trackColor={{ false: Colors.border.medium, true: alpha(Colors.primary, 0.5) }}
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
                    <UserPlus size={16} color={accentColor} />
                  </View>
                  <View style={styles.privacyContent}>
                    <Text style={styles.privacyTitle}>New followers</Text>
                    <Text style={styles.privacyDesc}>When someone follows you</Text>
                  </View>
                  <Switch
                    value={notificationForm.newFollower}
                    onValueChange={(v) => handleNotificationToggle('newFollower', v)}
                    accessibilityLabel="New followers"
                    accessibilityHint="When someone follows you"
                    trackColor={{ false: Colors.border.medium, true: alpha(Colors.primary, 0.5) }}
                    thumbColor={
                      notificationForm.newFollower ? Colors.primary : Colors.background.secondary
                    }
                  />
                </View>
                <View style={styles.fieldSeparator} />
                <View style={styles.privacyRow}>
                  <View style={[styles.fieldIcon, { backgroundColor: accentSoft }]}>
                    <CalendarPlus size={16} color={accentColor} />
                  </View>
                  <View style={styles.privacyContent}>
                    <Text style={styles.privacyTitle}>New events from followed businesses</Text>
                    <Text style={styles.privacyDesc}>When a business you follow posts an event</Text>
                  </View>
                  <Switch
                    value={notificationForm.newEventFromFollowed}
                    onValueChange={(v) => handleNotificationToggle('newEventFromFollowed', v)}
                    accessibilityLabel="New events from followed businesses"
                    accessibilityHint="When a business you follow posts an event"
                    trackColor={{ false: Colors.border.medium, true: alpha(Colors.primary, 0.5) }}
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
                    <CalendarClock size={16} color={accentColor} />
                  </View>
                  <View style={styles.privacyContent}>
                    <Text style={styles.privacyTitle}>Event updates</Text>
                    <Text style={styles.privacyDesc}>When an event you RSVP&apos;d to changes</Text>
                  </View>
                  <Switch
                    value={notificationForm.eventUpdate}
                    onValueChange={(v) => handleNotificationToggle('eventUpdate', v)}
                    accessibilityLabel="Event updates"
                    accessibilityHint="When an event you RSVP'd to changes"
                    trackColor={{ false: Colors.border.medium, true: alpha(Colors.primary, 0.5) }}
                    thumbColor={
                      notificationForm.eventUpdate ? Colors.primary : Colors.background.secondary
                    }
                  />
                </View>
                {/* RSVPs only make sense for accounts that host events */}
                {hasBusiness && (
                  <>
                    <View style={styles.fieldSeparator} />
                    <View style={styles.privacyRow}>
                      <View style={[styles.fieldIcon, { backgroundColor: accentSoft }]}>
                        <CalendarCheck size={16} color={accentColor} />
                      </View>
                      <View style={styles.privacyContent}>
                        <Text style={styles.privacyTitle}>RSVPs</Text>
                        <Text style={styles.privacyDesc}>When someone RSVPs to your event</Text>
                      </View>
                      <Switch
                        value={notificationForm.rsvp}
                        onValueChange={(v) => handleNotificationToggle('rsvp', v)}
                        accessibilityLabel="RSVPs"
                        accessibilityHint="When someone RSVPs to your event"
                        trackColor={{ false: Colors.border.medium, true: alpha(Colors.primary, 0.5) }}
                        thumbColor={
                          notificationForm.rsvp ? Colors.primary : Colors.background.secondary
                        }
                      />
                    </View>
                  </>
                )}
                <View style={styles.fieldSeparator} />
                <View style={styles.privacyRow}>
                  <View style={[styles.fieldIcon, { backgroundColor: accentSoft }]}>
                    <MapPin size={16} color={accentColor} />
                  </View>
                  <View style={styles.privacyContent}>
                    <Text style={styles.privacyTitle}>Nearby events</Text>
                    <Text style={styles.privacyDesc}>Events starting soon near you</Text>
                  </View>
                  <Switch
                    value={notificationForm.nearbyEvent}
                    onValueChange={(v) => handleNotificationToggle('nearbyEvent', v)}
                    accessibilityLabel="Nearby events"
                    accessibilityHint="Events starting soon near you"
                    trackColor={{ false: Colors.border.medium, true: alpha(Colors.primary, 0.5) }}
                    thumbColor={
                      notificationForm.nearbyEvent ? Colors.primary : Colors.background.secondary
                    }
                  />
                </View>
                <View style={styles.fieldSeparator} />
                <View style={styles.privacyRow}>
                  <View style={[styles.fieldIcon, { backgroundColor: accentSoft }]}>
                    <MessageCircle size={16} color={accentColor} />
                  </View>
                  <View style={styles.privacyContent}>
                    <Text style={styles.privacyTitle}>Event chat messages</Text>
                    <Text style={styles.privacyDesc}>New messages in chats for events you&apos;re going to</Text>
                  </View>
                  <Switch
                    value={notificationForm.chatMessage}
                    onValueChange={(v) => handleNotificationToggle('chatMessage', v)}
                    accessibilityLabel="Event chat messages"
                    accessibilityHint="New messages in chats for events you're going to"
                    trackColor={{ false: Colors.border.medium, true: alpha(Colors.primary, 0.5) }}
                    thumbColor={
                      notificationForm.chatMessage ? Colors.primary : Colors.background.secondary
                    }
                  />
                </View>
                <View style={styles.fieldSeparator} />
                <View style={styles.privacyRow}>
                  <View style={[styles.fieldIcon, { backgroundColor: accentSoft }]}>
                    <Sparkles size={16} color={accentColor} />
                  </View>
                  <View style={styles.privacyContent}>
                    <Text style={styles.privacyTitle}>Interested nudge</Text>
                    <Text style={styles.privacyDesc}>
                      A &quot;still interested?&quot; note the day before events you marked
                    </Text>
                  </View>
                  <Switch
                    value={notificationForm.interestedReminder}
                    onValueChange={(v) => handleNotificationToggle('interestedReminder', v)}
                    accessibilityLabel="Interested nudge"
                    accessibilityHint="A still interested note the day before events you marked"
                    trackColor={{ false: Colors.border.medium, true: alpha(Colors.primary, 0.5) }}
                    thumbColor={
                      notificationForm.interestedReminder ? Colors.primary : Colors.background.secondary
                    }
                  />
                </View>
                <View style={styles.fieldSeparator} />
                <View style={styles.privacyRow}>
                  <View style={[styles.fieldIcon, { backgroundColor: accentSoft }]}>
                    <Clock size={16} color={accentColor} />
                  </View>
                  <View style={styles.privacyContent}>
                    <Text style={styles.privacyTitle}>Event reminder</Text>
                    <Text style={styles.privacyDesc}>
                      Remind me before events I&apos;m attending
                    </Text>
                  </View>
                  <Switch
                    value={notificationForm.eventReminderMinutes != null}
                    accessibilityLabel="Event reminder"
                    accessibilityHint="Remind me before events I'm attending"
                    onValueChange={(v) =>
                      handleNotificationToggle(
                        'eventReminderMinutes',
                        v ? 60 : null
                      )
                    }
                    trackColor={{ false: Colors.border.medium, true: alpha(Colors.primary, 0.5) }}
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
                        <Clock size={16} color={accentColor} />
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
                                accessibilityRole="button"
                                accessibilityLabel={opt.label}
                                accessibilityState={{ selected }}
                                hitSlop={{ top: 6, bottom: 6, left: 4, right: 4 }}
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
                  accessibilityRole="button"
                  accessibilityLabel="FAQ"
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
                  accessibilityRole="button"
                  accessibilityLabel="Disclaimers"
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

                <View style={styles.fieldSeparator} />

                <View style={styles.aboutRow}>
                  <View style={[styles.fieldIcon, styles.fieldIconMuted]}>
                    <Info size={16} color={Colors.text.tertiary} />
                  </View>
                  <View style={styles.privacyContent}>
                    <Text style={styles.privacyTitle}>App version</Text>
                    <Text style={styles.privacyDesc}>
                      {Constants.expoConfig?.version ?? 'Unknown'}
                    </Text>
                  </View>
                </View>
              </View>

              {/* ── Account Section ── */}
              <View style={[styles.sectionLabelRow, { marginTop: 32 }]}>
                <Text style={styles.sectionLabel}>Account</Text>
              </View>
              <View style={styles.card}>
                <TouchableOpacity
                  style={styles.aboutRow}
                  onPress={handleRestartOnboarding}
                  activeOpacity={0.7}
                  accessibilityRole="button"
                  accessibilityLabel="Redo setup"
                >
                  <View style={[styles.fieldIcon, { backgroundColor: accentSoft }]}>
                    <RotateCcw size={16} color={accentColor} />
                  </View>
                  <View style={styles.privacyContent}>
                    <Text style={styles.privacyTitle}>Redo setup</Text>
                    <Text style={styles.privacyDesc}>Run the welcome steps again: photo, interests, privacy</Text>
                  </View>
                  <ChevronRight size={18} color={Colors.text.tertiary} />
                </TouchableOpacity>

                <View style={styles.fieldSeparator} />

                <TouchableOpacity
                  style={styles.aboutRow}
                  onPress={handleChangePassword}
                  activeOpacity={0.7}
                  accessibilityRole="button"
                  accessibilityLabel="Change password"
                >
                  <View style={[styles.fieldIcon, { backgroundColor: accentSoft }]}>
                    <KeyRound size={16} color={accentColor} />
                  </View>
                  <View style={styles.privacyContent}>
                    <Text style={styles.privacyTitle}>Change password</Text>
                    <Text style={styles.privacyDesc}>Set a new password for your account</Text>
                  </View>
                  <ChevronRight size={18} color={Colors.text.tertiary} />
                </TouchableOpacity>

                <View style={styles.fieldSeparator} />

                <TouchableOpacity
                  style={styles.aboutRow}
                  onPress={() => setEmailForm((p) => ({ ...p, open: !p.open }))}
                  activeOpacity={0.7}
                  accessibilityRole="button"
                  accessibilityLabel="Change email"
                >
                  <View style={[styles.fieldIcon, { backgroundColor: accentSoft }]}>
                    <Mail size={16} color={accentColor} />
                  </View>
                  <View style={styles.privacyContent}>
                    <Text style={styles.privacyTitle}>Change email</Text>
                    <Text style={styles.privacyDesc}>
                      A confirmation email is sent to the new address
                    </Text>
                  </View>
                  <ChevronRight size={18} color={Colors.text.tertiary} />
                </TouchableOpacity>

                {emailForm.open && (
                  <View style={styles.fieldRow}>
                    <View style={[styles.fieldIcon, styles.fieldIconMuted]}>
                      <Mail size={16} color={Colors.text.tertiary} />
                    </View>
                    <View style={styles.fieldContent}>
                      <Input
                        label="New email address"
                        value={emailForm.value}
                        onChangeText={(t) => setEmailForm((p) => ({ ...p, value: t }))}
                        placeholder="name@example.com"
                        keyboardType="email-address"
                        autoCapitalize="none"
                      />
                      <TouchableOpacity
                        style={styles.emailSaveBtn}
                        onPress={handleChangeEmail}
                        disabled={emailForm.saving}
                        activeOpacity={0.8}
                        accessibilityRole="button"
                        accessibilityLabel="Send confirmation email"
                        hitSlop={{ top: 4, bottom: 4, left: 4, right: 4 }}
                      >
                        <Text style={styles.emailSaveBtnText}>
                          {emailForm.saving ? 'Sending…' : 'Send confirmation email'}
                        </Text>
                      </TouchableOpacity>
                    </View>
                  </View>
                )}

                <View style={styles.fieldSeparator} />

                <TouchableOpacity
                  style={styles.aboutRow}
                  onPress={handleSignOut}
                  activeOpacity={0.7}
                  accessibilityRole="button"
                  accessibilityLabel="Sign out"
                >
                  <View style={[styles.fieldIcon, { backgroundColor: accentSoft }]}>
                    <LogOut size={16} color={accentColor} />
                  </View>
                  <View style={styles.privacyContent}>
                    <Text style={styles.privacyTitle}>Sign out</Text>
                    <Text style={styles.privacyDesc}>Sign out of your account on this device</Text>
                  </View>
                </TouchableOpacity>
              </View>

              {/* ── Danger Zone ── */}
              <View style={[styles.sectionLabelRow, { marginTop: 32 }]}>
                <Text style={styles.sectionLabel}>Danger Zone</Text>
              </View>
              <View style={styles.card}>
                <TouchableOpacity
                  style={styles.aboutRow}
                  onPress={handleDeleteAccount}
                  disabled={deletingAccount}
                  activeOpacity={0.7}
                  accessibilityRole="button"
                  accessibilityLabel="Delete account"
                >
                  <View style={[styles.fieldIcon, styles.dangerIcon]}>
                    <Trash2 size={16} color={Colors.error} />
                  </View>
                  <View style={styles.privacyContent}>
                    <Text style={[styles.privacyTitle, styles.dangerTitle]}>
                      {deletingAccount ? 'Deleting account…' : 'Delete account'}
                    </Text>
                    <Text style={styles.privacyDesc}>
                      Permanently erase your profile, events, and all data
                    </Text>
                  </View>
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
  headerBorder: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Palette.separator,
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
  dangerIcon: {
    backgroundColor: Colors.errorSoft,
  },
  dangerTitle: {
    color: Colors.error,
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

  emailSaveBtn: {
    marginTop: Spacing.sm,
    alignSelf: 'flex-start',
    backgroundColor: Colors.primary,
    borderRadius: BorderRadius.md,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm + 2,
  },
  emailSaveBtnText: {
    color: Colors.text.inverse,
    fontSize: Typography.sizes.sm,
    fontFamily: Typography.fontFamilies.semibold,
    fontWeight: Typography.weights.semibold,
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