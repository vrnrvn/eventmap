import { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  Alert,
  Dimensions,
  ActivityIndicator,
} from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuth } from '@/contexts/AuthContext';
import { useApp } from '@/contexts/AppContext';
import { usePremium } from '@/contexts/PremiumContext';
import { premiumService } from '@/services/premium';
import { profilesService } from '@/services/profiles';
import { businessesService } from '@/services/businesses';
import { eventsService } from '@/services/events';
import { socialService } from '@/services/social';
import { router } from 'expo-router';
import { Colors, Spacing, Typography, BorderRadius, Shadows } from '@/constants/theme';
import { Avatar } from '@/components/Avatar';
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
  Users,
  BarChart3,
} from 'lucide-react-native';

const { width: SCREEN_WIDTH } = Dimensions.get('window');

const Palette = {
  gradientStart: Colors.primary,
  gradientEnd: Colors.accent,
  cardBg: Colors.background.primary,
  surfaceMuted: Colors.background.primary,
  accentSoft: 'rgba(196, 92, 62, 0.12)',
  textOnGradient: Colors.text.inverse,
  textOnGradientMuted: 'rgba(250, 248, 245, 0.75)',
  separator: Colors.border.light,
};

export default function ProfileScreen() {
  const insets = useSafeAreaInsets();
  const { profile, signOut, refreshProfile, user } = useAuth();
  const { hasBusiness, userMode, setUserMode, userBusiness, refreshBusiness } = useApp();
  const { isPremium, currentPlan, refreshSubscription } = usePremium();
  const [uploadingAvatar, setUploadingAvatar] = useState(false);
  const [stats, setStats] = useState<{
    events: string;
    followers: string;
    following: string;
    saved: string;
    views: string;
  }>({ events: '—', followers: '—', following: '—', saved: '—', views: '—' });

  const isBizMode = hasBusiness && userMode === 'business';
  const [showPremiumModal, setShowPremiumModal] = useState(false);
  const [upgrading, setUpgrading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const loadStats = async () => {
      try {
        if (isBizMode && userBusiness) {
          const [eventCount, followerCount] = await Promise.all([
            eventsService.getBusinessEventsCount(userBusiness.id),
            businessesService.getFollowerCount(userBusiness.id),
          ]);
          if (!cancelled) {
            setStats({
              events: String(eventCount),
              followers: String(followerCount),
              following: '—',
              saved: '—',
              views: '—',
            });
          }
        } else {
          const [follows, saves] = await Promise.all([
            socialService.getUserFollows(),
            socialService.getUserSavedEvents(),
          ]);
          if (!cancelled) {
            setStats({
              events: '—',
              followers: '—',
              following: String(follows.length),
              saved: String(saves.length),
              views: '—',
            });
          }
        }
      } catch {
        if (!cancelled) {
          setStats({ events: '—', followers: '—', following: '—', saved: '—', views: '—' });
        }
      }
    };
    loadStats();
    return () => {
      cancelled = true;
    };
  }, [isBizMode, userBusiness?.id]);

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

  const handleUpgradeToPremium = async () => {
    if (!userBusiness) {
      Alert.alert('Business Required', 'Create a business profile before upgrading.');
      return;
    }
    if (upgrading) return;

    setUpgrading(true);
    try {
      const { success } = await premiumService.subscribeToPlan(
        userBusiness.id,
        'pro',
        'monthly'
      );
      if (success) {
        await refreshBusiness();
        await refreshSubscription();
        setShowPremiumModal(false);
        Alert.alert('Premium Activated', 'Your premium subscription is now active.');
      }
    } catch (err) {
      console.error('Failed to upgrade to premium', err);
      Alert.alert('Error', 'Failed to upgrade to premium. Please try again.');
    } finally {
      setUpgrading(false);
    }
  };

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
      if (isBizMode && userBusiness) {
        // Upload business logo
        const publicUrl = await eventsService.uploadEventImage(
          {
            uri: asset.uri,
            name: `logo-${Date.now()}.${ext}`,
            type: asset.mimeType || `image/${ext}`,
          },
          'logos'
        );
        await businessesService.updateBusiness(userBusiness.id, { logo_url: publicUrl });
        await refreshBusiness();
      } else {
        // Upload personal avatar
        const publicUrl = await profilesService.uploadAvatar({
          uri: asset.uri,
          name: `avatar.${ext}`,
          type: asset.mimeType || `image/${ext}`,
        });
        await profilesService.updateProfile(user.id, { avatar_url: publicUrl });
        await refreshProfile();
      }
    } catch {
      Alert.alert('Error', `Failed to upload ${isBizMode ? 'logo' : 'avatar'}`);
    } finally {
      setUploadingAvatar(false);
    }
  };

  // ── Derive header values based on mode ──
  const headerAvatarUrl = isBizMode ? userBusiness?.logo_url : profile?.avatar_url;
  const headerName = isBizMode ? (userBusiness?.name || 'Business') : (profile?.name || 'User');
  const headerSubtitle = isBizMode
    ? (userBusiness?.category || 'Business')
    : hasBusiness && userBusiness
      ? userBusiness.name
      : 'Event Explorer';

  return (
    <View style={styles.root}>
      <ScrollView
        style={styles.container}
        contentContainerStyle={{ paddingBottom: insets.bottom + 40 }}
        showsVerticalScrollIndicator={false}
      >
        {/* ── Header with gradient ── */}
        <LinearGradient
          colors={
            isBizMode
              ? [Colors.secondary, Colors.secondaryLight]
              : [Palette.gradientStart, Palette.gradientEnd]
          }
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={[styles.headerGradient, { paddingTop: insets.top + Spacing.xl }]}
        >
          <View style={styles.avatarRing}>
            {uploadingAvatar ? (
              <View style={styles.avatarInner}>
                <ActivityIndicator color={Palette.textOnGradient} />
              </View>
            ) : (
              <Avatar
                imageUrl={headerAvatarUrl}
                name={headerName}
                size={80}
                editable
                onPress={handleAvatarPick}
              />
            )}
          </View>

          <Text style={styles.headerName}>{headerName}</Text>

          {isBizMode ? (
            <View style={styles.businessBadge}>
              <Building2 size={13} color={Palette.textOnGradient} />
              <Text style={styles.businessBadgeText}>{userBusiness?.category || 'Business'}</Text>
            </View>
          ) : hasBusiness && userBusiness ? (
            <View style={styles.businessBadge}>
              <Building2 size={13} color={Palette.textOnGradient} />
              <Text style={styles.businessBadgeText}>{userBusiness.name}</Text>
            </View>
          ) : (
            <Text style={styles.headerSubtitle}>Event Explorer</Text>
          )}

          {isBizMode && isPremium && (
            <View style={styles.premiumStatusPill}>
              <Text style={styles.premiumStatusText}>
                Premium subscription active{currentPlan ? ` • ${currentPlan.name}` : ''}
              </Text>
            </View>
          )}

          {/* Mode toggle pill */}
          <TouchableOpacity
            style={styles.modePill}
            onPress={toggleMode}
            activeOpacity={0.8}
          >
            <ArrowLeftRight size={14} color={isBizMode ? Colors.secondary : Colors.primary} />
            <Text style={[styles.modePillText, isBizMode && { color: Colors.secondary }]}>
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
          {isBizMode ? (
            <>
              <StatItem label="Events" value={stats.events} />
              <View style={styles.statDivider} />
              <StatItem label="Followers" value={stats.followers} />
              <View style={styles.statDivider} />
              <StatItem label="Views" value={stats.views} />
            </>
          ) : (
            <>
              <StatItem label="Events" value={stats.events} />
              <View style={styles.statDivider} />
              <StatItem label="Saved" value={stats.saved} />
              <View style={styles.statDivider} />
              <StatItem label="Following" value={stats.following} />
            </>
          )}
        </View>

        {/* ── Create Business CTA (non-business users in user mode) ── */}
        {!hasBusiness && !isBizMode && (
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
                  <Briefcase size={20} color={Colors.primary} />
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
        {isBizMode ? (
          <>
            {/* Upgrade to Premium CTA for business profiles */}
            {!isPremium && userBusiness && (
              <View style={styles.sectionPadding}>
                <TouchableOpacity
                  style={styles.premiumUpgradeButton}
                  onPress={() => setShowPremiumModal(true)}
                  activeOpacity={0.85}
                >
                  <LinearGradient
                    colors={[Colors.accent, Colors.accentDark]}
                    start={{ x: 0, y: 0 }}
                    end={{ x: 1, y: 1 }}
                    style={styles.premiumUpgradeGradient}
                  >
                    <View style={styles.premiumUpgradeIcon}>
                      <Users size={18} color="#FFFFFF" />
                    </View>
                    <View style={styles.premiumUpgradeContent}>
                      <Text style={styles.premiumUpgradeTitle}>Upgrade to Premium!</Text>
                      <Text style={styles.premiumUpgradeSubtitle}>
                        Boosted placement, analytics, recurring events & more
                      </Text>
                    </View>
                    <ChevronRight size={18} color="rgba(255,255,255,0.8)" />
                  </LinearGradient>
                </TouchableOpacity>
              </View>
            )}

            <View style={styles.sectionPadding}>
              <Text style={styles.sectionLabel}>Business</Text>
              <View style={styles.card}>
                <MenuItem
                  icon={<Calendar size={20} color={Colors.secondary} />}
                  label="My Events"
                  sublabel="Manage your posted events"
                  onPress={() => router.push('/my-events' as any)}
                />
                <MenuItem
                  icon={<Users size={20} color={Colors.secondary} />}
                  label="Followers"
                  sublabel="People following your business"
                  onPress={() => router.push('/followers' as any)}
                />
                <MenuItem
                  icon={<BarChart3 size={20} color={Colors.secondary} />}
                  label="Analytics"
                  sublabel="Views, saves & engagement"
                  onPress={() =>
                    Alert.alert('Coming Soon', 'Analytics will be available soon')
                  }
                  isLast
                />
              </View>
            </View>

            <View style={styles.sectionPadding}>
              <Text style={styles.sectionLabel}>Preferences</Text>
              <View style={styles.card}>
                <MenuItem
                  icon={<Settings size={20} color={Colors.secondary} />}
                  label="Business Settings"
                  sublabel="Edit business details"
                  onPress={() => router.push('/settings' as any)}
                  isLast
                />
              </View>
            </View>
          </>
        ) : (
          <>
            <View style={styles.sectionPadding}>
              <Text style={styles.sectionLabel}>Your Activity</Text>
              <View style={styles.card}>
                <MenuItem
                  icon={<Bookmark size={20} color={Colors.primary} />}
                  label="Saved Events"
                  sublabel="Events you've bookmarked"
                  onPress={() => router.push('/saved-events' as any)}
                />
                <MenuItem
                  icon={<Heart size={20} color={Colors.primary} />}
                  label="Following"
                  sublabel="Businesses you follow"
                  onPress={() => router.push('/following' as any)}
                  isLast
                />
              </View>
            </View>

            <View style={styles.sectionPadding}>
              <Text style={styles.sectionLabel}>Preferences</Text>
              <View style={styles.card}>
                <MenuItem
                  icon={<Settings size={20} color={Colors.primary} />}
                  label="Settings"
                  sublabel="Notifications, privacy & more"
                  onPress={() => router.push('/settings' as any)}
                  isLast
                />
              </View>
            </View>
          </>
        )}

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

      {showPremiumModal && (
        <View style={styles.premiumModalOverlay}>
          <TouchableOpacity
            style={styles.premiumModalBackdrop}
            activeOpacity={1}
            onPress={() => !upgrading && setShowPremiumModal(false)}
          />
          <View style={styles.premiumModalCard}>
            <Text style={styles.premiumModalTitle}>Go Premium</Text>
            <Text style={styles.premiumModalSubtitle}>
              Unlock powerful tools to grow your events and stand out on the map.
            </Text>

            <View style={styles.premiumBenefitsList}>
              <BenefitItem label="More than 2 event uploads per month" />
              <BenefitItem label="Boosted event placement in Discover" />
              <BenefitItem label="Highlighted map markers for your events" />
              <BenefitItem label="Event analytics (views, saves, clicks)" />
              <BenefitItem label="Multiple photo uploads per event" />
              <BenefitItem label="Recurring events & schedules" />
              <BenefitItem label="Stripe-powered subscription (coming soon)" />
            </View>

            <TouchableOpacity
              style={styles.premiumBuyButton}
              onPress={handleUpgradeToPremium}
              disabled={upgrading}
              activeOpacity={0.85}
            >
              {upgrading ? (
                <ActivityIndicator size="small" color="#FFFFFF" />
              ) : (
                <Text style={styles.premiumBuyButtonText}>Buy Premium (Mock)</Text>
              )}
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.premiumCloseButton}
              onPress={() => !upgrading && setShowPremiumModal(false)}
              activeOpacity={0.7}
            >
              <Text style={styles.premiumCloseButtonText}>Maybe later</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}
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

function BenefitItem({ label }: { label: string }) {
  return (
    <View style={styles.premiumBenefitRow}>
      <View style={styles.premiumBenefitBullet} />
      <Text style={styles.premiumBenefitText}>{label}</Text>
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
    fontFamily: Typography.fontFamilies.bold,
    fontWeight: Typography.weights.bold,
    color: Palette.textOnGradient,
    letterSpacing: 1,
  },
  headerName: {
    fontSize: 22,
    fontFamily: Typography.displayFontFamilies.bold,
    fontWeight: Typography.weights.bold,
    color: Palette.textOnGradient,
    marginBottom: 4,
  },
  headerSubtitle: {
    fontSize: Typography.sizes.sm,
    fontFamily: Typography.fontFamily,
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
  premiumStatusPill: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
    backgroundColor: 'rgba(16,185,129,0.18)',
    marginBottom: Spacing.md,
  },
  premiumStatusText: {
    fontSize: 12,
    fontFamily: Typography.fontFamilies.semibold,
    fontWeight: Typography.weights.semibold,
    color: '#A7F3D0',
  },
  businessBadgeText: {
    fontSize: 13,
    fontFamily: Typography.fontFamilies.semibold,
    fontWeight: Typography.weights.semibold,
    color: Palette.textOnGradient,
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
    fontFamily: Typography.fontFamilies.semibold,
    fontWeight: Typography.weights.semibold,
    color: Colors.primary,
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
    fontFamily: Typography.fontFamilies.bold,
    fontWeight: Typography.weights.bold,
    color: Colors.text.primary,
  },
  statLabel: {
    fontSize: 12,
    fontFamily: Typography.fontFamily,
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
    fontFamily: Typography.fontFamilies.semibold,
    fontWeight: Typography.weights.semibold,
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
    fontFamily: Typography.fontFamilies.semibold,
    fontWeight: Typography.weights.semibold,
    color: Colors.text.primary,
  },
  menuSublabel: {
    fontSize: 12,
    fontFamily: Typography.fontFamily,
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
    fontFamily: Typography.fontFamilies.bold,
    fontWeight: Typography.weights.bold,
    color: Palette.textOnGradient,
  },
  createBusinessSubtitle: {
    fontSize: 12,
    fontFamily: Typography.fontFamily,
    color: Palette.textOnGradientMuted,
    marginTop: 2,
  },

  /* ── Premium upgrade CTA ── */
  premiumUpgradeButton: {
    borderRadius: 18,
    overflow: 'hidden',
    ...Shadows.md,
  },
  premiumUpgradeGradient: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 14,
    paddingHorizontal: 16,
    gap: 12,
  },
  premiumUpgradeIcon: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: 'rgba(255,255,255,0.18)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  premiumUpgradeContent: {
    flex: 1,
  },
  premiumUpgradeTitle: {
    fontSize: 15,
    fontFamily: Typography.fontFamilies.bold,
    fontWeight: Typography.weights.bold,
    color: '#FFFFFF',
  },
  premiumUpgradeSubtitle: {
    fontSize: 12,
    fontFamily: Typography.fontFamily,
    color: 'rgba(255,255,255,0.8)',
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
    fontFamily: Typography.fontFamilies.semibold,
    fontWeight: Typography.weights.semibold,
  },

  /* ── Footer ── */
  versionText: {
    textAlign: 'center',
    fontSize: 12,
    fontFamily: Typography.fontFamily,
    color: Colors.text.tertiary,
    marginTop: Spacing.xl,
    marginBottom: Spacing.md,
    opacity: 0.5,
  },

  /* ── Premium modal ── */
  premiumModalOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: Spacing.lg,
    backgroundColor: 'rgba(0,0,0,0.45)',
  },
  premiumModalBackdrop: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
  },
  premiumModalCard: {
    width: '100%',
    maxWidth: 420,
    borderRadius: 24,
    padding: Spacing.lg,
    backgroundColor: Palette.cardBg,
    ...Shadows.lg,
  },
  premiumModalTitle: {
    fontSize: 20,
    fontFamily: Typography.fontFamilies.bold,
    fontWeight: Typography.weights.bold,
    color: Colors.text.primary,
    marginBottom: Spacing.xs,
  },
  premiumModalSubtitle: {
    fontSize: Typography.sizes.sm,
    fontFamily: Typography.fontFamily,
    color: Colors.text.secondary,
    marginBottom: Spacing.md,
  },
  premiumBenefitsList: {
    marginBottom: Spacing.lg,
    gap: Spacing.xs,
  },
  premiumBenefitRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: Spacing.sm,
  },
  premiumBenefitBullet: {
    width: 6,
    height: 6,
    borderRadius: 3,
    marginTop: 6,
    backgroundColor: Colors.primary,
  },
  premiumBenefitText: {
    flex: 1,
    fontSize: Typography.sizes.sm,
    fontFamily: Typography.fontFamily,
    color: Colors.text.primary,
  },
  premiumBuyButton: {
    borderRadius: BorderRadius.md,
    backgroundColor: Colors.primary,
    alignItems: 'center',
    paddingVertical: Spacing.md,
    marginBottom: Spacing.sm,
  },
  premiumBuyButtonText: {
    fontSize: Typography.sizes.md,
    fontFamily: Typography.fontFamilies.bold,
    fontWeight: Typography.weights.bold,
    color: '#FFFFFF',
  },
  premiumCloseButton: {
    alignItems: 'center',
    paddingVertical: Spacing.sm,
  },
  premiumCloseButtonText: {
    fontSize: Typography.sizes.sm,
    fontFamily: Typography.fontFamilies.medium,
    fontWeight: Typography.weights.medium,
    color: Colors.text.tertiary,
  },
});