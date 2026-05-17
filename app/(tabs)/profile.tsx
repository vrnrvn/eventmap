import { useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  Alert,
  ActivityIndicator,
  Image,
} from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuth } from '@/contexts/AuthContext';
import { useApp } from '@/contexts/AppContext';
import { usePremium } from '@/contexts/PremiumContext';
import { premiumService } from '@/services/premium';
import { analyticsService } from '@/services/analytics';
import { profilesService } from '@/services/profiles';
import { businessesService } from '@/services/businesses';
import { eventsService } from '@/services/events';
import { socialService } from '@/services/social';
import { router } from 'expo-router';
import { Colors, Typography, BorderRadius } from '@/constants/theme';
import { Event, RankedEvent } from '@/types/database';
import {
  MapPin,
  BadgeCheck,
  Star,
  CalendarDays,
  ChevronRight,
  LogOut,
  ArrowLeftRight,
  SlidersHorizontal,
  PlusCircle,
} from 'lucide-react-native';

const FALLBACK_CREATED_IMAGES = [
  'https://images.unsplash.com/photo-1514525253161-7a46d19cd819?auto=format&fit=crop&w=1000&q=60',
  'https://images.unsplash.com/photo-1448375240586-882707db888b?auto=format&fit=crop&w=1000&q=60',
];

const Palette = {
  surface: Colors.background.primary,
  card: '#FFFFFF',
  text: Colors.text.primary,
  muted: Colors.text.secondary,
  lightMuted: Colors.text.tertiary,
  primary: Colors.primary,
  secondary: Colors.secondary,
  outline: Colors.border.medium,
  softBorder: 'rgba(0,0,0,0.06)',
  softCard: Colors.background.secondary,
};

