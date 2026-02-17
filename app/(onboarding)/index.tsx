import { useState, useRef, useCallback, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  Dimensions,
  TouchableOpacity,
  Platform,
  Alert,
  ActivityIndicator,
  Image,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import * as Location from 'expo-location';
import {
  Sparkles,
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
} from 'lucide-react-native';
import { useAuth } from '@/contexts/AuthContext';
import { categoriesService } from '@/services/categories';
import { profilesService } from '@/services/profiles';
import { geocodingService } from '@/services/geocoding';
import { Category } from '@/types/database';
import { getCategoryColor } from '@/constants/categories';
import { Colors, Spacing, Typography, BorderRadius, Shadows } from '@/constants/theme';

const { width: SCREEN_WIDTH } = Dimensions.get('window');
const TOTAL_PAGES = 4;

const Palette = {
  gradientStart: Colors.primary,
  gradientEnd: Colors.accent,
  gradientDeep: Colors.primaryDark,
  cardBg: Colors.background.primary,
  surfaceMuted: Colors.background.primary,
  accentSoft: 'rgba(196, 92, 62, 0.12)',
  textOnGradient: Colors.text.inverse,
  textOnGradientMuted: 'rgba(250, 248, 245, 0.7)',
  separator: Colors.border.light,
  successGreen: Colors.success,
  successBg: 'rgba(45, 138, 110, 0.12)',
};

export default function OnboardingScreen() {
  const insets = useSafeAreaInsets();
  const { user, refreshProfile } = useAuth();
  const flatListRef = useRef<FlatList>(null);
  const [currentPage, setCurrentPage] = useState(0);

  const [categories, setCategories] = useState<Category[]>([]);
  const [selectedCategories, setSelectedCategories] = useState<string[]>([]);
  const [locationGranted, setLocationGranted] = useState(false);
  const [notificationGranted, setNotificationGranted] = useState(false);
  const [userCoords, setUserCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [userCity, setUserCity] = useState<string | null>(null);
  const [completing, setCompleting] = useState(false);

  useEffect(() => {
    categoriesService.getAllCategories().then(setCategories);
  }, []);

  const goToPage = useCallback(
    (page: number) => {
      if (page < 0 || page >= TOTAL_PAGES) return;
      flatListRef.current?.scrollToOffset({ offset: page * SCREEN_WIDTH, animated: true });
      setCurrentPage(page);
    },
    []
  );

  const goNext = useCallback(() => goToPage(currentPage + 1), [currentPage, goToPage]);
  const goBack = useCallback(() => goToPage(currentPage - 1), [currentPage, goToPage]);

  const toggleCategory = (id: string) => {
    setSelectedCategories((prev) =>
      prev.includes(id) ? prev.filter((c) => c !== id) : [...prev, id]
    );
  };

  const handleLocationPermission = async () => {
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status === 'granted') {
        setLocationGranted(true);
        const loc = await Location.getCurrentPositionAsync({});
        const coords = { lat: loc.coords.latitude, lng: loc.coords.longitude };
        setUserCoords(coords);
        const geo = await geocodingService.reverseGeocode(coords.lat, coords.lng);
        if (geo) {
          setUserCity(geo.formattedAddress);
        }
      } else {
        Alert.alert('Permission Denied', 'You can enable location later in Settings.');
      }
    } catch {
      Alert.alert('Error', 'Could not get location. You can enable it later in Settings.');
    }
  };

  const handleNotificationPermission = async () => {
    try {
      const Notifications = await import('expo-notifications');
      const { status } = await Notifications.requestPermissionsAsync();
      setNotificationGranted(status === 'granted');
      if (status !== 'granted') {
        Alert.alert('Permission Denied', 'You can enable notifications later in Settings.');
      }
    } catch {
      setNotificationGranted(false);
    }
  };

  const handleComplete = async () => {
    if (!user) return;
    setCompleting(true);
    try {
      const updates: Record<string, unknown> = {
        has_completed_onboarding: true,
        preferred_categories: selectedCategories,
      };
      if (userCoords) {
        updates.lat = userCoords.lat;
        updates.lng = userCoords.lng;
      }
      if (userCity) {
        updates.city = userCity;
      }
      await profilesService.updateProfile(user.id, updates);
      await refreshProfile();
      router.replace('/(tabs)/discover');
    } catch (err: unknown) {
      Alert.alert('Error', err instanceof Error ? err.message : 'Failed to save preferences');
    } finally {
      setCompleting(false);
    }
  };

  const renderPage = ({ item }: { item: number }) => {
    switch (item) {
      case 0:
        return <WelcomePage insets={insets} onNext={goNext} />;
      case 1:
        return (
          <CategoriesPage
            insets={insets}
            categories={categories}
            selectedCategories={selectedCategories}
            onToggle={toggleCategory}
            onNext={goNext}
            onBack={goBack}
          />
        );
      case 2:
        return (
          <PermissionsPage
            insets={insets}
            locationGranted={locationGranted}
            notificationGranted={notificationGranted}
            onRequestLocation={handleLocationPermission}
            onRequestNotification={handleNotificationPermission}
            onNext={goNext}
            onBack={goBack}
          />
        );
      case 3:
        return (
          <TutorialPage
            insets={insets}
            onComplete={handleComplete}
            completing={completing}
            onBack={goBack}
          />
        );
      default:
        return null;
    }
  };

  return (
    <View style={styles.root}>
      <FlatList
        ref={flatListRef}
        data={[0, 1, 2, 3]}
        renderItem={renderPage}
        keyExtractor={(item) => String(item)}
        horizontal
        pagingEnabled
        scrollEnabled={false}
        showsHorizontalScrollIndicator={false}
        getItemLayout={(_, index) => ({
          length: SCREEN_WIDTH,
          offset: SCREEN_WIDTH * index,
          index,
        })}
      />
      <View style={[styles.dotsRow, { bottom: insets.bottom + 16 }]}>
        {Array.from({ length: TOTAL_PAGES }).map((_, i) => (
          <View
            key={i}
            style={[
              styles.dot,
              i === currentPage ? styles.dotActive : styles.dotInactive,
            ]}
          />
        ))}
      </View>
    </View>
  );
}

