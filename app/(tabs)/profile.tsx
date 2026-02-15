import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  Alert,
  Dimensions,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuth } from '@/contexts/AuthContext';
import { useApp } from '@/contexts/AppContext';
import { router } from 'expo-router';
import { Colors, Spacing, Typography, BorderRadius, Shadows } from '@/constants/theme';
import {
  User,
  Building2,
  LogOut,
  ChevronRight,
  Briefcase,
  Calendar,
  Bookmark,
  Heart,
  Settings,
  ArrowLeftRight,
} from 'lucide-react-native';

const { width: SCREEN_WIDTH } = Dimensions.get('window');

// ── Refined palette that layers on top of your existing Colors ──
const Palette = {
  gradientStart: '#6366F1', // indigo-500
  gradientEnd: '#8B5CF6', // violet-500
  cardBg: '#FFFFFF',
  surfaceMuted: '#F8F9FC',
  accentSoft: 'rgba(99,102,241,0.08)',
  accentMedium: 'rgba(99,102,241,0.15)',
  textOnGradient: '#FFFFFF',
  textOnGradientMuted: 'rgba(255,255,255,0.75)',
  separator: '#F0F0F5',
  badge: '#6366F1',
};

export default function ProfileScreen() {
  const insets = useSafeAreaInsets();
  const { profile, signOut } = useAuth();
  const { hasBusiness, userMode, setUserMode, userBusiness } = useApp();

  const handleSignOut = () => {
    Alert.alert('Sign Out', 'Are you sure you want to sign out?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Sign Out',
        style: 'destructive',
        onPress: async () => {
          await signOut();
          router.replace('/');
        },
      },
    ]);
  };

  const handleCreateBusiness = () => {
    router.push('/business/onboarding' as any);
  };

  const toggleMode = () => {
    if (!hasBusiness) {
      handleCreateBusiness();
      return;
    }
    setUserMode(userMode === 'user' ? 'business' : 'user');
  };

  const initials = (profile?.name || 'U')
    .split(' ')
    .map((w: string) => w[0])
    .join('')
    .toUpperCase()
    .slice(0, 2);

  return (
    <View style={styles.root}>
      <ScrollView
        style={styles.container}
        contentContainerStyle={{ paddingBottom: insets.bottom + 40 }}
        showsVerticalScrollIndicator={false}
      >
        {/* ── Header with gradient ── */}
        <LinearGradient
          colors={[Palette.gradientStart, Palette.gradientEnd]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={[styles.headerGradient, { paddingTop: insets.top + Spacing.xl }]}
        >
          <View style={styles.avatarRing}>
            <View style={styles.avatarInner}>
              <Text style={styles.avatarInitials}>{initials}</Text>
            </View>
          </View>

          <Text style={styles.headerName}>{profile?.name || 'User'}</Text>

          {hasBusiness && userBusiness ? (
            <View style={styles.businessBadge}>
              <Building2 size={13} color={Palette.textOnGradient} />
              <Text style={styles.businessBadgeText}>{userBusiness.name}</Text>
            </View>
          ) : (
            <Text style={styles.headerSubtitle}>Event Explorer</Text>
          )}

          {/* Mode toggle pill */}
          <TouchableOpacity
            style={styles.modePill}
            onPress={toggleMode}
            activeOpacity={0.8}
          >
            <ArrowLeftRight size={14} color={Palette.gradientStart} />
            <Text style={styles.modePillText}>
              {hasBusiness
                ? userMode === 'user'
                  ? 'Switch to Business'
                  : 'Switch to Personal'
                : 'Create Business'}
            </Text>
          </TouchableOpacity>
        </LinearGradient>

        {/* ── Quick stats row ── */}
        <View style={styles.statsRow}>
          <StatItem label="Events" value="—" />
          <View style={styles.statDivider} />
          <StatItem label="Saved" value="—" />
          <View style={styles.statDivider} />
          <StatItem label="Following" value="—" />
        </View>

        {/* ── Create Business CTA (non-business users) ── */}
        {!hasBusiness && (
          <View style={styles.sectionPadding}>
            <TouchableOpacity
              style={styles.createBusinessCard}
              onPress={handleCreateBusiness}
              activeOpacity={0.85}
            >
              <LinearGradient
                colors={[Palette.gradientStart, Palette.gradientEnd]}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 0 }}
                style={styles.createBusinessGradient}
              >
                <View style={styles.createBusinessIcon}>
                  <Briefcase size={20} color={Palette.gradientStart} />
                </View>
                <View style={styles.createBusinessContent}>
                  <Text style={styles.createBusinessTitle}>
                    Create Business Profile
                  </Text>
                  <Text style={styles.createBusinessSubtitle}>
                    Start posting and promoting your events
                  </Text>
                </View>
                <ChevronRight size={20} color="rgba(255,255,255,0.7)" />
              </LinearGradient>
            </TouchableOpacity>
          </View>
        )}

        {/* ── Menu sections ── */}
        <View style={styles.sectionPadding}>
          <Text style={styles.sectionLabel}>Your Activity</Text>
          <View style={styles.card}>
            {hasBusiness && (
              <MenuItem
                icon={<Calendar size={20} color={Palette.gradientStart} />}
                label="My Events"
                sublabel="Manage your posted events"
                onPress={() => router.push('/my-events' as any)}
              />
            )}
            <MenuItem
              icon={<Bookmark size={20} color={Palette.gradientStart} />}
              label="Saved Events"
              sublabel="Events you've bookmarked"
              onPress={() => router.push('/saved-events' as any)}
              showSeparator
            />
            <MenuItem
              icon={<Heart size={20} color={Palette.gradientStart} />}
              label="Following"
              sublabel="Businesses you follow"
              onPress={() =>
                Alert.alert(
                  'Coming Soon',
                  'Following list will be available soon'
                )
              }
              isLast
            />
          </View>
        </View>

        <View style={styles.sectionPadding}>
          <Text style={styles.sectionLabel}>Preferences</Text>
          <View style={styles.card}>
            <MenuItem
              icon={<Settings size={20} color={Palette.gradientStart} />}
              label="Settings"
              sublabel="Notifications, privacy & more"
              onPress={() => router.push('/settings' as any)}
              isLast
            />
          </View>
        </View>

        {/* ── Sign out ── */}
        <View style={styles.sectionPadding}>
          <TouchableOpacity
            style={styles.signOutButton}
            onPress={handleSignOut}
            activeOpacity={0.7}
          >
            <LogOut size={18} color={Colors.error} />
            <Text style={styles.signOutText}>Sign Out</Text>
          </TouchableOpacity>
        </View>

        <Text style={styles.versionText}>Version 1.0.0</Text>
      </ScrollView>
    </View>
  );
}