export default function ProfileScreen() {
  const insets = useSafeAreaInsets();
  const { profile, signOut, refreshProfile, user } = useAuth();
  const { hasBusiness, userMode, setUserMode, userBusiness, refreshBusiness, loading: appLoading } =
    useApp();
  const { isPremium, currentPlan, canUse, refreshSubscription } = usePremium();
  const [uploadingAvatar, setUploadingAvatar] = useState(false);
  const [upgrading, setUpgrading] = useState(false);
  const [showPremiumModal, setShowPremiumModal] = useState(false);
  const [createdEvents, setCreatedEvents] = useState<Event[]>([]);
  const [joinedEvents, setJoinedEvents] = useState<RankedEvent[]>([]);
  const [stats, setStats] = useState<{
    attended: string;
    created: string;
    rating: string;
  }>({
    attended: '0',
    created: '0',
    rating: '4.9',
  });

  const isBizMode = hasBusiness && userMode === 'business';

  const headerAvatarUrl = isBizMode ? userBusiness?.logo_url : profile?.avatar_url;
  const headerName = isBizMode ? (userBusiness?.name || 'Business') : (profile?.name || 'User');
  const headerLocation = useMemo(() => {
    if (isBizMode && userBusiness?.address) return userBusiness.address;
    if (profile?.city) return profile.city;
    return 'EventMaps';
  }, [isBizMode, profile?.city, userBusiness?.address]);
  const headerBio = useMemo(() => {
    if (isBizMode) return userBusiness?.description || 'Host and manage events with your community.';
    return (
      profile?.bio ||
      'Urban explorer and coffee enthusiast. Hosting the best underground moments in the city.'
    );
  }, [isBizMode, profile?.bio, userBusiness?.description]);

  useEffect(() => {
    let cancelled = false;

    const loadProfileData = async () => {
      try {
        const jobs: Promise<unknown>[] = [];
        if (hasBusiness && userBusiness) {
          jobs.push(eventsService.getBusinessEvents(userBusiness.id, { limit: 4 }));
        } else {
          jobs.push(Promise.resolve([] as Event[]));
        }
        if (user?.id) {
          jobs.push(socialService.getUserUpcomingEvents(user.id));
        } else {
          jobs.push(Promise.resolve([] as RankedEvent[]));
        }
        if (isBizMode && userBusiness && isPremium && canUse('analytics')) {
          jobs.push(analyticsService.getBusinessAnalytics(userBusiness.id, 30));
        } else {
          jobs.push(Promise.resolve(null));
        }

        const [created, upcoming] = (await Promise.all(jobs)) as [Event[], RankedEvent[], unknown];
        if (cancelled) return;

        setCreatedEvents(created || []);
        setJoinedEvents((upcoming || []).slice(0, 4));
        setStats({
          attended: String(upcoming?.length || 0),
          created: String(created?.length || 0),
          rating: '4.9',
        });
      } catch {
        if (!cancelled) {
          setCreatedEvents([]);
          setJoinedEvents([]);
          setStats({ attended: '0', created: '0', rating: '4.9' });
        }
      }
    };

    loadProfileData();
    return () => {
      cancelled = true;
    };
  }, [hasBusiness, user?.id, userBusiness?.id, isBizMode, isPremium, canUse]);

  useEffect(() => {
    if (!isBizMode) setShowPremiumModal(false);
  }, [isBizMode]);

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
    } catch {
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

  const toggleMode = () => {
    if (!hasBusiness) {
      router.push('/business/onboarding' as any);
      return;
    }
    setUserMode(userMode === 'user' ? 'business' : 'user');
  };

  return (
    <View style={styles.root}>
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{
          paddingTop: insets.top + 12,
          paddingBottom: insets.bottom + 48,
          paddingHorizontal: 16,
        }}
      >
        <View style={styles.logoRow}>
          <Image source={require('@/assets/images/EMlogo.png')} style={styles.headerLogo} />
          <TouchableOpacity
            style={styles.settingsIcon}
            activeOpacity={0.8}
            onPress={() => router.push('/settings')}
          >
            <SlidersHorizontal size={17} color={Palette.muted} />
          </TouchableOpacity>
        </View>

        <View style={styles.heroSection}>
          <TouchableOpacity
            style={styles.avatarFrame}
            activeOpacity={0.88}
            onPress={handleAvatarPick}
          >
            <LinearGradient
              colors={[Palette.primary, Colors.primaryLight, Palette.secondary]}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={styles.avatarRing}
            >
              <View style={styles.avatarInner}>
                {uploadingAvatar ? (
                  <ActivityIndicator size="small" color={Palette.primary} />
                ) : headerAvatarUrl ? (
                  <Image source={{ uri: headerAvatarUrl }} style={styles.avatarImage} />
                ) : (
                  <Text style={styles.avatarInitial}>
                    {headerName.slice(0, 1).toUpperCase()}
                  </Text>
                )}
              </View>
            </LinearGradient>
            <View style={styles.verifiedBadge}>
              <BadgeCheck size={16} color="#FFFFFF" />
            </View>
          </TouchableOpacity>

          <Text style={styles.heroName}>{headerName}</Text>
          <View style={styles.locationRow}>
            <MapPin size={14} color={Palette.primary} fill={Palette.primary} />
            <Text style={styles.locationText} numberOfLines={1}>
              {headerLocation}
            </Text>
          </View>
          <Text style={styles.bioText}>{headerBio}</Text>

          <View style={styles.statGrid}>
            <ProfileStat label="Attended" value={stats.attended} color={Palette.primary} />
            <ProfileStat label="Created" value={stats.created} color={Palette.secondary} />
            <ProfileStat
              label="Rating"
              value={stats.rating}
              color={Palette.text}
              showStar
            />
          </View>

          <TouchableOpacity style={styles.modeSwitchPill} onPress={toggleMode} activeOpacity={0.8}>
            <ArrowLeftRight size={14} color={Palette.primary} />
            <Text style={styles.modeSwitchText}>
              {hasBusiness
                ? userMode === 'user'
                  ? 'Switch to Business'
                  : 'Switch to Personal'
                : 'Create Business'}
            </Text>
          </TouchableOpacity>

          {isBizMode && isPremium && (
            <Text style={styles.premiumText}>
              Premium active{currentPlan ? ` • ${currentPlan.name}` : ''}
            </Text>
          )}
        </View>

        {!appLoading && hasBusiness && (
          <TouchableOpacity
            style={styles.createEventWrap}
            onPress={() => router.push('/(tabs)/create')}
            activeOpacity={0.88}
          >
            <LinearGradient
              colors={[Palette.primary, Palette.secondary]}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 0 }}
              style={styles.createEventGradient}
            >
              <View style={styles.createEventIconBg}>
                <PlusCircle size={22} color={Palette.primary} />
              </View>
              <View style={styles.createEventTextCol}>
                <Text style={styles.createEventTitle}>Create event</Text>
                <Text style={styles.createEventSub}>Post a new event for your venue</Text>
              </View>
              <ChevronRight size={20} color="rgba(255,255,255,0.75)" />
            </LinearGradient>
          </TouchableOpacity>
        )}

        {hasBusiness && (
        <View style={styles.sectionWrap}>
          <View style={styles.sectionHead}>
            <Text style={styles.sectionTitle}>Events Created</Text>
            <TouchableOpacity onPress={() => router.push('/my-events')}>
              <Text style={styles.sectionLink}>View All</Text>
            </TouchableOpacity>
          </View>

          {(createdEvents.length ? createdEvents : [null, null]).map((event, index) => (
            <TouchableOpacity
              key={event?.id || `created-${index}`}
              style={styles.eventCard}
              activeOpacity={0.9}
              onPress={() => {
                if (event?.id) router.push(`/event/${event.id}`);
              }}
            >
              <View style={styles.eventImageWrap}>
                <Image
                  source={{
                    uri:
                      event?.cover_image_url ||
                      FALLBACK_CREATED_IMAGES[index % FALLBACK_CREATED_IMAGES.length],
                  }}
                  style={styles.eventImage}
                />
                <View style={[styles.eventStatusPill, index === 0 ? styles.activePill : styles.draftPill]}>
                  <Text style={[styles.eventStatusText, index !== 0 && styles.eventStatusTextMuted]}>
                    {index === 0 ? 'ACTIVE' : 'DRAFT'}
                  </Text>
                </View>
              </View>
              <View style={styles.eventBody}>
                <Text style={styles.eventTitle} numberOfLines={1}>
                  {event?.title || (index === 0 ? 'Underground Jazz Session' : 'Soho Photo Walk')}
                </Text>
                <View style={styles.eventMetaRow}>
                  <CalendarDays size={14} color={Palette.lightMuted} />
                  <Text style={styles.eventMetaText}>
                    {event
                      ? formatEventDateTime(event.start_datetime)
                      : index === 0
                        ? 'Oct 24, 2023 • 21:00'
                        : 'Nov 02, 2023 • 14:00'}
                  </Text>
                </View>
              </View>
            </TouchableOpacity>
          ))}
        </View>
        )}

        <View style={styles.sectionWrap}>
          <View style={styles.sectionHead}>
            <Text style={styles.sectionTitle}>Events Joined</Text>
          </View>

          {joinedEvents.length > 0 ? (
            joinedEvents.slice(0, 2).map((event) => (
              <TouchableOpacity
                key={event.id}
                style={styles.joinedCard}
                activeOpacity={0.85}
                onPress={() => router.push(`/event/${event.id}`)}
              >
                {event.cover_image_url ? (
                  <Image source={{ uri: event.cover_image_url }} style={styles.joinedImage} />
                ) : (
                  <View style={[styles.joinedImage, styles.joinedImagePlaceholder]}>
                    <CalendarDays size={22} color={Palette.primary} />
                  </View>
                )}
                <View style={styles.joinedCopy}>
                  <Text style={styles.joinedTitle} numberOfLines={1}>
                    {event.title}
                  </Text>
                  <Text style={styles.joinedSub} numberOfLines={2}>
                    {event.business_name}
                  </Text>
                </View>
                <View style={styles.joinedTimeWrap}>
                  <Text style={styles.joinedDay}>
                    {formatEventDayLabel(event.start_datetime)}
                  </Text>
                  <Text style={styles.joinedTime}>{formatEventTime(event.start_datetime)}</Text>
                </View>
                <ChevronRight size={18} color={Palette.outline} />
              </TouchableOpacity>
            ))
          ) : (
            <View style={styles.joinedEmptyCard}>
              <View style={styles.joinedEmptyIcon}>
                <CalendarDays size={24} color={Palette.primary} />
              </View>
              <Text style={styles.joinedEmptyTitle}>No events joined yet</Text>
              <Text style={styles.joinedEmptyText}>
                Events you join will appear here once you RSVP as going.
              </Text>
              <TouchableOpacity
                style={styles.joinedEmptyButton}
                onPress={() => router.push('/(tabs)/discover')}
                activeOpacity={0.85}
              >
                <Text style={styles.joinedEmptyButtonText}>Discover events</Text>
              </TouchableOpacity>
            </View>
          )}
        </View>

        {!isPremium && isBizMode && (
          <TouchableOpacity
            style={styles.upgradeCard}
            onPress={() => setShowPremiumModal(true)}
            activeOpacity={0.9}
          >
            <LinearGradient
              colors={[Palette.primary, Palette.secondary]}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 0 }}
              style={styles.upgradeGradient}
            >
              <Text style={styles.upgradeTitle}>Upgrade to Premium</Text>
              <Text style={styles.upgradeSub}>
                Boosted placement, analytics, recurring events, and more
              </Text>
            </LinearGradient>
          </TouchableOpacity>
        )}

        <TouchableOpacity style={styles.signOutButton} onPress={handleSignOut} activeOpacity={0.8}>
          <LogOut size={16} color={Colors.error} />
          <Text style={styles.signOutText}>Sign Out</Text>
        </TouchableOpacity>
      </ScrollView>

      {showPremiumModal && isBizMode && (
        <View style={styles.premiumModalOverlay}>
          <TouchableOpacity
            style={styles.premiumModalBackdrop}
            activeOpacity={1}
            onPress={() => !upgrading && setShowPremiumModal(false)}
          />
          <View style={styles.premiumModalCard}>
            <Text style={styles.premiumModalTitle}>Go Premium</Text>
            <Text style={styles.premiumModalSubtitle}>
              Unlock boosted event placement, analytics, and recurring scheduling.
            </Text>
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

function ProfileStat({
  label,
  value,
  color,
  showStar = false,
}: {
  label: string;
  value: string;
  color: string;
  showStar?: boolean;
}) {
  return (
    <View style={styles.statCard}>
      <View style={styles.statValueRow}>
        <Text style={[styles.statValue, { color }]}>{value}</Text>
        {showStar ? <Star size={12} color={Palette.secondary} fill={Palette.secondary} /> : null}
      </View>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

function formatEventDateTime(value: string) {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return 'Upcoming';
  return d.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).replace(',', ' •');
}

function formatEventTime(value: string) {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '--:--';
  return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
}

function formatEventDayLabel(value: string) {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return 'UPCOMING';

  const today = new Date();
  const tomorrow = new Date();
  tomorrow.setDate(today.getDate() + 1);

  if (d.toDateString() === today.toDateString()) return 'TODAY';
  if (d.toDateString() === tomorrow.toDateString()) return 'TOMORROW';

  return d
    .toLocaleDateString('en-US', {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
    })
    .toUpperCase();
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: Palette.surface,
  },
  logoRow: {
    alignItems: 'flex-end',
    marginBottom: 10,
    gap: 8,
  },
  headerLogo: {
    width: 30,
    height: 30,
    borderRadius: 8,
    tintColor: Colors.primary,
  },
  settingsIcon: {
    width: 32,
    height: 32,
    borderRadius: BorderRadius.round,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.85)',
    borderWidth: 1,
    borderColor: 'rgba(0,0,0,0.06)',
  },
  heroSection: {
    alignItems: 'center',
  },
  avatarFrame: {
    marginTop: 0,
    marginBottom: 10,
  },
  avatarRing: {
    width: 140,
    height: 140,
    borderRadius: 70,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 6,
  },
  avatarInner: {
    width: '100%',
    height: '100%',
    borderRadius: BorderRadius.round,
    backgroundColor: Palette.card,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 4,
    borderColor: Palette.surface,
  },
  avatarImage: {
    width: '100%',
    height: '100%',
  },
  avatarInitial: {
    color: Palette.primary,
    fontSize: 46,
    fontFamily: Typography.displayFontFamilies.bold,
    fontWeight: Typography.weights.bold,
  },
  verifiedBadge: {
    position: 'absolute',
    bottom: 10,
    right: 8,
    width: 34,
    height: 34,
    borderRadius: BorderRadius.round,
    backgroundColor: Palette.primary,
    borderWidth: 3,
    borderColor: Palette.surface,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: Palette.primary,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.18,
    shadowRadius: 8,
    elevation: 3,
  },
  heroName: {
    marginTop: 2,
    color: Palette.text,
    fontSize: 28,
    lineHeight: 32,
    letterSpacing: -0.3,
    fontFamily: Typography.displayFontFamilies.extrabold,
    fontWeight: '800',
  },
  locationRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginTop: 6,
  },
  locationText: {
    color: Palette.primary,
    fontSize: 14,
    lineHeight: 20,
    fontFamily: Typography.fontFamilies.bold,
    fontWeight: Typography.weights.bold,
    maxWidth: 260,
  },
  bioText: {
    marginTop: 12,
    textAlign: 'center',
    color: Palette.muted,
    fontSize: 14,
    lineHeight: 22,
    maxWidth: 320,
    fontFamily: Typography.fontFamilies.medium,
    fontWeight: Typography.weights.medium,
  },
  statGrid: {
    marginTop: 20,
    width: '100%',
    flexDirection: 'row',
    gap: 12,
  },
  statCard: {
    flex: 1,
    minHeight: 76,
    backgroundColor: Palette.card,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: Palette.softBorder,
  },
  statValueRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
  },
  statValue: {
    fontSize: 22,
    lineHeight: 26,
    fontFamily: Typography.displayFontFamilies.extrabold,
    fontWeight: '800',
  },
  statLabel: {
    marginTop: 4,
    textTransform: 'uppercase',
    letterSpacing: 1.7,
    color: Palette.lightMuted,
    fontSize: 10,
    fontFamily: Typography.labelFontFamilies.semibold,
  },
  modeSwitchPill: {
    marginTop: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: Palette.card,
    borderWidth: 1,
    borderColor: Palette.softBorder,
    borderRadius: BorderRadius.round,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  modeSwitchText: {
    color: Palette.primary,
    fontSize: 12,
    fontFamily: Typography.fontFamilies.semibold,
    fontWeight: Typography.weights.semibold,
  },
  premiumText: {
    marginTop: 8,
    fontSize: 12,
    color: Palette.secondary,
    fontFamily: Typography.labelFontFamilies.medium,
  },
  createEventWrap: {
    marginTop: 28,
    borderRadius: BorderRadius.lg,
    overflow: 'hidden',
  },
  createEventGradient: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 16,
    paddingHorizontal: 16,
    gap: 14,
  },
  createEventIconBg: {
    width: 44,
    height: 44,
    borderRadius: 12,
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  createEventTextCol: {
    flex: 1,
  },
  createEventTitle: {
    color: '#FFFFFF',
    fontSize: 17,
    fontFamily: Typography.fontFamilies.bold,
    fontWeight: Typography.weights.bold,
  },
  createEventSub: {
    color: 'rgba(255,255,255,0.88)',
    fontSize: 13,
    marginTop: 2,
    fontFamily: Typography.fontFamilies.medium,
    fontWeight: Typography.weights.medium,
  },
  sectionWrap: {
    marginTop: 34,
  },
  sectionHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 14,
  },
  sectionTitle: {
    color: Palette.text,
    fontSize: 20,
    lineHeight: 24,
    letterSpacing: -0.2,
    fontFamily: Typography.displayFontFamilies.bold,
    fontWeight: Typography.weights.bold,
  },
  sectionLink: {
    color: Palette.primary,
    fontSize: 14,
    fontFamily: Typography.fontFamilies.bold,
    fontWeight: Typography.weights.bold,
  },
  eventCard: {
    backgroundColor: Palette.card,
    borderRadius: 16,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: Palette.softBorder,
    marginBottom: 16,
  },
  eventImageWrap: {
    height: 178,
    position: 'relative',
  },
  eventImage: {
    width: '100%',
    height: '100%',
  },
  eventStatusPill: {
    position: 'absolute',
    top: 12,
    left: 12,
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderRadius: BorderRadius.round,
  },
  activePill: {
    backgroundColor: Palette.primary,
  },
  draftPill: {
    backgroundColor: '#ECECEC',
  },
  eventStatusText: {
    color: '#FFFFFF',
    fontSize: 10,
    letterSpacing: 1.2,
    fontFamily: Typography.labelFontFamilies.semibold,
  },
  eventStatusTextMuted: {
    color: Palette.lightMuted,
  },
  eventBody: {
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  eventTitle: {
    fontSize: 16,
    color: Palette.text,
    fontFamily: Typography.fontFamilies.bold,
    fontWeight: Typography.weights.bold,
  },
  eventMetaRow: {
    marginTop: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  eventMetaText: {
    color: Palette.muted,
    fontSize: 13,
    fontFamily: Typography.labelFontFamilies.medium,
  },
  joinedCard: {
    backgroundColor: Palette.card,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: Palette.softBorder,
    padding: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginBottom: 10,
  },
  joinedImage: {
    width: 58,
    height: 58,
    borderRadius: 14,
  },
  joinedImagePlaceholder: {
    backgroundColor: Colors.accentLight,
    alignItems: 'center',
    justifyContent: 'center',
  },
  joinedCopy: {
    flex: 1,
  },
  joinedTitle: {
    color: Palette.text,
    fontSize: 16,
    fontFamily: Typography.fontFamilies.bold,
    fontWeight: Typography.weights.bold,
  },
  joinedSub: {
    marginTop: 2,
    color: Palette.muted,
    fontSize: 12,
    lineHeight: 16,
    fontFamily: Typography.labelFontFamilies.medium,
  },
  joinedTimeWrap: {
    alignItems: 'flex-end',
    marginRight: 2,
  },
  joinedDay: {
    color: Palette.primary,
    fontSize: 11,
    fontFamily: Typography.labelFontFamilies.semibold,
  },
  joinedTime: {
    marginTop: 2,
    color: Palette.muted,
    fontSize: 12,
    fontFamily: Typography.labelFontFamilies.medium,
  },
  joinedEmptyCard: {
    alignItems: 'center',
    paddingHorizontal: 22,
    paddingVertical: 24,
    borderRadius: 18,
    backgroundColor: Palette.card,
    borderWidth: 1,
    borderColor: Palette.softBorder,
  },
  joinedEmptyIcon: {
    width: 52,
    height: 52,
    borderRadius: BorderRadius.round,
    backgroundColor: Colors.accentLight,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 12,
  },
  joinedEmptyTitle: {
    color: Palette.text,
    fontSize: 17,
    fontFamily: Typography.fontFamilies.bold,
    fontWeight: Typography.weights.bold,
  },
  joinedEmptyText: {
    marginTop: 6,
    color: Palette.muted,
    fontSize: 13,
    lineHeight: 19,
    textAlign: 'center',
    fontFamily: Typography.fontFamilies.medium,
    fontWeight: Typography.weights.medium,
  },
  joinedEmptyButton: {
    marginTop: 16,
    paddingHorizontal: 16,
    paddingVertical: 9,
    borderRadius: BorderRadius.round,
    backgroundColor: Palette.primary,
  },
  joinedEmptyButtonText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontFamily: Typography.fontFamilies.bold,
    fontWeight: Typography.weights.bold,
  },
  upgradeCard: {
    marginTop: 12,
    borderRadius: 16,
    overflow: 'hidden',
  },
  upgradeGradient: {
    paddingHorizontal: 16,
    paddingVertical: 16,
  },
  upgradeTitle: {
    color: '#FFFFFF',
    fontSize: 16,
    fontFamily: Typography.fontFamilies.bold,
    fontWeight: Typography.weights.bold,
  },
  upgradeSub: {
    marginTop: 2,
    color: 'rgba(255,255,255,0.82)',
    fontSize: 12,
    fontFamily: Typography.labelFontFamilies.medium,
  },
  signOutButton: {
    marginTop: 20,
    alignSelf: 'center',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 9,
  },
  signOutText: {
    color: Colors.error,
    fontSize: 14,
    fontFamily: Typography.fontFamilies.semibold,
    fontWeight: Typography.weights.semibold,
  },
  premiumModalOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 20,
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
    padding: 22,
    backgroundColor: Palette.card,
  },
  premiumModalTitle: {
    fontSize: 22,
    color: Palette.text,
    fontFamily: Typography.displayFontFamilies.bold,
    fontWeight: Typography.weights.bold,
  },
  premiumModalSubtitle: {
    marginTop: 8,
    fontSize: 14,
    lineHeight: 21,
    color: Palette.muted,
    fontFamily: Typography.fontFamilies.medium,
    fontWeight: Typography.weights.medium,
  },
  premiumBuyButton: {
    marginTop: 20,
    borderRadius: 14,
    backgroundColor: Palette.primary,
    alignItems: 'center',
    paddingVertical: 13,
  },
  premiumBuyButtonText: {
    color: '#FFFFFF',
    fontSize: 15,
    fontFamily: Typography.fontFamilies.bold,
    fontWeight: Typography.weights.bold,
  },
  premiumCloseButton: {
    alignItems: 'center',
    paddingVertical: 11,
    marginTop: 4,
  },
  premiumCloseButtonText: {
    color: Palette.lightMuted,
    fontSize: 13,
    fontFamily: Typography.fontFamilies.medium,
    fontWeight: Typography.weights.medium,
  },
});
