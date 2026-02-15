import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Platform,
  Dimensions,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Colors, Spacing, Typography, BorderRadius } from '@/constants/theme';
import {
  MapPin,
  Sparkles,
  Compass,
  Heart,
  Building2,
  ChevronRight,
  LogIn,
} from 'lucide-react-native';

const { width: SCREEN_WIDTH } = Dimensions.get('window');

const Palette = {
  gradientStart: '#6366F1',
  gradientEnd: '#8B5CF6',
  gradientDeep: '#4F46E5',
  cardBg: '#FFFFFF',
  surfaceMuted: '#F8F9FC',
  accentSoft: 'rgba(99,102,241,0.08)',
  accentMedium: 'rgba(99,102,241,0.14)',
  textOnGradient: '#FFFFFF',
  textOnGradientMuted: 'rgba(255,255,255,0.7)',
  separator: '#F0F0F5',
  badge: '#6366F1',
  featurePin: 'rgba(99,102,241,0.12)',
  featureHeart: 'rgba(239,68,68,0.10)',
  featureBiz: 'rgba(245,158,11,0.10)',
  featurePinIcon: '#6366F1',
  featureHeartIcon: '#EF4444',
  featureBizIcon: '#F59E0B',
};

export default function WelcomeScreen() {
  const insets = useSafeAreaInsets();

  return (
    <View style={styles.root}>
      {/* ── Top gradient hero ── */}
      <LinearGradient
        colors={[Palette.gradientDeep, Palette.gradientStart, Palette.gradientEnd]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={[styles.heroGradient, { paddingTop: insets.top + 48 }]}
      >
        {/* Decorative circles */}
        <View style={styles.decoCircleLg} />
        <View style={styles.decoCircleSm} />

        {/* Logo */}
        <View style={styles.logoContainer}>
          <View style={styles.logoOuter}>
            <View style={styles.logoInner}>
              <Sparkles size={32} color={Palette.gradientStart} />
            </View>
          </View>
        </View>

        <Text style={styles.heroTitle}>EventMap</Text>
        <Text style={styles.heroSubtitle}>
          Discover what's happening{'\n'}around you
        </Text>
      </LinearGradient>

      {/* ── Content area ── */}
      <View style={styles.contentArea}>
        {/* Feature cards */}
        <View style={styles.featuresCard}>
          <FeatureRow
            icon={<Compass size={20} color={Palette.featurePinIcon} />}
            iconBg={Palette.featurePin}
            title="Explore Nearby"
            description="Find events on an interactive map"
          />
          <View style={styles.featureSeparator} />
          <FeatureRow
            icon={<Heart size={20} color={Palette.featureHeartIcon} />}
            iconBg={Palette.featureHeart}
            title="Save & RSVP"
            description="Bookmark favorites and join events"
          />
          <View style={styles.featureSeparator} />
          <FeatureRow
            icon={<Building2 size={20} color={Palette.featureBizIcon} />}
            iconBg={Palette.featureBiz}
            title="For Businesses"
            description="Post and promote your own events"
          />
        </View>

        {/* Spacer */}
        <View style={styles.spacer} />

        {/* Actions */}
        <View style={[styles.actionsArea, { paddingBottom: insets.bottom + 24 }]}>
          {/* Get Started (primary) */}
          <TouchableOpacity
            style={styles.primaryBtnWrap}
            onPress={() => router.push('/(auth)/signup')}
            activeOpacity={0.85}
          >
            <LinearGradient
              colors={[Palette.gradientStart, Palette.gradientEnd]}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 0 }}
              style={styles.primaryBtnGradient}
            >
              <Text style={styles.primaryBtnText}>Get Started</Text>
              <ChevronRight size={20} color="#FFFFFF" />
            </LinearGradient>
          </TouchableOpacity>

          {/* Sign In (secondary) */}
          <TouchableOpacity
            style={styles.secondaryBtn}
            onPress={() => router.push('/(auth)/login')}
            activeOpacity={0.7}
          >
            <LogIn size={18} color={Palette.gradientStart} />
            <Text style={styles.secondaryBtnText}>
              Already have an account? Sign In
            </Text>
          </TouchableOpacity>
        </View>
      </View>
    </View>
  );
}

