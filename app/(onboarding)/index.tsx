import { useState, useRef, useCallback, useEffect, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  Dimensions,
  TouchableOpacity,
  Platform,
  ActivityIndicator,
  Image,
  ScrollView,
  KeyboardAvoidingView,
  Switch,
  useWindowDimensions,
  TextInput,
  Linking,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { onboardingDraftKey as draftKey, clearOnboardingDraft } from '@/utils/onboardingDraft';
import { tapHaptic, selectionHaptic, successHaptic } from '@/utils/haptics';
import * as ImagePicker from 'expo-image-picker';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { notify } from '@/utils/notify';
import * as Location from 'expo-location';
import {
  Compass,
  Heart,
  MapPin,
  Bell,
  Map,
  Hand,
  ChevronRight,
  ChevronLeft,
  ArrowUpFromLine,
  Check,
  Camera,
  Eye,
  Sparkles,
  AtSign,
} from 'lucide-react-native';
import { useAuth } from '@/contexts/AuthContext';
import { categoriesService } from '@/services/categories';
import { profilesService } from '@/services/profiles';
import { geocodingService } from '@/services/geocoding';
import { useFocusEffect } from '@react-navigation/native';
import { onboardingLocationStore } from '@/stores/onboardingLocationStore';
import { Category, Profile } from '@/types/database';
import { getCategoryColor } from '@/constants/categories';
import { alpha, Colors, Spacing, Typography, BorderRadius, Shadows } from '@/constants/theme';
import { Avatar } from '@/components/Avatar';
import { AvatarRing } from '@/components/AvatarRing';
import { CategoryIcon } from '@/components/CategoryIcon';
import { Button } from '@/components/ui/Button';
import { TextField } from '@/components/ui/TextField';

const { width: SCREEN_WIDTH } = Dimensions.get('window');

// Page order. Everything after WELCOME counts toward the "Step n of N" label.
const PAGE = {
  WELCOME: 0,
  PROFILE: 1,
  INTERESTS: 2,
  PERMISSIONS: 3,
  CITY: 4,
  PRIVACY: 5,
  TUTORIAL: 6,
} as const;
const TOTAL_PAGES = 7;
const STEP_COUNT = TOTAL_PAGES - 1;

/** Pill widths for the interests loading skeleton — varied so it reads as chips. */
const CHIP_SKELETON_WIDTHS = [104, 128, 88, 140, 96, 120, 84, 112];

const BIO_MAX = 160;
const HOBBIES_MAX = 80;
const NAME_MAX = 40;
const HANDLE_MAX = 60;

const Palette = {
  gradientStart: Colors.primary,
  gradientEnd: Colors.accent,
  gradientDeep: Colors.primaryDark,
  cardBg: Colors.surface,
  surfaceMuted: Colors.background.primary,
  accentSoft: Colors.primarySoft,
  textOnGradient: Colors.text.inverse,
  textOnGradientMuted: alpha(Colors.surface, 0.7),
  separator: Colors.border.light,
  successGreen: Colors.successText,
  successBg: Colors.successSoft,
};

type Insets = { top: number; bottom: number };

/**
 * Everything the user has typed or toggled so far. Persisted locally per user
 * so killing the app mid-onboarding resumes on the same page with the same
 * answers. Server writes happen per step as well, so the draft is a
 * convenience layer, not the source of truth.
 */
type Draft = {
  page: number;
  name: string;
  bio: string;
  hobbies: string;
  instagram: string;
  facebook: string;
  selectedCategories: string[];
  showProfileToOthers: boolean;
  showAttendancePublicly: boolean;
  showFutureEvents: boolean;
  cityArea: string;
  cityAreaLat: number | null;
  cityAreaLng: number | null;
};

export default function OnboardingScreen() {
  const insets = useSafeAreaInsets();
  // Horizontal pager items do not inherit the viewport height on web, so every
  // page gets an explicit height; otherwise short pages leave the footer floating.
  const { height: pageHeight } = useWindowDimensions();
  const { user, profile, refreshProfile } = useAuth();
  const flatListRef = useRef<FlatList>(null);
  const [hydrated, setHydrated] = useState(false);
  const [currentPage, setCurrentPage] = useState(0);

  const [categories, setCategories] = useState<Category[]>([]);
  const [categoriesStatus, setCategoriesStatus] = useState<'loading' | 'error' | 'loaded'>('loading');
  const [selectedCategories, setSelectedCategories] = useState<string[]>([]);
  const [name, setName] = useState('');
  const [bio, setBio] = useState('');
  const [hobbies, setHobbies] = useState('');
  const [instagram, setInstagram] = useState('');
  const [facebook, setFacebook] = useState('');
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [uploadingAvatar, setUploadingAvatar] = useState(false);
  const [locationGranted, setLocationGranted] = useState(false);
  const [locationDenied, setLocationDenied] = useState(false);
  const [notificationGranted, setNotificationGranted] = useState(false);
  const [notificationDenied, setNotificationDenied] = useState(false);
  const [userCoords, setUserCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [userCity, setUserCity] = useState<string | null>(null);
  const [cityArea, setCityArea] = useState('');
  const [cityAreaLat, setCityAreaLat] = useState<number | null>(null);
  const [cityAreaLng, setCityAreaLng] = useState<number | null>(null);
  const [showProfileToOthers, setShowProfileToOthers] = useState(true);
  const [showAttendancePublicly, setShowAttendancePublicly] = useState(true);
  const [showFutureEvents, setShowFutureEvents] = useState(true);
  const [savingStep, setSavingStep] = useState(false);
  const [completing, setCompleting] = useState(false);

  const signupName =
    (user?.user_metadata as { name?: string } | undefined)?.name?.trim() || '';

  const loadCategories = useCallback(() => {
    setCategoriesStatus('loading');
    categoriesService
      .getAllCategories()
      .then((cats) => {
        setCategories(cats);
        setCategoriesStatus('loaded');
      })
      .catch(() => setCategoriesStatus('error'));
  }, []);

  useEffect(() => {
    loadCategories();
  }, [loadCategories]);

  // Ensure the profile row exists before any per-step UPDATE. Signups created
  // outside the OAuth path can lack a row, which would make every onboarding
  // write a silent no-op and loop onboarding forever.
  useEffect(() => {
    if (!user) return;
    profilesService.ensureProfileExists(user.id, signupName).catch((err) => {
      console.error('ensureProfileExists failed:', err);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  // ---- Hydrate: server profile first, then local draft on top ---------------
  useEffect(() => {
    if (hydrated) return;
    if (!user) {
      // No session (should not happen behind the auth gate); show the flow anyway.
      setHydrated(true);
      return;
    }
    // Wait for the profile to load before hydrating: setting hydrated while
    // `profile` is still null would lock in defaults, and completing
    // onboarding would then overwrite the user's real preferences.
    if (profile === null) return;
    let cancelled = false;
    (async () => {
      const p: Profile | null = profile;
      if (p) {
        setName(p.name?.trim() || signupName);
        setBio(p.bio ?? '');
        setHobbies(p.hobbies ?? '');
        const handles = (p.social_handles ?? {}) as { instagram?: string; facebook?: string };
        setInstagram(handles.instagram ?? '');
        setFacebook(handles.facebook ?? '');
        setAvatarUrl(p.avatar_url ?? null);
        setSelectedCategories(p.preferred_categories ?? []);
        setShowProfileToOthers(!(p.is_profile_private ?? false));
        setShowAttendancePublicly(p.show_attendance_publicly ?? true);
        setShowFutureEvents(p.show_future_events ?? true);
        if (p.city) setCityArea(p.city);
        if (p.lat != null && p.lng != null) {
          setCityAreaLat(p.lat);
          setCityAreaLng(p.lng);
        }
      } else {
        setName(signupName);
      }
      try {
        const raw = await AsyncStorage.getItem(draftKey(user.id));
        if (raw && !cancelled) {
          const d = JSON.parse(raw) as Partial<Draft>;
          if (typeof d.name === 'string' && d.name.trim()) setName(d.name);
          if (typeof d.bio === 'string') setBio(d.bio);
          if (typeof d.hobbies === 'string') setHobbies(d.hobbies);
          if (typeof d.instagram === 'string') setInstagram(d.instagram);
          if (typeof d.facebook === 'string') setFacebook(d.facebook);
          if (Array.isArray(d.selectedCategories)) setSelectedCategories(d.selectedCategories);
          if (typeof d.showProfileToOthers === 'boolean') setShowProfileToOthers(d.showProfileToOthers);
          if (typeof d.showAttendancePublicly === 'boolean') setShowAttendancePublicly(d.showAttendancePublicly);
          if (typeof d.showFutureEvents === 'boolean') setShowFutureEvents(d.showFutureEvents);
          if (typeof d.cityArea === 'string') setCityArea(d.cityArea);
          if (typeof d.cityAreaLat === 'number') setCityAreaLat(d.cityAreaLat);
          if (typeof d.cityAreaLng === 'number') setCityAreaLng(d.cityAreaLng);
          if (typeof d.page === 'number' && d.page > 0 && d.page < TOTAL_PAGES) {
            setCurrentPage(d.page);
          }
        }
      } catch {
        // Corrupt or missing draft: start from the server values.
      }
      // Reflect permissions the OS already granted (e.g. after a reload mid-flow).
      try {
        const loc = await Location.getForegroundPermissionsAsync();
        if (!cancelled && loc.status === 'granted') setLocationGranted(true);
      } catch {
        // Not available on this platform.
      }
      try {
        const Notifications = await import('expo-notifications');
        const n = await Notifications.getPermissionsAsync();
        if (!cancelled && n.status === 'granted') setNotificationGranted(true);
      } catch {
        // Not available on this platform.
      }
      if (!cancelled) setHydrated(true);
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id, hydrated, profile]);

  // ---- Persist draft (debounced) --------------------------------------------
  const draft = useMemo<Draft>(
    () => ({
      page: currentPage,
      name,
      bio,
      hobbies,
      instagram,
      facebook,
      selectedCategories,
      showProfileToOthers,
      showAttendancePublicly,
      showFutureEvents,
      cityArea,
      cityAreaLat,
      cityAreaLng,
    }),
    [currentPage, name, bio, hobbies, instagram, facebook, selectedCategories, showProfileToOthers, showAttendancePublicly, showFutureEvents, cityArea, cityAreaLat, cityAreaLng]
  );
  useEffect(() => {
    if (!user || !hydrated) return;
    const timer = setTimeout(() => {
      AsyncStorage.setItem(draftKey(user.id), JSON.stringify(draft)).catch(() => {});
    }, 400);
    return () => clearTimeout(timer);
  }, [draft, user, hydrated]);

  // ---- Navigation ------------------------------------------------------------
  const goToPage = useCallback((page: number) => {
    if (page < 0 || page >= TOTAL_PAGES) return;
    flatListRef.current?.scrollToOffset({ offset: page * SCREEN_WIDTH, animated: true });
    setCurrentPage(page);
  }, []);
  const goNext = useCallback(() => goToPage(currentPage + 1), [currentPage, goToPage]);
  const goBack = useCallback(() => goToPage(currentPage - 1), [currentPage, goToPage]);

  // Prefill the city page from the reverse-geocoded location once it arrives.
  useEffect(() => {
    if (currentPage === PAGE.CITY && !cityArea && userCity && userCoords) {
      setCityArea(userCity);
      setCityAreaLat(userCoords.lat);
      setCityAreaLng(userCoords.lng);
    }
  }, [currentPage, cityArea, userCity, userCoords]);

  useFocusEffect(
    useCallback(() => {
      if (currentPage !== PAGE.CITY) return;
      const result = onboardingLocationStore.consume();
      if (result) {
        setCityArea(result.formattedAddress);
        setCityAreaLat(result.lat);
        setCityAreaLng(result.lng);
      }
    }, [currentPage])
  );

  // ---- Per-step writes -------------------------------------------------------
  const writeProfile = useCallback(
    async (updates: Partial<Profile>, failureMessage: string): Promise<boolean> => {
      if (!user) return false;
      setSavingStep(true);
      try {
        await profilesService.updateProfile(user.id, updates);
        return true;
      } catch (err: unknown) {
        notify.error(err instanceof Error ? err.message : failureMessage);
        return false;
      } finally {
        setSavingStep(false);
      }
    },
    [user]
  );

  const toggleCategory = (id: string) => {
    selectionHaptic();
    setSelectedCategories((prev) =>
      prev.includes(id) ? prev.filter((c) => c !== id) : [...prev, id]
    );
  };

  const socialHandles = useCallback(() => {
    const ig = instagram.trim().replace(/^@/, '').slice(0, HANDLE_MAX);
    const fb = facebook.trim().slice(0, HANDLE_MAX);
    const handles: { instagram?: string; facebook?: string } = {};
    if (ig) handles.instagram = ig;
    if (fb) handles.facebook = fb;
    return handles;
  }, [instagram, facebook]);

  const handleAvatarPick = async () => {
    if (!user) return;
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.8,
    });
    if (result.canceled || !result.assets?.[0]) return;
    const asset = result.assets[0];
    const ext = asset.uri.split('.').pop() || 'jpg';
    setUploadingAvatar(true);
    try {
      const publicUrl = await profilesService.uploadAvatar({
        uri: asset.uri,
        name: `avatar.${ext}`,
        type: asset.mimeType || `image/${ext}`,
      });
      // Written immediately so the photo survives even if onboarding is abandoned.
      await profilesService.updateProfile(user.id, { avatar_url: publicUrl });
      setAvatarUrl(publicUrl);
      successHaptic();
    } catch {
      notify.error('Could not upload that photo. You can add one later from your profile.');
    } finally {
      setUploadingAvatar(false);
    }
  };

  const handleProfileContinue = async () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    const ok = await writeProfile(
      {
        name: trimmed.slice(0, NAME_MAX),
        bio: bio.trim().slice(0, BIO_MAX) || null,
        hobbies: hobbies.trim().slice(0, HOBBIES_MAX) || null,
        social_handles: socialHandles(),
      },
      'Failed to save your profile'
    );
    if (ok) {
      tapHaptic();
      goNext();
    }
  };

  const handleCategoriesContinue = async () => {
    const ok = await writeProfile(
      { preferred_categories: selectedCategories },
      'Failed to save your interests'
    );
    if (ok) goNext();
  };

  const handleCityContinue = async () => {
    if (cityArea.trim() && cityAreaLat != null && cityAreaLng != null) {
      const ok = await writeProfile(
        { city: cityArea.trim(), lat: cityAreaLat, lng: cityAreaLng },
        'Failed to save your location'
      );
      if (!ok) return;
    }
    goNext();
  };

  const handlePrivacyContinue = async () => {
    const ok = await writeProfile(
      {
        is_profile_private: !showProfileToOthers,
        show_attendance_publicly: showAttendancePublicly,
        show_future_events: showFutureEvents,
      },
      'Failed to save privacy settings'
    );
    if (ok) goNext();
  };

  const handleLocationPermission = async () => {
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status === 'granted') {
        tapHaptic();
        setLocationGranted(true);
        setLocationDenied(false);
        const loc = await Location.getCurrentPositionAsync({});
        const coords = { lat: loc.coords.latitude, lng: loc.coords.longitude };
        setUserCoords(coords);
        const geo = await geocodingService.reverseGeocode(coords.lat, coords.lng);
        if (geo) setUserCity(geo.formattedAddress);
      } else {
        setLocationDenied(true);
        notify.error('Location permission denied. You can enable it later in Settings.');
      }
    } catch {
      notify.error('Could not get location. You can enable it later in Settings.');
    }
  };

  const handleNotificationPermission = async () => {
    try {
      const Notifications = await import('expo-notifications');
      const { status } = await Notifications.requestPermissionsAsync();
      setNotificationGranted(status === 'granted');
      setNotificationDenied(status !== 'granted');
      if (status === 'granted') tapHaptic();
      if (status !== 'granted') {
        notify.error('Notification permission denied. You can enable it later in Settings.');
      }
    } catch {
      setNotificationGranted(false);
    }
  };

  // Final write repeats every field so a skipped step still lands with sane
  // values, then clears the local draft.
  const handleComplete = async () => {
    if (!user) return;
    setCompleting(true);
    try {
      const updates: Partial<Profile> = {
        has_completed_onboarding: true,
        name: (name.trim() || signupName || profile?.name || 'User').slice(0, NAME_MAX),
        bio: bio.trim().slice(0, BIO_MAX) || null,
        hobbies: hobbies.trim().slice(0, HOBBIES_MAX) || null,
        social_handles: socialHandles(),
        preferred_categories: selectedCategories,
        is_profile_private: !showProfileToOthers,
        show_attendance_publicly: showAttendancePublicly,
        show_future_events: showFutureEvents,
      };
      if (cityArea.trim() && cityAreaLat != null && cityAreaLng != null) {
        updates.city = cityArea.trim();
        updates.lat = cityAreaLat;
        updates.lng = cityAreaLng;
      } else if (userCoords) {
        updates.lat = userCoords.lat;
        updates.lng = userCoords.lng;
        if (userCity) updates.city = userCity;
      }
      await profilesService.updateProfile(user.id, updates);
      await clearOnboardingDraft(user.id);
      await refreshProfile();
      successHaptic();
      router.replace('/(tabs)/discover');
    } catch (err: unknown) {
      notify.error(err instanceof Error ? err.message : 'Failed to save preferences');
    } finally {
      setCompleting(false);
    }
  };

  // ---- Render ----------------------------------------------------------------
  const shellProps = { insets, currentPage, onBack: goBack, saving: savingStep, pageHeight };

  const renderPage = ({ item }: { item: number }) => {
    switch (item) {
      case PAGE.WELCOME:
        return <WelcomePage insets={insets} pageHeight={pageHeight} onNext={goNext} />;
      case PAGE.PROFILE:
        return (
          <ProfilePage
            {...shellProps}
            name={name}
            setName={setName}
            bio={bio}
            setBio={setBio}
            hobbies={hobbies}
            setHobbies={setHobbies}
            instagram={instagram}
            setInstagram={setInstagram}
            facebook={facebook}
            setFacebook={setFacebook}
            avatarUrl={avatarUrl}
            uploadingAvatar={uploadingAvatar}
            onPickAvatar={handleAvatarPick}
            onNext={handleProfileContinue}
            onSkip={profile?.bio || profile?.avatar_url ? goNext : undefined}
          />
        );
      case PAGE.INTERESTS:
        return (
          <CategoriesPage
            {...shellProps}
            categories={categories}
            categoriesStatus={categoriesStatus}
            onRetryCategories={loadCategories}
            selectedCategories={selectedCategories}
            onToggle={toggleCategory}
            onNext={handleCategoriesContinue}
            onSkip={goNext}
          />
        );
      case PAGE.PERMISSIONS:
        return (
          <PermissionsPage
            {...shellProps}
            locationGranted={locationGranted}
            locationDenied={locationDenied}
            notificationGranted={notificationGranted}
            notificationDenied={notificationDenied}
            onRequestLocation={handleLocationPermission}
            onRequestNotification={handleNotificationPermission}
            onNext={goNext}
            onSkip={goNext}
          />
        );
      case PAGE.CITY:
        return (
          <CityOrAreaPage
            {...shellProps}
            city={cityArea}
            lat={cityAreaLat}
            lng={cityAreaLng}
            onClear={() => {
              setCityArea('');
              setCityAreaLat(null);
              setCityAreaLng(null);
            }}
            onNext={handleCityContinue}
            onSkip={goNext}
          />
        );
      case PAGE.PRIVACY:
        return (
          <PrivacySetupPage
            {...shellProps}
            previewName={name.trim() || signupName || 'You'}
            previewAvatarUrl={avatarUrl}
            previewBio={bio.trim()}
            onEditProfile={() => goToPage(PAGE.PROFILE)}
            showProfileToOthers={showProfileToOthers}
            setShowProfileToOthers={setShowProfileToOthers}
            showAttendancePublicly={showAttendancePublicly}
            setShowAttendancePublicly={setShowAttendancePublicly}
            showFutureEvents={showFutureEvents}
            setShowFutureEvents={setShowFutureEvents}
            onNext={handlePrivacyContinue}
            onSkip={goNext}
          />
        );
      case PAGE.TUTORIAL:
        return (
          <TutorialPage
            {...shellProps}
            onComplete={handleComplete}
            completing={completing}
          />
        );
      default:
        return null;
    }
  };

  if (!hydrated) {
    return (
      <View style={[styles.root, styles.hydrating]}>
        <ActivityIndicator size="large" color={Colors.primary} />
      </View>
    );
  }

  return (
    <View style={styles.root}>
      <FlatList
        ref={flatListRef}
        data={Array.from({ length: TOTAL_PAGES }, (_, i) => i)}
        renderItem={renderPage}
        keyExtractor={(item) => String(item)}
        horizontal
        pagingEnabled
        scrollEnabled={false}
        showsHorizontalScrollIndicator={false}
        initialScrollIndex={currentPage}
        keyboardShouldPersistTaps="handled"
        getItemLayout={(_, index) => ({
          length: SCREEN_WIDTH,
          offset: SCREEN_WIDTH * index,
          index,
        })}
      />
    </View>
  );
}

/* ─── Shared page shell: header (back / step / skip), progress, content, footer ─── */

type ShellProps = {
  insets: Insets;
  currentPage: number;
  onBack: () => void;
  saving: boolean;
  pageHeight: number;
};

function PageShell({
  insets,
  currentPage,
  onBack,
  pageHeight,
  onSkip,
  title,
  subtitle,
  children,
  footer,
  scroll = true,
}: ShellProps & {
  onSkip?: () => void;
  title: string;
  subtitle: string;
  children: React.ReactNode;
  footer: React.ReactNode;
  scroll?: boolean;
}) {
  const step = currentPage; // WELCOME is 0, so page index == step number
  const progress = step / STEP_COUNT;
  const Body = scroll ? ScrollView : View;
  return (
    <KeyboardAvoidingView
      style={[styles.page, { height: pageHeight, paddingTop: insets.top + 12 }]}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <View style={styles.pageHeader}>
        <TouchableOpacity
          style={styles.backBtn}
          onPress={onBack}
          activeOpacity={0.7}
          accessibilityRole="button"
          accessibilityLabel="Go back"
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          <ChevronLeft size={22} color={Colors.text.primary} />
        </TouchableOpacity>
        <Text style={styles.stepLabel}>
          Step {step} of {STEP_COUNT}
        </Text>
        {onSkip ? (
          <TouchableOpacity
            onPress={onSkip}
            activeOpacity={0.7}
            style={styles.skipPill}
            accessibilityRole="button"
            accessibilityLabel="Skip this step"
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <Text style={styles.skipText}>Skip</Text>
          </TouchableOpacity>
        ) : (
          <View style={styles.headerSpacer} />
        )}
      </View>
      <View
        style={styles.progressTrack}
        accessibilityRole="progressbar"
        accessibilityLabel="Setup progress"
        accessibilityValue={{ min: 0, max: STEP_COUNT, now: step }}
      >
        <View style={[styles.progressFill, { width: `${Math.round(progress * 100)}%` }]} />
      </View>

      <Body
        style={styles.pageContent}
        {...(scroll
          ? {
              contentContainerStyle: styles.pageScrollContent,
              showsVerticalScrollIndicator: false,
              keyboardShouldPersistTaps: 'handled' as const,
            }
          : {})}
      >
        <Text style={styles.pageTitle}>{title}</Text>
        <Text style={styles.pageSubtitle}>{subtitle}</Text>
        {children}
      </Body>

      <View style={[styles.pageFooter, { paddingBottom: insets.bottom + 20 }]}>{footer}</View>
    </KeyboardAvoidingView>
  );
}

/* ─── Page 0: Welcome ─── */

function WelcomePage({
  insets,
  pageHeight,
  onNext,
}: {
  insets: Insets;
  pageHeight: number;
  onNext: () => void;
}) {
  return (
    <View style={[styles.page, { height: pageHeight, paddingTop: insets.top }]}>
      <LinearGradient
        colors={[Colors.primary, Colors.secondary]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={styles.welcomeGradient}
      >
        <View style={styles.decoCircleLg} />
        <View style={styles.decoCircleSm} />

        <View style={styles.logoOuter}>
          <View style={styles.logoInner}>
            <Image
              source={require('@/assets/images/EMlogo.png')}
              style={styles.welcomeLogo}
              resizeMode="contain"
            />
          </View>
        </View>

        <Text style={styles.welcomeTitle}>Welcome to EventMap</Text>
        <Text style={styles.welcomeSubtitle}>
          Set up your profile and preferences.{'\n'}It takes about a minute.
        </Text>

        <View style={styles.welcomeFeatures}>
          <WelcomeFeature
            icon={<Compass size={20} color={Colors.primary} />}
            text="Discover events near you"
          />
          <WelcomeFeature
            icon={<Heart size={20} color={Colors.error} />}
            text="Join, save, and chat with attendees"
          />
          <WelcomeFeature
            icon={<MapPin size={20} color={Colors.warningText} />}
            text="Navigate with the map"
          />
        </View>
      </LinearGradient>

      <View style={[styles.welcomeActions, { paddingBottom: insets.bottom + 20 }]}>
        <Button label="Let's Get Started" onPress={onNext} variant="primary" gradient size="lg" fullWidth />
        <Text style={styles.welcomeHint}>You can skip any step and change everything later.</Text>
      </View>
    </View>
  );
}

function WelcomeFeature({ icon, text }: { icon: React.ReactNode; text: string }) {
  return (
    <View style={styles.welcomeFeatureRow}>
      <View style={styles.welcomeFeatureIcon}>{icon}</View>
      <Text style={styles.welcomeFeatureText}>{text}</Text>
    </View>
  );
}

/* ─── Page 1: Profile ─── */

function ProfilePage({
  name,
  setName,
  bio,
  setBio,
  hobbies,
  setHobbies,
  instagram,
  setInstagram,
  facebook,
  setFacebook,
  avatarUrl,
  uploadingAvatar,
  onPickAvatar,
  onNext,
  onSkip,
  ...shell
}: ShellProps & {
  name: string;
  setName: (v: string) => void;
  bio: string;
  setBio: (v: string) => void;
  hobbies: string;
  setHobbies: (v: string) => void;
  instagram: string;
  setInstagram: (v: string) => void;
  facebook: string;
  setFacebook: (v: string) => void;
  avatarUrl: string | null;
  uploadingAvatar: boolean;
  onPickAvatar: () => void;
  onNext: () => void;
  onSkip?: () => void;
}) {
  const nameEmpty = !name.trim();
  const [nameTouched, setNameTouched] = useState(false);
  const bioRef = useRef<TextInput>(null);
  const hobbiesRef = useRef<TextInput>(null);
  const instagramRef = useRef<TextInput>(null);
  const facebookRef = useRef<TextInput>(null);
  return (
    <PageShell
      {...shell}
      onSkip={onSkip}
      title="Make it yours"
      subtitle="A photo and a line about you help other attendees recognise you. Everything except your name is optional."
      footer={
        <Button
          label="Continue"
          onPress={onNext}
          disabled={nameEmpty}
          loading={shell.saving}
          variant="primary"
          gradient
          size="lg"
          fullWidth
        />
      }
    >
      <View style={styles.avatarSection}>
        <TouchableOpacity
          onPress={onPickAvatar}
          disabled={uploadingAvatar}
          activeOpacity={0.85}
          accessibilityRole="button"
          accessibilityLabel={avatarUrl ? 'Change profile photo' : 'Add profile photo'}
        >
          <AvatarRing
            imageUrl={avatarUrl}
            name={name.trim() || '?'}
            loading={uploadingAvatar}
            badge={
              <View style={styles.avatarBadge}>
                <Camera size={16} color="#FFFFFF" />
              </View>
            }
          />
        </TouchableOpacity>
        <Text style={styles.avatarHint}>
          {avatarUrl ? 'Tap to change your photo' : 'Add a photo (optional)'}
        </Text>
      </View>

      <View style={styles.formCard}>
        <TextField
          label="Name"
          value={name}
          onChangeText={(t) => {
            setNameTouched(true);
            setName(t.slice(0, NAME_MAX));
          }}
          onBlur={() => setNameTouched(true)}
          placeholder="How should people call you?"
          autoCapitalize="words"
          autoCorrect={false}
          returnKeyType="next"
          submitBehavior="submit"
          onSubmitEditing={() => bioRef.current?.focus()}
          error={nameEmpty && nameTouched ? 'Your name is required' : undefined}
          containerStyle={styles.fieldSpacing}
        />
        <TextField
          ref={bioRef}
          label="About you"
          value={bio}
          onChangeText={(t) => setBio(t.slice(0, BIO_MAX))}
          placeholder="What should people know about you?"
          multiline
          numberOfLines={3}
          counter={{ count: bio.length, max: BIO_MAX }}
          containerStyle={styles.fieldSpacing}
        />
        <TextField
          ref={hobbiesRef}
          label="Hobbies"
          value={hobbies}
          onChangeText={(t) => setHobbies(t.slice(0, HOBBIES_MAX))}
          placeholder="Live music, hiking, board games…"
          autoCapitalize="sentences"
          returnKeyType="next"
          submitBehavior="submit"
          onSubmitEditing={() => instagramRef.current?.focus()}
          containerStyle={styles.fieldSpacing}
        />

        <View style={styles.socialsHeader}>
          <AtSign size={14} color={Colors.text.tertiary} />
          <Text style={styles.socialsLabel}>Socials (optional)</Text>
        </View>
        <Text style={styles.socialsHint}>
          Shown on your public profile only when it is visible to others.
        </Text>
        <TextField
          ref={instagramRef}
          label="Instagram"
          value={instagram}
          onChangeText={(t) => setInstagram(t.slice(0, HANDLE_MAX))}
          placeholder="@yourhandle"
          autoCapitalize="none"
          autoCorrect={false}
          returnKeyType="next"
          submitBehavior="submit"
          onSubmitEditing={() => facebookRef.current?.focus()}
          containerStyle={styles.fieldSpacing}
        />
        <TextField
          ref={facebookRef}
          label="Facebook"
          value={facebook}
          onChangeText={(t) => setFacebook(t.slice(0, HANDLE_MAX))}
          placeholder="facebook.com/yourname or username"
          autoCapitalize="none"
          autoCorrect={false}
          returnKeyType="done"
          containerStyle={styles.fieldSpacing}
        />
      </View>
    </PageShell>
  );
}

/* ─── Page 2: Interests ─── */

function CategoriesPage({
  categories,
  categoriesStatus,
  onRetryCategories,
  selectedCategories,
  onToggle,
  onNext,
  onSkip,
  ...shell
}: ShellProps & {
  categories: Category[];
  categoriesStatus: 'loading' | 'error' | 'loaded';
  onRetryCategories: () => void;
  selectedCategories: string[];
  onToggle: (id: string) => void;
  onNext: () => void;
  onSkip: () => void;
}) {
  const none = selectedCategories.length === 0;
  return (
    <PageShell
      {...shell}
      onSkip={onSkip}
      title="What interests you?"
      subtitle="Pick a few so Discover leads with events you'll actually want to go to. This step is optional."
      footer={
        <Button
          label={none ? 'Skip for now' : 'Continue'}
          onPress={onNext}
          loading={shell.saving}
          variant="primary"
          gradient
          size="lg"
          fullWidth
        />
      }
    >
      {categoriesStatus === 'error' ? (
        <View style={styles.categoriesError}>
          <Text style={styles.categoriesErrorText}>
            Couldn&apos;t load interests. Check your connection and try again.
          </Text>
          <TouchableOpacity
            style={styles.categoriesRetryBtn}
            onPress={onRetryCategories}
            activeOpacity={0.8}
            accessibilityRole="button"
            accessibilityLabel="Retry loading interests"
          >
            <Text style={styles.categoriesRetryText}>Retry</Text>
          </TouchableOpacity>
        </View>
      ) : categoriesStatus === 'loading' ? (
        <View
          style={styles.categoriesGrid}
          accessible
          accessibilityLabel="Loading interests"
          accessibilityState={{ busy: true }}
        >
          {CHIP_SKELETON_WIDTHS.map((width, i) => (
            <View key={i} style={[styles.categoryChipSkeleton, { width }]} />
          ))}
        </View>
      ) : (
        <View style={styles.categoriesGrid}>
          {categories.map((cat) => {
            const isSelected = selectedCategories.includes(cat.id);
            const color = getCategoryColor(cat.slug);
            return (
              <TouchableOpacity
                key={cat.id}
                style={[
                  styles.categoryChip,
                  isSelected && { backgroundColor: color, borderColor: color },
                ]}
                onPress={() => onToggle(cat.id)}
                activeOpacity={0.7}
                accessibilityRole="checkbox"
                accessibilityState={{ checked: isSelected }}
                accessibilityLabel={cat.label}
              >
                {isSelected ? (
                  <Check size={14} color="#FFFFFF" />
                ) : (
                  <CategoryIcon category={cat.slug} size="sm" variant="minimal" />
                )}
                <Text
                  style={[
                    styles.categoryChipText,
                    isSelected && styles.categoryChipTextSelected,
                  ]}
                >
                  {cat.label}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>
      )}
      <Text style={styles.selectedCount}>
        {none ? 'Nothing selected yet' : `${selectedCategories.length} selected`}
      </Text>
    </PageShell>
  );
}

/* ─── Page 3: Permissions ─── */

function PermissionsPage({
  locationGranted,
  locationDenied,
  notificationGranted,
  notificationDenied,
  onRequestLocation,
  onRequestNotification,
  onNext,
  onSkip,
  ...shell
}: ShellProps & {
  locationGranted: boolean;
  locationDenied: boolean;
  notificationGranted: boolean;
  notificationDenied: boolean;
  onRequestLocation: () => void;
  onRequestNotification: () => void;
  onNext: () => void;
  onSkip: () => void;
}) {
  const allGranted = locationGranted && notificationGranted;
  return (
    <PageShell
      {...shell}
      onSkip={allGranted ? undefined : onSkip}
      title="Enable permissions"
      subtitle="Both are optional. Location puts nearby events on the map, and notifications remind you before events you joined."
      scroll={false}
      footer={
        <Button
          label={allGranted ? 'Continue' : 'Continue without'}
          onPress={onNext}
          variant="primary"
          gradient
          size="lg"
          fullWidth
        />
      }
    >
      <View style={styles.permissionCards}>
        <PermissionCard
          icon={<MapPin size={24} color={locationGranted ? Palette.successGreen : Colors.primary} />}
          iconBg={locationGranted ? Palette.successBg : Palette.accentSoft}
          title="Location"
          description={locationGranted ? 'Enabled. Nearby events will appear first.' : 'Show events near you on the map'}
          granted={locationGranted}
          denied={locationDenied}
          onPress={onRequestLocation}
        />
        <PermissionCard
          icon={<Bell size={24} color={notificationGranted ? Palette.successGreen : Colors.primary} />}
          iconBg={notificationGranted ? Palette.successBg : Palette.accentSoft}
          title="Notifications"
          description={notificationGranted ? 'Enabled. You can fine-tune them in Settings.' : 'Reminders and chat messages for events you join'}
          granted={notificationGranted}
          denied={notificationDenied}
          onPress={onRequestNotification}
        />
      </View>
      <Text style={styles.footnote}>You can change both at any time in your device settings.</Text>
    </PageShell>
  );
}

function PermissionCard({
  icon,
  iconBg,
  title,
  description,
  granted,
  denied,
  onPress,
}: {
  icon: React.ReactNode;
  iconBg: string;
  title: string;
  description: string;
  granted: boolean;
  denied: boolean;
  onPress: () => void;
}) {
  return (
    <View style={styles.permissionCard}>
      <View style={styles.permissionRow}>
        <View style={[styles.permissionIcon, { backgroundColor: iconBg }]}>{icon}</View>
        <View style={styles.permissionContent}>
          <Text style={styles.permissionTitle}>{title}</Text>
          <Text style={styles.permissionDesc}>{description}</Text>
        </View>
        <TouchableOpacity
          style={[styles.permissionBtn, granted && styles.permissionBtnGranted]}
          onPress={onPress}
          disabled={granted}
          activeOpacity={0.7}
          accessibilityRole="button"
          accessibilityLabel={granted ? `${title} enabled` : `Enable ${title}`}
          accessibilityState={{ disabled: granted, selected: granted }}
        >
          {granted ? (
            <Check size={16} color={Palette.successGreen} />
          ) : (
            <Text style={styles.permissionBtnText}>Enable</Text>
          )}
        </TouchableOpacity>
      </View>
      {denied && !granted ? (
        <TouchableOpacity
          style={styles.permissionSettingsLink}
          onPress={() => Linking.openSettings()}
          activeOpacity={0.7}
          accessibilityRole="button"
          accessibilityLabel={`Open device settings to enable ${title}`}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          <Text style={styles.permissionSettingsText}>
            Permission denied — Open Settings
          </Text>
        </TouchableOpacity>
      ) : null}
    </View>
  );
}

/* ─── Page 4: City or area ─── */

function CityOrAreaPage({
  city,
  lat,
  lng,
  onClear,
  onNext,
  onSkip,
  ...shell
}: ShellProps & {
  city: string;
  lat: number | null;
  lng: number | null;
  onClear: () => void;
  onNext: () => void;
  onSkip: () => void;
}) {
  const hasLocation = !!city.trim() && lat != null && lng != null;
  return (
    <PageShell
      {...shell}
      onSkip={onSkip}
      title="Where are you based?"
      subtitle="Your home area sets the default map view and powers the distance on event cards. It is shown on your profile as a city only."
      scroll={false}
      footer={
        <Button
          label={hasLocation ? 'Continue' : 'Continue without'}
          onPress={onNext}
          loading={shell.saving}
          variant="primary"
          gradient
          size="lg"
          fullWidth
        />
      }
    >
      <View style={styles.cityInputCard}>
        <Text style={styles.addressLabel}>Home area</Text>
        <TouchableOpacity
          style={styles.addressTouchable}
          onPress={() =>
            router.push({
              pathname: '/business-location',
              params: {
                context: 'onboarding',
                address: city,
                lat: lat != null ? String(lat) : '',
                lng: lng != null ? String(lng) : '',
              },
            })
          }
          activeOpacity={0.7}
          accessibilityRole="button"
          accessibilityLabel={city ? `Change location, currently ${city}` : 'Set location on map'}
        >
          <View style={styles.addressTouchableRow}>
            <MapPin size={18} color={hasLocation ? Colors.primary : Colors.text.tertiary} />
            <Text
              style={[styles.addressTouchableText, !city && styles.addressPlaceholder]}
              numberOfLines={2}
            >
              {city || 'Tap to pick a spot on the map'}
            </Text>
          </View>
        </TouchableOpacity>
        {hasLocation ? (
          <TouchableOpacity
            onPress={onClear}
            style={styles.clearLink}
            activeOpacity={0.7}
            accessibilityRole="button"
            accessibilityLabel="Clear location"
            hitSlop={{ top: 8, bottom: 8, left: 12, right: 12 }}
          >
            <Text style={styles.clearLinkText}>Clear</Text>
          </TouchableOpacity>
        ) : null}
      </View>
    </PageShell>
  );
}

/* ─── Page 5: Privacy, with a live preview of the profile just built ─── */

function PrivacySetupPage({
  previewName,
  previewAvatarUrl,
  previewBio,
  onEditProfile,
  showProfileToOthers,
  setShowProfileToOthers,
  showAttendancePublicly,
  setShowAttendancePublicly,
  showFutureEvents,
  setShowFutureEvents,
  onNext,
  onSkip,
  ...shell
}: ShellProps & {
  previewName: string;
  previewAvatarUrl: string | null;
  previewBio: string;
  onEditProfile: () => void;
  showProfileToOthers: boolean;
  setShowProfileToOthers: (v: boolean) => void;
  showAttendancePublicly: boolean;
  setShowAttendancePublicly: (v: boolean) => void;
  showFutureEvents: boolean;
  setShowFutureEvents: (v: boolean) => void;
  onNext: () => void;
  onSkip: () => void;
}) {
  return (
    <PageShell
      {...shell}
      onSkip={onSkip}
      title="Privacy & visibility"
      subtitle="Decide what other attendees can see. Defaults are open; you can tighten them any time in Settings."
      footer={
        <Button
          label="Continue"
          onPress={onNext}
          loading={shell.saving}
          variant="primary"
          gradient
          size="lg"
          fullWidth
        />
      }
    >
      <TouchableOpacity
        style={styles.previewCard}
        onPress={onEditProfile}
        activeOpacity={0.85}
        accessibilityRole="button"
        accessibilityLabel="Edit your profile"
      >
        <View style={styles.previewHeader}>
          <Eye size={14} color={Colors.text.tertiary} />
          <Text style={styles.previewLabel}>
            {showProfileToOthers ? 'What other attendees see' : 'Hidden from other attendees'}
          </Text>
        </View>
        <View style={[styles.previewBody, !showProfileToOthers && styles.previewBodyHidden]}>
          <Avatar
            imageUrl={showProfileToOthers ? previewAvatarUrl : null}
            name={showProfileToOthers ? previewName : '?'}
            size={48}
          />
          <View style={styles.previewText}>
            <Text style={styles.previewName} numberOfLines={1}>
              {showProfileToOthers ? previewName : 'Anonymous'}
            </Text>
            <Text style={styles.previewBio} numberOfLines={2}>
              {!showProfileToOthers
                ? 'Your name and photo are not shown in attendee lists.'
                : previewBio || 'No bio yet. Tap to add one.'}
            </Text>
          </View>
          <ChevronRight size={18} color={Colors.text.tertiary} />
        </View>
      </TouchableOpacity>

      <View style={styles.privacyCards}>
        <PrivacyRow
          title="Show my profile to others"
          description="Let attendees open your profile, bio, and social links"
          value={showProfileToOthers}
          onChange={setShowProfileToOthers}
        />
        <PrivacyRow
          title="Show me in “Who's going”"
          description="Appear by name on events you RSVP to. Off means other attendees see you as Anonymous; hosts still see your first name and last initial."
          value={showAttendancePublicly}
          onChange={setShowAttendancePublicly}
          disabled={!showProfileToOthers}
        />
        <PrivacyRow
          title="Show my upcoming events"
          description="List events you're going to on your public profile"
          value={showFutureEvents}
          onChange={setShowFutureEvents}
          disabled={!showProfileToOthers}
        />
      </View>
    </PageShell>
  );
}

function PrivacyRow({
  title,
  description,
  value,
  onChange,
  disabled,
}: {
  title: string;
  description: string;
  value: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
}) {
  const effective = disabled ? false : value;
  return (
    <View style={[styles.privacyCard, disabled && styles.privacyCardDisabled]}>
      <View style={styles.privacyCardContent}>
        <Text style={styles.privacyCardTitle}>{title}</Text>
        <Text style={styles.privacyCardDesc}>
          {disabled ? 'Not applicable while your profile is hidden.' : description}
        </Text>
      </View>
      <Switch
        value={effective}
        onValueChange={(v) => {
          tapHaptic();
          onChange(v);
        }}
        disabled={disabled}
        trackColor={{ false: Colors.border.medium, true: alpha(Colors.primary, 0.5) }}
        thumbColor={effective ? Colors.primary : Colors.background.secondary}
        accessibilityLabel={title}
        accessibilityHint={disabled ? 'Not applicable while your profile is hidden.' : description}
      />
    </View>
  );
}

/* ─── Page 6: Tutorial / finish ─── */

function TutorialPage({
  onComplete,
  completing,
  ...shell
}: ShellProps & {
  onComplete: () => void;
  completing: boolean;
}) {
  return (
    <PageShell
      {...shell}
      title="You're all set"
      subtitle="Three gestures are all you need on the map."
      footer={
        <Button
          label="Start Exploring"
          onPress={onComplete}
          loading={completing}
          icon={<Compass size={20} color={Colors.white} />}
          variant="primary"
          gradient
          size="lg"
          fullWidth
        />
      }
    >
      <View style={styles.tutorialCards}>
        <TutorialCard
          icon={<Hand size={28} color={Colors.primary} />}
          title="Explore the map"
          description="Pinch to zoom, drag to move around and discover other areas."
        />
        <TutorialCard
          icon={<Map size={28} color={Colors.error} />}
          title="Tap a pin"
          description="Open the event card, join, save, or share it."
        />
        <TutorialCard
          icon={<ArrowUpFromLine size={28} color={Colors.warningText} />}
          title="Pull up the list"
          description="Drag the bottom panel up to browse everything in view."
        />
        <View style={styles.finishNote}>
          <Sparkles size={16} color={Colors.primary} />
          <Text style={styles.finishNoteText}>
            Your profile, interests, and privacy choices are saved. Change any of them later from the Profile tab.
          </Text>
        </View>
      </View>
    </PageShell>
  );
}

function TutorialCard({
  icon,
  title,
  description,
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
}) {
  return (
    <View style={styles.tutorialCard}>
      <View style={styles.tutorialIcon}>{icon}</View>
      <View style={styles.tutorialText}>
        <Text style={styles.tutorialTitle}>{title}</Text>
        <Text style={styles.tutorialDesc}>{description}</Text>
      </View>
    </View>
  );
}

/* ─── Styles ─── */

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: Palette.surfaceMuted,
  },
  hydrating: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  page: {
    width: SCREEN_WIDTH,
    flex: 1,
  },

  /* ── Header, progress ── */
  pageHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 24,
    marginBottom: 12,
  },
  backBtn: {
    width: 44,
    height: 44,
    borderRadius: 14,
    backgroundColor: Palette.cardBg,
    alignItems: 'center',
    justifyContent: 'center',
    ...Shadows.card,
  },
  stepLabel: {
    fontSize: Typography.sizes.sm,
    fontFamily: Typography.fontFamilies.semibold,
    fontWeight: Typography.weights.semibold,
    color: Colors.text.tertiary,
    letterSpacing: 0.4,
  },
  headerSpacer: {
    width: 64,
  },
  skipPill: {
    minWidth: 64,
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: BorderRadius.round,
    backgroundColor: Palette.accentSoft,
  },
  skipText: {
    fontSize: Typography.sizes.sm,
    fontFamily: Typography.fontFamilies.semibold,
    fontWeight: Typography.weights.semibold,
    color: Colors.primary,
  },
  progressTrack: {
    marginHorizontal: 24,
    height: 4,
    borderRadius: 2,
    backgroundColor: Colors.border.light,
    overflow: 'hidden',
    marginBottom: 20,
  },
  progressFill: {
    height: '100%',
    borderRadius: 2,
    backgroundColor: Colors.primary,
  },

  /* ── Content ── */
  pageContent: {
    flex: 1,
    paddingHorizontal: 24,
  },
  pageScrollContent: {
    paddingBottom: 24,
  },
  pageTitle: {
    fontSize: 28,
    fontFamily: Typography.displayFontFamilies.bold,
    fontWeight: Typography.weights.bold,
    color: Colors.text.primary,
    marginBottom: 8,
    letterSpacing: -0.3,
  },
  pageSubtitle: {
    fontSize: Typography.sizes.md,
    fontFamily: Typography.fontFamily,
    color: Colors.text.secondary,
    marginBottom: 24,
    lineHeight: 22,
  },
  footnote: {
    marginTop: 18,
    fontSize: Typography.sizes.xs,
    color: Colors.text.tertiary,
    textAlign: 'center',
    lineHeight: 18,
  },

  /* ── Footer, primary button ── */
  pageFooter: {
    paddingHorizontal: 24,
    paddingTop: 12,
    backgroundColor: Palette.surfaceMuted,
  },
  /* ─── Welcome ─── */
  welcomeGradient: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
    overflow: 'hidden',
    position: 'relative',
  },
  decoCircleLg: {
    position: 'absolute',
    top: -40,
    right: -60,
    width: 200,
    height: 200,
    borderRadius: 100,
    backgroundColor: 'rgba(255,255,255,0.06)',
  },
  decoCircleSm: {
    position: 'absolute',
    bottom: 20,
    left: -30,
    width: 120,
    height: 120,
    borderRadius: 60,
    backgroundColor: 'rgba(255,255,255,0.04)',
  },
  logoOuter: {
    width: 96,
    height: 96,
    borderRadius: 30,
    backgroundColor: 'rgba(255,255,255,0.15)',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 24,
    ...Platform.select({
      ios: { shadowColor: '#000', shadowOffset: { width: 0, height: 8 }, shadowOpacity: 0.15, shadowRadius: 20 },
      android: { elevation: 10 },
    }),
  },
  logoInner: {
    width: 72,
    height: 72,
    borderRadius: 22,
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  welcomeLogo: {
    width: 56,
    height: 56,
  },
  welcomeTitle: {
    fontSize: 32,
    fontFamily: Typography.displayFontFamilies.bold,
    fontWeight: Typography.weights.bold,
    color: Palette.textOnGradient,
    letterSpacing: -0.5,
    marginBottom: 10,
    textAlign: 'center',
  },
  welcomeSubtitle: {
    fontSize: Typography.sizes.md,
    fontFamily: Typography.fontFamily,
    color: Palette.textOnGradientMuted,
    textAlign: 'center',
    lineHeight: 22,
    marginBottom: 36,
  },
  welcomeFeatures: {
    gap: 14,
    width: '100%',
    maxWidth: 300,
  },
  welcomeFeatureRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    backgroundColor: 'rgba(255,255,255,0.12)',
    paddingVertical: 14,
    paddingHorizontal: 18,
    borderRadius: 14,
  },
  welcomeFeatureIcon: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: 'rgba(255,255,255,0.9)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  welcomeFeatureText: {
    flex: 1,
    fontSize: Typography.sizes.md,
    fontFamily: Typography.fontFamilies.medium,
    fontWeight: Typography.weights.medium,
    color: Palette.textOnGradient,
  },
  welcomeActions: {
    paddingHorizontal: 24,
    paddingTop: 24,
    backgroundColor: Palette.surfaceMuted,
  },
  welcomeHint: {
    marginTop: 14,
    textAlign: 'center',
    fontSize: Typography.sizes.xs,
    color: Colors.text.tertiary,
  },

  /* ─── Profile ─── */
  avatarSection: {
    alignItems: 'center',
    marginBottom: 20,
  },
  avatarBadge: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: Colors.primary,
    borderWidth: 3,
    borderColor: Palette.surfaceMuted,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarHint: {
    marginTop: 10,
    fontSize: Typography.sizes.sm,
    color: Colors.text.tertiary,
  },
  formCard: {
    gap: 4,
    backgroundColor: Palette.cardBg,
    borderRadius: 18,
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 4,
    ...Shadows.sm,
  },
  fieldSpacing: {
    marginBottom: Spacing.md,
  },
  socialsHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 8,
  },
  socialsLabel: {
    fontSize: Typography.sizes.xs,
    fontFamily: Typography.fontFamilies.semibold,
    fontWeight: Typography.weights.semibold,
    color: Colors.text.tertiary,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
  },
  socialsHint: {
    fontSize: Typography.sizes.xs,
    color: Colors.text.tertiary,
    marginTop: 4,
    marginBottom: 12,
    lineHeight: 16,
  },
  /* ─── Interests ─── */
  categoriesGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  categoryChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 14,
    paddingVertical: 11,
    borderRadius: BorderRadius.round,
    backgroundColor: Palette.cardBg,
    borderWidth: 1.5,
    borderColor: Colors.border.light,
    ...Shadows.sm,
  },
  categoryChipText: {
    fontSize: Typography.sizes.md,
    fontFamily: Typography.fontFamilies.medium,
    fontWeight: Typography.weights.medium,
    color: Colors.text.primary,
  },
  categoryChipTextSelected: {
    color: '#FFFFFF',
    fontFamily: Typography.fontFamilies.semibold,
    fontWeight: Typography.weights.semibold,
  },
  categoryChipSkeleton: {
    height: 44,
    borderRadius: BorderRadius.round,
    backgroundColor: Colors.background.tertiary,
  },
  categoriesError: {
    marginTop: 24,
    alignItems: 'center',
    gap: 14,
  },
  categoriesErrorText: {
    fontSize: Typography.sizes.md,
    color: Colors.text.secondary,
    textAlign: 'center',
    lineHeight: 20,
  },
  categoriesRetryBtn: {
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: BorderRadius.lg,
    backgroundColor: Palette.accentSoft,
    borderWidth: 1.5,
    borderColor: Colors.primary,
  },
  categoriesRetryText: {
    fontSize: Typography.sizes.md,
    fontFamily: Typography.fontFamilies.semibold,
    fontWeight: Typography.weights.semibold,
    color: Colors.primary,
  },
  selectedCount: {
    marginTop: 16,
    fontSize: Typography.sizes.sm,
    fontFamily: Typography.fontFamilies.medium,
    fontWeight: Typography.weights.medium,
    color: Colors.text.tertiary,
    textAlign: 'center',
  },

  /* ─── Permissions ─── */
  permissionCards: {
    gap: 16,
  },
  permissionCard: {
    backgroundColor: Palette.cardBg,
    borderRadius: BorderRadius.lg,
    padding: 18,
    ...Shadows.sm,
  },
  permissionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
  },
  permissionSettingsLink: {
    alignSelf: 'flex-start',
    marginTop: Spacing.sm + 4,
    paddingVertical: Spacing.xs,
  },
  permissionSettingsText: {
    fontSize: Typography.sizes.sm,
    fontFamily: Typography.fontFamilies.semibold,
    fontWeight: Typography.weights.semibold,
    color: Colors.primary,
  },
  permissionIcon: {
    width: 52,
    height: 52,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  permissionContent: {
    flex: 1,
  },
  permissionTitle: {
    fontSize: Typography.sizes.md,
    fontFamily: Typography.fontFamilies.semibold,
    fontWeight: Typography.weights.semibold,
    color: Colors.text.primary,
    marginBottom: 2,
  },
  permissionDesc: {
    fontSize: Typography.sizes.sm,
    fontFamily: Typography.fontFamily,
    color: Colors.text.secondary,
    lineHeight: 18,
  },
  permissionBtn: {
    minHeight: 44,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: BorderRadius.lg,
    backgroundColor: Palette.accentSoft,
    borderWidth: 1.5,
    borderColor: Colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  permissionBtnGranted: {
    backgroundColor: Palette.successBg,
    borderColor: Palette.successGreen,
  },
  permissionBtnText: {
    fontSize: Typography.sizes.sm,
    fontFamily: Typography.fontFamilies.semibold,
    fontWeight: Typography.weights.semibold,
    color: Colors.primary,
  },

  /* ─── Privacy ─── */
  previewCard: {
    backgroundColor: Palette.cardBg,
    borderRadius: 18,
    padding: 16,
    marginBottom: 18,
    borderWidth: 1,
    borderColor: Palette.separator,
    ...Shadows.sm,
  },
  previewHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 12,
  },
  previewLabel: {
    fontSize: Typography.sizes.xs,
    fontFamily: Typography.fontFamilies.semibold,
    fontWeight: Typography.weights.semibold,
    color: Colors.text.tertiary,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
  },
  previewBody: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  previewBodyHidden: {
    opacity: 0.6,
  },
  previewText: {
    flex: 1,
  },
  previewName: {
    fontSize: Typography.sizes.md,
    fontFamily: Typography.fontFamilies.bold,
    fontWeight: Typography.weights.bold,
    color: Colors.text.primary,
  },
  previewBio: {
    marginTop: 2,
    fontSize: Typography.sizes.sm,
    color: Colors.text.secondary,
    lineHeight: 18,
  },
  privacyCards: {
    gap: 14,
  },
  privacyCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Palette.cardBg,
    borderRadius: 18,
    padding: 18,
    gap: 14,
    ...Shadows.sm,
  },
  privacyCardDisabled: {
    opacity: 0.55,
  },
  privacyCardContent: {
    flex: 1,
  },
  privacyCardTitle: {
    fontSize: Typography.sizes.md,
    fontFamily: Typography.fontFamilies.semibold,
    fontWeight: Typography.weights.semibold,
    color: Colors.text.primary,
    marginBottom: 2,
  },
  privacyCardDesc: {
    fontSize: Typography.sizes.sm,
    fontFamily: Typography.fontFamily,
    color: Colors.text.tertiary,
    lineHeight: 18,
  },

  /* ─── City ─── */
  cityInputCard: {
    backgroundColor: Palette.cardBg,
    borderRadius: 18,
    padding: 18,
    ...Shadows.sm,
  },
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
  clearLink: {
    alignSelf: 'flex-end',
    marginTop: 10,
    paddingVertical: 6,
    paddingHorizontal: 8,
  },
  clearLinkText: {
    fontSize: Typography.sizes.sm,
    fontFamily: Typography.fontFamilies.semibold,
    fontWeight: Typography.weights.semibold,
    color: Colors.error,
  },

  /* ─── Tutorial ─── */
  tutorialCards: {
    gap: 16,
  },
  tutorialCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Palette.cardBg,
    borderRadius: 18,
    padding: 20,
    gap: 16,
    ...Shadows.sm,
  },
  tutorialIcon: {
    width: 56,
    height: 56,
    borderRadius: 16,
    backgroundColor: Palette.accentSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tutorialText: {
    flex: 1,
  },
  tutorialTitle: {
    fontSize: Typography.sizes.md,
    fontFamily: Typography.fontFamilies.semibold,
    fontWeight: Typography.weights.semibold,
    color: Colors.text.primary,
    marginBottom: 4,
  },
  tutorialDesc: {
    fontSize: Typography.sizes.sm,
    fontFamily: Typography.fontFamily,
    color: Colors.text.tertiary,
    lineHeight: 20,
  },
  finishNote: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    marginTop: 4,
    padding: 14,
    borderRadius: 14,
    backgroundColor: Palette.accentSoft,
  },
  finishNoteText: {
    flex: 1,
    fontSize: Typography.sizes.sm,
    color: Colors.text.secondary,
    lineHeight: 20,
  },
});