/* ─── Page 1: Welcome ─── */

function WelcomePage({
  insets,
  onNext,
}: {
  insets: { top: number; bottom: number };
  onNext: () => void;
}) {
  return (
    <View style={[styles.page, { paddingTop: insets.top }]}>
      <LinearGradient
        colors={[Palette.gradientDeep, Palette.gradientStart, Palette.gradientEnd]}
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
          Let's personalize your experience{'\n'}in just a few steps
        </Text>

        <View style={styles.welcomeFeatures}>
          <WelcomeFeature
            icon={<Compass size={20} color={Colors.primary} />}
            text="Discover events near you"
          />
          <WelcomeFeature
            icon={<Heart size={20} color="#EF4444" />}
            text="Save your favorites"
          />
          <WelcomeFeature
            icon={<MapPin size={20} color="#F59E0B" />}
            text="Navigate with the map"
          />
        </View>
      </LinearGradient>

      <View style={[styles.welcomeActions, { paddingBottom: insets.bottom + 56 }]}>
        <TouchableOpacity style={styles.primaryBtnWrap} onPress={onNext} activeOpacity={0.85}>
          <LinearGradient
            colors={[Palette.gradientStart, Palette.gradientEnd]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 0 }}
            style={styles.primaryBtnGradient}
          >
            <Text style={styles.primaryBtnText}>Let's Get Started</Text>
            <ChevronRight size={20} color="#FFFFFF" />
          </LinearGradient>
        </TouchableOpacity>
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

/* ─── Page 2: Categories ─── */

function CategoriesPage({
  insets,
  categories,
  selectedCategories,
  onToggle,
  onNext,
  onBack,
}: {
  insets: { top: number; bottom: number };
  categories: Category[];
  selectedCategories: string[];
  onToggle: (id: string) => void;
  onNext: () => void;
  onBack: () => void;
}) {
  const handleNext = () => {
    if (selectedCategories.length === 0) {
      Alert.alert('Pick at least one', 'Select one or more categories that interest you.');
      return;
    }
    onNext();
  };

  return (
    <View style={[styles.page, { paddingTop: insets.top + 16 }]}>
      <View style={styles.pageHeader}>
        <TouchableOpacity style={styles.backBtn} onPress={onBack} activeOpacity={0.7}>
          <ChevronLeft size={22} color={Colors.text.primary} />
        </TouchableOpacity>
        <Image
          source={require('@/assets/images/EMlogo.png')}
          style={styles.headerLogo}
          resizeMode="contain"
        />
        <TouchableOpacity onPress={onNext} activeOpacity={0.7}>
          <Text style={styles.skipText}>Skip</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.pageContent}>
        <Text style={styles.pageTitle}>What interests you?</Text>
        <Text style={styles.pageSubtitle}>
          Pick categories so we can show you events you'll love
        </Text>

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
              >
                {isSelected && (
                  <Check size={14} color="#FFFFFF" style={{ marginRight: 4 }} />
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

        {selectedCategories.length > 0 && (
          <Text style={styles.selectedCount}>
            {selectedCategories.length} selected
          </Text>
        )}
      </View>

      <View style={[styles.pageFooter, { paddingBottom: insets.bottom + 56 }]}>
        <TouchableOpacity style={styles.primaryBtnWrap} onPress={handleNext} activeOpacity={0.85}>
          <LinearGradient
            colors={[Palette.gradientStart, Palette.gradientEnd]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 0 }}
            style={styles.primaryBtnGradient}
          >
            <Text style={styles.primaryBtnText}>Continue</Text>
            <ChevronRight size={20} color="#FFFFFF" />
          </LinearGradient>
        </TouchableOpacity>
      </View>
    </View>
  );
}

/* ─── Page 3: Permissions ─── */

function PermissionsPage({
  insets,
  locationGranted,
  notificationGranted,
  onRequestLocation,
  onRequestNotification,
  onNext,
  onBack,
}: {
  insets: { top: number; bottom: number };
  locationGranted: boolean;
  notificationGranted: boolean;
  onRequestLocation: () => void;
  onRequestNotification: () => void;
  onNext: () => void;
  onBack: () => void;
}) {
  return (
    <View style={[styles.page, { paddingTop: insets.top + 16 }]}>
      <View style={styles.pageHeader}>
        <TouchableOpacity style={styles.backBtn} onPress={onBack} activeOpacity={0.7}>
          <ChevronLeft size={22} color={Colors.text.primary} />
        </TouchableOpacity>
        <Image
          source={require('@/assets/images/EMlogo.png')}
          style={styles.headerLogo}
          resizeMode="contain"
        />
        <TouchableOpacity onPress={onNext} activeOpacity={0.7}>
          <Text style={styles.skipText}>Skip</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.pageContent}>
        <Text style={styles.pageTitle}>Enable permissions</Text>
        <Text style={styles.pageSubtitle}>
          These help us show you the best events nearby
        </Text>

        <View style={styles.permissionCards}>
          <PermissionCard
            icon={<MapPin size={24} color={locationGranted ? Palette.successGreen : Colors.primary} />}
            iconBg={locationGranted ? Palette.successBg : Palette.accentSoft}
            title="Location"
            description="We use your location to show events near you"
            granted={locationGranted}
            onPress={onRequestLocation}
          />
          <PermissionCard
            icon={<Bell size={24} color={notificationGranted ? Palette.successGreen : Colors.primary} />}
            iconBg={notificationGranted ? Palette.successBg : Palette.accentSoft}
            title="Notifications"
            description="Get notified about events you care about"
            granted={notificationGranted}
            onPress={onRequestNotification}
          />
        </View>
      </View>

      <View style={[styles.pageFooter, { paddingBottom: insets.bottom + 56 }]}>
        <TouchableOpacity style={styles.primaryBtnWrap} onPress={onNext} activeOpacity={0.85}>
          <LinearGradient
            colors={[Palette.gradientStart, Palette.gradientEnd]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 0 }}
            style={styles.primaryBtnGradient}
          >
            <Text style={styles.primaryBtnText}>Continue</Text>
            <ChevronRight size={20} color="#FFFFFF" />
          </LinearGradient>
        </TouchableOpacity>
      </View>
    </View>
  );
}