/* ── Feature row component ── */
function FeatureRow({
  icon,
  iconBg,
  title,
  description,
}: {
  icon: React.ReactNode;
  iconBg: string;
  title: string;
  description: string;
}) {
  return (
    <View style={styles.featureRow}>
      <View style={[styles.featureIcon, { backgroundColor: iconBg }]}>
        {icon}
      </View>
      <View style={styles.featureText}>
        <Text style={styles.featureTitle}>{title}</Text>
        <Text style={styles.featureDesc}>{description}</Text>
      </View>
    </View>
  );
}

/* ────────────────────────── STYLES ────────────────────────── */

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: Palette.surfaceMuted,
  },

  /* ── Hero gradient ── */
  heroGradient: {
    alignItems: 'center',
    paddingBottom: 48,
    borderBottomLeftRadius: 36,
    borderBottomRightRadius: 36,
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

  /* Logo */
  logoContainer: {
    marginBottom: 20,
  },
  logoOuter: {
    width: 88,
    height: 88,
    borderRadius: 28,
    backgroundColor: 'rgba(255,255,255,0.15)',
    alignItems: 'center',
    justifyContent: 'center',
    ...Platform.select({
      ios: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 8 },
        shadowOpacity: 0.15,
        shadowRadius: 20,
      },
      android: { elevation: 10 },
    }),
  },
  logoInner: {
    width: 68,
    height: 68,
    borderRadius: 20,
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  heroTitle: {
    fontSize: 36,
    fontFamily: Typography.fontFamilies.bold,
    fontWeight: Typography.weights.bold,
    color: Palette.textOnGradient,
    letterSpacing: -0.5,
    marginBottom: 8,
  },
  heroSubtitle: {
    fontSize: Typography.sizes.md,
    fontFamily: Typography.fontFamily,
    color: Palette.textOnGradientMuted,
    textAlign: 'center',
    lineHeight: 22,
  },

  /* ── Content area ── */
  contentArea: {
    flex: 1,
    paddingHorizontal: 24,
    marginTop: -24,
  },

  /* Features card */
  featuresCard: {
    backgroundColor: Palette.cardBg,
    borderRadius: 22,
    paddingVertical: 6,
    ...Platform.select({
      ios: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.08,
        shadowRadius: 16,
      },
      android: { elevation: 6 },
    }),
  },
  featureRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 18,
    paddingVertical: 16,
    gap: 14,
  },
  featureSeparator: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: Palette.separator,
    marginLeft: 66,
  },
  featureIcon: {
    width: 44,
    height: 44,
    borderRadius: 13,
    alignItems: 'center',
    justifyContent: 'center',
  },
  featureText: {
    flex: 1,
  },
  featureTitle: {
    fontSize: Typography.sizes.md,
    fontFamily: Typography.fontFamilies.semibold,
    fontWeight: Typography.weights.semibold,
    color: Colors.text.primary,
    marginBottom: 2,
  },
  featureDesc: {
    fontSize: Typography.sizes.sm,
    fontFamily: Typography.fontFamily,
    color: Colors.text.tertiary,
  },

  spacer: {
    flex: 1,
  },

  /* ── Actions ── */
  actionsArea: {
    gap: 14,
  },

  /* Primary button */
  primaryBtnWrap: {
    borderRadius: 16,
    overflow: 'hidden',
    ...Platform.select({
      ios: {
        shadowColor: Palette.gradientStart,
        shadowOffset: { width: 0, height: 8 },
        shadowOpacity: 0.35,
        shadowRadius: 16,
      },
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

  /* Secondary button */
  secondaryBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 16,
    borderRadius: 16,
    backgroundColor: Palette.cardBg,
    borderWidth: 1.5,
    borderColor: Palette.separator,
    ...Platform.select({
      ios: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.04,
        shadowRadius: 8,
      },
      android: { elevation: 2 },
    }),
  },
  secondaryBtnText: {
    fontSize: Typography.sizes.md,
    fontFamily: Typography.fontFamilies.semibold,
    fontWeight: Typography.weights.semibold,
    color: Palette.gradientStart,
  },
});