/* ── Reusable stat item ── */
function StatItem({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.statItem}>
      <Text style={styles.statValue}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

/* ── Reusable menu row ── */
function MenuItem({
  icon,
  label,
  sublabel,
  onPress,
  showSeparator = true,
  isLast = false,
}: {
  icon: React.ReactNode;
  label: string;
  sublabel?: string;
  onPress: () => void;
  showSeparator?: boolean;
  isLast?: boolean;
}) {
  return (
    <TouchableOpacity
      style={[styles.menuItem, !isLast && styles.menuItemBorder]}
      onPress={onPress}
      activeOpacity={0.6}
    >
      <View style={styles.menuIconWrapper}>{icon}</View>
      <View style={styles.menuTextBlock}>
        <Text style={styles.menuLabel}>{label}</Text>
        {sublabel && <Text style={styles.menuSublabel}>{sublabel}</Text>}
      </View>
      <ChevronRight size={18} color={Colors.text.tertiary} />
    </TouchableOpacity>
  );
}

/* ────────────────────────── STYLES ────────────────────────── */

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: Palette.surfaceMuted,
  },
  container: {
    flex: 1,
  },

  /* ── Header ── */
  headerGradient: {
    alignItems: 'center',
    paddingBottom: Spacing.xxl + 4,
    borderBottomLeftRadius: 28,
    borderBottomRightRadius: 28,
  },
  avatarRing: {
    width: 92,
    height: 92,
    borderRadius: 46,
    borderWidth: 3,
    borderColor: 'rgba(255,255,255,0.35)',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: Spacing.md,
  },
  avatarInner: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: 'rgba(255,255,255,0.2)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  avatarInitials: {
    fontSize: 28,
    fontWeight: '700',
    color: Palette.textOnGradient,
    letterSpacing: 1,
  },
  headerName: {
    fontSize: 22,
    fontWeight: '700',
    color: Palette.textOnGradient,
    marginBottom: 4,
  },
  headerSubtitle: {
    fontSize: Typography.sizes.sm,
    color: Palette.textOnGradientMuted,
    marginBottom: Spacing.md,
  },
  businessBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: 'rgba(255,255,255,0.18)',
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: 20,
    marginBottom: Spacing.md,
  },
  businessBadgeText: {
    fontSize: 13,
    color: Palette.textOnGradient,
    fontWeight: '600',
  },
  modePill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 16,
    paddingVertical: 9,
    borderRadius: 24,
    ...Shadows.sm,
  },
  modePillText: {
    fontSize: 13,
    fontWeight: '600',
    color: Palette.gradientStart,
  },

  /* ── Stats row ── */
  statsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Palette.cardBg,
    marginHorizontal: Spacing.lg,
    marginTop: -20,
    borderRadius: 16,
    paddingVertical: 18,
    ...Shadows.md,
  },
  statItem: {
    flex: 1,
    alignItems: 'center',
  },
  statValue: {
    fontSize: 18,
    fontWeight: '700',
    color: Colors.text.primary,
  },
  statLabel: {
    fontSize: 12,
    color: Colors.text.tertiary,
    marginTop: 2,
  },
  statDivider: {
    width: 1,
    height: 28,
    backgroundColor: Palette.separator,
  },

  /* ── Sections ── */
  sectionPadding: {
    paddingHorizontal: Spacing.lg,
    marginTop: Spacing.xl,
  },
  sectionLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: Colors.text.tertiary,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    marginBottom: Spacing.sm,
    marginLeft: 4,
  },

  /* ── Card container ── */
  card: {
    backgroundColor: Palette.cardBg,
    borderRadius: 16,
    overflow: 'hidden',
    ...Shadows.sm,
  },

  /* ── Menu items ── */
  menuItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 15,
    paddingHorizontal: 16,
  },
  menuItemBorder: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Palette.separator,
  },
  menuIconWrapper: {
    width: 38,
    height: 38,
    borderRadius: 10,
    backgroundColor: Palette.accentSoft,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 14,
  },
  menuTextBlock: {
    flex: 1,
  },
  menuLabel: {
    fontSize: 15,
    fontWeight: '600',
    color: Colors.text.primary,
  },
  menuSublabel: {
    fontSize: 12,
    color: Colors.text.tertiary,
    marginTop: 1,
  },

  /* ── Create business CTA ── */
  createBusinessCard: {
    borderRadius: 16,
    overflow: 'hidden',
    ...Shadows.md,
  },
  createBusinessGradient: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 18,
    paddingHorizontal: 18,
  },
  createBusinessIcon: {
    width: 42,
    height: 42,
    borderRadius: 12,
    backgroundColor: '#FFFFFF',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 14,
  },
  createBusinessContent: {
    flex: 1,
  },
  createBusinessTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: Palette.textOnGradient,
  },
  createBusinessSubtitle: {
    fontSize: 12,
    color: Palette.textOnGradientMuted,
    marginTop: 2,
  },

  /* ── Sign out ── */
  signOutButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.sm,
    paddingVertical: 14,
    borderRadius: 14,
    backgroundColor: Palette.cardBg,
    borderWidth: 1,
    borderColor: 'rgba(239,68,68,0.2)',
    ...Shadows.sm,
  },
  signOutText: {
    color: Colors.error,
    fontSize: 15,
    fontWeight: '600',
  },

  /* ── Footer ── */
  versionText: {
    textAlign: 'center',
    fontSize: 12,
    color: Colors.text.tertiary,
    marginTop: Spacing.xl,
    marginBottom: Spacing.md,
    opacity: 0.5,
  },
});