function PermissionCard({
  icon,
  iconBg,
  title,
  description,
  granted,
  onPress,
}: {
  icon: React.ReactNode;
  iconBg: string;
  title: string;
  description: string;
  granted: boolean;
  onPress: () => void;
}) {
  return (
    <View style={styles.permissionCard}>
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
      >
        {granted ? (
          <Check size={16} color={Palette.successGreen} />
        ) : (
          <Text style={styles.permissionBtnText}>Enable</Text>
        )}
      </TouchableOpacity>
    </View>
  );
}

/* ─── Page 4: Tutorial ─── */

function TutorialPage({
  insets,
  onComplete,
  completing,
  onBack,
}: {
  insets: { top: number; bottom: number };
  onComplete: () => void;
  completing: boolean;
  onBack: () => void;
}) {
  return (
    <View style={[styles.page, { paddingTop: insets.top + 16 }]}>
      <View style={styles.pageHeader}>
        <TouchableOpacity style={styles.backBtn} onPress={onBack} activeOpacity={0.7}>
          <ChevronLeft size={22} color={Colors.text.primary} />
        </TouchableOpacity>
        <Image
          source={require('@/assets/images/EMlogo.png')}
          style={styles.headerLogo}
          resizeMode="contain"
        />
        <View style={styles.headerLogoSpacer} />
      </View>

      <View style={styles.pageContent}>
        <Text style={styles.pageTitle}>How to use the map</Text>
        <Text style={styles.pageSubtitle}>
          A quick guide to discovering events
        </Text>

        <View style={styles.tutorialCards}>
          <TutorialCard
            icon={<Hand size={28} color={Colors.primary} />}
            title="Explore the map"
            description="Pinch to zoom in and out. Drag to move around and explore different areas."
          />
          <TutorialCard
            icon={<Map size={28} color="#EF4444" />}
            title="Tap a pin"
            description="Tap any pin on the map to see event details and the event card."
          />
          <TutorialCard
            icon={<ArrowUpFromLine size={28} color="#F59E0B" />}
            title="Pull up the list"
            description="Drag the bottom panel up to browse all events in the visible area."
          />
        </View>
      </View>

      <View style={[styles.pageFooter, { paddingBottom: insets.bottom + 56 }]}>
        <TouchableOpacity
          style={styles.primaryBtnWrap}
          onPress={onComplete}
          disabled={completing}
          activeOpacity={0.85}
        >
          <LinearGradient
            colors={completing ? [Colors.primaryLight, Colors.accentLight] : [Palette.gradientStart, Palette.gradientEnd]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 0 }}
            style={styles.primaryBtnGradient}
          >
            {completing ? (
              <ActivityIndicator color="#FFFFFF" />
            ) : (
              <>
                <Text style={styles.primaryBtnText}>Start Exploring</Text>
                <Compass size={20} color="#FFFFFF" />
              </>
            )}
          </LinearGradient>
        </TouchableOpacity>
      </View>
    </View>
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

  page: {
    width: SCREEN_WIDTH,
    flex: 1,
  },

  /* ── Dot indicators ── */
  dotsRow: {
    position: 'absolute',
    alignSelf: 'center',
    flexDirection: 'row',
    gap: 8,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  dotActive: {
    backgroundColor: Palette.gradientStart,
    width: 24,
  },
  dotInactive: {
    backgroundColor: Colors.border.medium,
  },

  /* ── Page header (back + logo + skip) ── */
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
    ...Platform.select({
      ios: { shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.06, shadowRadius: 8 },
      android: { elevation: 3 },
    }),
  },
  headerLogo: {
    width: 36,
    height: 36,
    borderRadius: 10,
  },
  headerLogoSpacer: {
    width: 44,
  },
  skipText: {
    fontSize: Typography.sizes.md,
    fontFamily: Typography.fontFamilies.semibold,
    fontWeight: Typography.weights.semibold,
    color: Colors.primary,
  },

  /* ── Page content area ── */
  pageContent: {
    flex: 1,
    paddingHorizontal: 24,
  },
  pageTitle: {
    fontSize: 28,
    fontFamily: Typography.displayFontFamilies.bold,
    fontWeight: Typography.weights.bold,
    color: Colors.text.primary,
    marginBottom: 8,
  },
  pageSubtitle: {
    fontSize: Typography.sizes.md,
    fontFamily: Typography.fontFamily,
    color: Colors.text.tertiary,
    marginBottom: 28,
    lineHeight: 22,
  },

  /* ── Page footer ── */
  pageFooter: {
    paddingHorizontal: 24,
    paddingTop: 16,
  },

  /* ── Primary button ── */
  primaryBtnWrap: {
    borderRadius: 16,
    overflow: 'hidden',
    ...Platform.select({
      ios: { shadowColor: Colors.primary, shadowOffset: { width: 0, height: 8 }, shadowOpacity: 0.35, shadowRadius: 16 },
      android: { elevation: 10 },
    }),
  },
  primaryBtnGradient: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 18,
  },
  primaryBtnText: {
    fontSize: Typography.sizes.lg,
    fontFamily: Typography.fontFamilies.bold,
    fontWeight: Typography.weights.bold,
    color: '#FFFFFF',
    letterSpacing: 0.3,
  },

  /* ─── Welcome page ─── */
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

  /* ─── Categories page ─── */
  categoriesGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  categoryChip: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
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
  selectedCount: {
    marginTop: 16,
    fontSize: Typography.sizes.sm,
    fontFamily: Typography.fontFamilies.medium,
    fontWeight: Typography.weights.medium,
    color: Colors.primary,
    textAlign: 'center',
  },

  /* ─── Permissions page ─── */
  permissionCards: {
    gap: 16,
  },
  permissionCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Palette.cardBg,
    borderRadius: 18,
    padding: 18,
    gap: 14,
    ...Shadows.sm,
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
    color: Colors.text.tertiary,
    lineHeight: 18,
  },
  permissionBtn: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: BorderRadius.lg,
    backgroundColor: Palette.accentSoft,
    borderWidth: 1.5,
    borderColor: Colors.primary,
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

  /* ─── Tutorial page ─── */
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
    lineHeight: 18,
  },
});