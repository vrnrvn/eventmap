import React, { useCallback, useEffect, useMemo, useState } from 'react';
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
import { eventChatService } from '@/services/eventChat';
import { profilesService } from '@/services/profiles';
import { businessesService } from '@/services/businesses';
import { eventsService } from '@/services/events';
import { socialService } from '@/services/social';
import { useFocusEffect, router } from 'expo-router';
import { Colors, Typography, BorderRadius } from '@/constants/theme';
import { Event, RankedEvent } from '@/types/database';
import { hasEventEnded } from '@/utils/eventStatus';
import { AvatarRing } from '@/components/AvatarRing';
import { confirmAction } from '@/utils/confirm';
import {
  MapPin,
  BadgeCheck,
  CalendarDays,
  ChevronRight,
  LogOut,
  ArrowLeftRight,
  SlidersHorizontal,
  PlusCircle,
  MessageCircle,
  Bookmark,
  BarChart3,
  Users,
  Heart,
} from 'lucide-react-native';

const CREATED_PREVIEW_LIMIT = 3;
const JOINED_PREVIEW_LIMIT = 3;

type ProfileStats = {
  upcoming: number;
  attended: number;
  saved: number;
  created: number;
};

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
  const { isPremium, currentPlan, refreshSubscription } = usePremium();
  const [uploadingAvatar, setUploadingAvatar] = useState(false);
  const [upgrading, setUpgrading] = useState(false);
  const [showPremiumModal, setShowPremiumModal] = useState(false);
  const [createdEvents, setCreatedEvents] = useState<Event[]>([]);
  const [joinedEvents, setJoinedEvents] = useState<RankedEvent[]>([]);
  const [chatUnread, setChatUnread] = useState<Record<string, number>>({});
  const [stats, setStats] = useState<ProfileStats>({ upcoming: 0, attended: 0, saved: 0, created: 0 });
  const [loaded, setLoaded] = useState(false);

  const isBizMode = hasBusiness && userMode === 'business';
  const businessId = hasBusiness ? userBusiness?.id : undefined;
  const userId = user?.id;

  const headerAvatarUrl = isBizMode ? userBusiness?.logo_url : profile?.avatar_url;
  const headerName = isBizMode ? (userBusiness?.name || 'Business') : (profile?.name || 'User');
  const headerLocation = useMemo(() => {
    if (isBizMode && userBusiness?.address) return userBusiness.address;
    if (profile?.city) return profile.city;
    return null;
  }, [isBizMode, profile?.city, userBusiness?.address]);
  const headerBio = useMemo(() => {
    if (isBizMode) return userBusiness?.description?.trim() || '';
    return profile?.bio?.trim() || '';
  }, [isBizMode, profile?.bio, userBusiness?.description]);
  const showVerifiedBadge = isBizMode && !!userBusiness?.verified;

  // Everything on this tab that can change while it stays mounted (RSVPs made
  // elsewhere, new events, chat activity) is reloaded on focus in one pass.
  const loadProfileData = useCallback(
    async (isCancelled: () => boolean) => {
      try {
        const [created, createdCount, upcoming, counts] = await Promise.all([
          businessId
            ? eventsService.getBusinessEvents(businessId, { limit: CREATED_PREVIEW_LIMIT })
            : Promise.resolve([] as Event[]),
          businessId ? eventsService.getBusinessEventsCount(businessId) : Promise.resolve(0),
          userId
            ? socialService.getUserUpcomingEvents(userId, { limit: JOINED_PREVIEW_LIMIT })
            : Promise.resolve([] as RankedEvent[]),
          userId
            ? socialService.getUserAttendanceCounts(userId)
            : Promise.resolve({ upcoming: 0, attended: 0, saved: 0, interested: 0 }),
        ]);
        if (isCancelled()) return;

        setCreatedEvents(created);
        setJoinedEvents(upcoming);
        setStats({
          upcoming: counts.upcoming,
          attended: counts.attended,
          saved: counts.saved,
          created: createdCount,
        });
        setLoaded(true);

        const joinedIds = upcoming.map((event) => event.id);
        if (joinedIds.length === 0) {
          setChatUnread({});
          return;
        }
        // Badges are a nice-to-have: a failure here must not blank the lists.
        const unread = await eventChatService.getUnreadCounts(joinedIds).catch(() => []);
        if (isCancelled()) return;
        setChatUnread(Object.fromEntries(unread.map((row) => [row.event_id, row.unread_count])));
      } catch {
        if (isCancelled()) return;
        setCreatedEvents([]);
        setJoinedEvents([]);
        setChatUnread({});
        setStats({ upcoming: 0, attended: 0, saved: 0, created: 0 });
        setLoaded(true);
      }
    },
    [businessId, userId]
  );

  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      loadProfileData(() => cancelled);
      return () => {
        cancelled = true;
      };
    }, [loadProfileData])
  );

  useEffect(() => {
    if (!isBizMode) setShowPremiumModal(false);
  }, [isBizMode]);

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
            <AvatarRing
              imageUrl={headerAvatarUrl}
              name={headerName}
              loading={uploadingAvatar}
              badge={
                showVerifiedBadge ? (
                  <View style={styles.verifiedBadge}>
                    <BadgeCheck size={16} color="#FFFFFF" />
                  </View>
                ) : null
              }
            />
          </TouchableOpacity>

          <Text style={styles.heroName} numberOfLines={2} adjustsFontSizeToFit minimumFontScale={0.75}>
            {headerName}
          </Text>
          {headerLocation ? (
            <View style={styles.locationRow}>
              <MapPin size={14} color={Palette.primary} fill={Palette.primary} />
              <Text style={styles.locationText} numberOfLines={1}>
                {headerLocation}
              </Text>
            </View>
          ) : !isBizMode ? (
            <TouchableOpacity
              style={styles.locationRow}
              onPress={() => router.push('/settings')}
              activeOpacity={0.7}
              accessibilityRole="button"
              accessibilityLabel="Add your city"
            >
              <MapPin size={14} color={Palette.lightMuted} />
              <Text style={[styles.locationText, styles.locationPlaceholder]}>Add your city</Text>
            </TouchableOpacity>
          ) : null}
          {headerBio ? (
            <Text style={styles.bioText}>{headerBio}</Text>
          ) : isBizMode ? null : (
            <TouchableOpacity onPress={() => router.push('/settings')} activeOpacity={0.7}>
              <Text style={styles.bioPlaceholder}>Add a short bio in Settings</Text>
            </TouchableOpacity>
          )}

          <View style={styles.statGrid}>
            <ProfileStat
              label="Upcoming"
              value={loaded ? String(stats.upcoming) : '–'}
              color={Palette.primary}
              onPress={() => router.push('/joined-events' as never)}
            />
            <ProfileStat
              label="Attended"
              value={loaded ? String(stats.attended) : '–'}
              color={Palette.secondary}
              onPress={() => router.push({ pathname: '/joined-events', params: { tab: 'past' } } as never)}
            />
            {isBizMode ? (
              <ProfileStat
                label="Created"
                value={loaded ? String(stats.created) : '–'}
                color={Palette.text}
                onPress={() => router.push('/my-events')}
              />
            ) : (
              <ProfileStat
                label="Saved"
                value={loaded ? String(stats.saved) : '–'}
                color={Palette.text}
                onPress={() => router.push('/saved-events')}
              />
            )}
          </View>

          <View style={styles.quickLinks}>
            {isBizMode ? (
              <>
                <QuickLink
                  icon={<BarChart3 size={15} color={Palette.primary} />}
                  label="Analytics"
                  onPress={() => router.push('/profile-analytics')}
                />
                <QuickLink
                  icon={<Users size={15} color={Palette.primary} />}
                  label="Followers"
                  onPress={() => router.push('/followers')}
                />
              </>
            ) : (
              <>
                <QuickLink
                  icon={<Bookmark size={15} color={Palette.primary} />}
                  label="Saved"
                  onPress={() => router.push('/saved-events')}
                />
                <QuickLink
                  icon={<Heart size={15} color={Palette.primary} />}
                  label="Following"
                  onPress={() => router.push('/following')}
                />
              </>
            )}
          </View>

          {hasBusiness ? (
            <TouchableOpacity style={styles.modeSwitchPill} onPress={toggleMode} activeOpacity={0.8}>
              <ArrowLeftRight size={14} color={Palette.primary} />
              <Text style={styles.modeSwitchText}>
                {userMode === 'user' ? 'Switch to Business' : 'Switch to Personal'}
              </Text>
            </TouchableOpacity>
          ) : null}

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

          {!loaded ? (
            <View style={styles.skeletonTall} />
          ) : createdEvents.length === 0 ? (
            <View style={styles.joinedEmptyCard}>
              <View style={styles.joinedEmptyIcon}>
                <PlusCircle size={24} color={Palette.primary} />
              </View>
              <Text style={styles.joinedEmptyTitle}>No events yet</Text>
              <Text style={styles.joinedEmptyText}>
                Events you create for your venue will show up here.
              </Text>
            </View>
          ) : (
            createdEvents.map((event) => {
              const ended = hasEventEnded(event);
              return (
                <TouchableOpacity
                  key={event.id}
                  style={styles.eventCard}
                  activeOpacity={0.9}
                  onPress={() => router.push(`/event/${event.id}`)}
                >
                  <View style={styles.eventImageWrap}>
                    {event.cover_image_url ? (
                      <Image source={{ uri: event.cover_image_url }} style={styles.eventImage} />
                    ) : (
                      <View style={[styles.eventImage, styles.eventImagePlaceholder]}>
                        <CalendarDays size={32} color={Palette.primary} />
                      </View>
                    )}
                    <View style={[styles.eventStatusPill, ended ? styles.draftPill : styles.activePill]}>
                      <Text style={[styles.eventStatusText, ended && styles.eventStatusTextMuted]}>
                        {ended ? 'PAST' : 'UPCOMING'}
                      </Text>
                    </View>
                  </View>
                  <View style={styles.eventBody}>
                    <Text style={styles.eventTitle} numberOfLines={1}>
                      {event.title}
                    </Text>
                    <View style={styles.eventMetaRow}>
                      <CalendarDays size={14} color={Palette.lightMuted} />
                      <Text style={styles.eventMetaText}>{formatEventDateTime(event.start_datetime)}</Text>
                    </View>
                  </View>
                </TouchableOpacity>
              );
            })
          )}
        </View>
        )}

        <View style={styles.sectionWrap}>
          <View style={styles.sectionHead}>
            <Text style={styles.sectionTitle}>Events Joined</Text>
            <TouchableOpacity onPress={() => router.push('/joined-events' as never)}>
              <Text style={styles.sectionLink}>View All</Text>
            </TouchableOpacity>
          </View>

          {!loaded ? (
            <>
              <View style={styles.skeletonRow} />
              <View style={styles.skeletonRow} />
            </>
          ) : joinedEvents.length > 0 ? (
            joinedEvents.map((event) => (
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
                  <View style={styles.joinedTitleRow}>
                    <Text style={styles.joinedTitle} numberOfLines={2}>
                      {event.title}
                    </Text>
                    {chatUnread[event.id] ? (
                      <View style={styles.joinedUnreadBadge} accessibilityLabel={`${chatUnread[event.id]} unread chat messages`}>
                        <MessageCircle size={10} color="#FFFFFF" />
                        <Text style={styles.joinedUnreadText}>
                          {chatUnread[event.id] > 99 ? '99+' : chatUnread[event.id]}
                        </Text>
                      </View>
                    ) : null}
                  </View>
                  <Text style={styles.joinedSub} numberOfLines={2}>
                    {event.business_name}
                  </Text>
                </View>
                <View style={styles.joinedTimeWrap}>
                  <Text style={styles.joinedDay}>
                    {formatEventDayLabel(event.next_start_datetime || event.start_datetime)}
                  </Text>
                  <Text style={styles.joinedTime}>
                    {formatEventTime(event.next_start_datetime || event.start_datetime)}
                  </Text>
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

        {!appLoading && !hasBusiness ? (
          <TouchableOpacity
            style={styles.createBusinessCard}
            onPress={toggleMode}
            activeOpacity={0.85}
            accessibilityRole="button"
            accessibilityLabel="Create a business profile"
          >
            <View style={styles.createBusinessIcon}>
              <PlusCircle size={20} color={Palette.primary} />
            </View>
            <View style={styles.createBusinessCopy}>
              <Text style={styles.createBusinessTitle}>Host events?</Text>
              <Text style={styles.createBusinessSub}>Create a business profile to publish your own events.</Text>
            </View>
            <ChevronRight size={18} color={Palette.outline} />
          </TouchableOpacity>
        ) : null}

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

function QuickLink({
  icon,
  label,
  onPress,
}: {
  icon: React.ReactNode;
  label: string;
  onPress: () => void;
}) {
  return (
    <TouchableOpacity
      style={styles.quickLink}
      onPress={onPress}
      activeOpacity={0.8}
      accessibilityRole="button"
      accessibilityLabel={label}
    >
      {icon}
      <Text style={styles.quickLinkText}>{label}</Text>
      <ChevronRight size={14} color={Palette.lightMuted} />
    </TouchableOpacity>
  );
}

function ProfileStat({
  label,
  value,
  color,
  onPress,
}: {
  label: string;
  value: string;
  color: string;
  onPress?: () => void;
}) {
  return (
    <TouchableOpacity
      style={styles.statCard}
      onPress={onPress}
      disabled={!onPress}
      activeOpacity={0.8}
      accessibilityRole={onPress ? 'button' : undefined}
      accessibilityLabel={`${value} ${label}`}
    >
      <View style={styles.statValueRow}>
        <Text style={[styles.statValue, { color }]}>{value}</Text>
      </View>
      <Text style={styles.statLabel}>{label}</Text>
    </TouchableOpacity>
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
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  headerLogo: {
    width: 30,
    height: 30,
    borderRadius: 8,
    tintColor: Colors.primary,
  },
  settingsIcon: {
    width: 36,
    height: 36,
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
  verifiedBadge: {
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
  locationPlaceholder: {
    color: Palette.lightMuted,
  },
  bioPlaceholder: {
    marginTop: 10,
    fontSize: 13,
    color: Palette.primary,
    fontFamily: Typography.labelFontFamilies.semibold,
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
    letterSpacing: 1.2,
    color: Palette.muted,
    fontSize: 11,
    fontFamily: Typography.labelFontFamilies.semibold,
  },
  quickLinks: {
    marginTop: 12,
    width: '100%',
    flexDirection: 'row',
    gap: 10,
  },
  quickLink: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: Palette.card,
    borderWidth: 1,
    borderColor: Palette.softBorder,
    borderRadius: 14,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  quickLinkText: {
    flex: 1,
    fontSize: 13,
    color: Palette.text,
    fontFamily: Typography.fontFamilies.semibold,
    fontWeight: Typography.weights.semibold,
  },
  skeletonRow: {
    height: 82,
    borderRadius: 16,
    backgroundColor: Palette.softCard,
    marginBottom: 10,
  },
  skeletonTall: {
    height: 250,
    borderRadius: 16,
    backgroundColor: Palette.softCard,
    marginBottom: 16,
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
  eventImagePlaceholder: {
    backgroundColor: Colors.accentLight,
    alignItems: 'center',
    justifyContent: 'center',
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
  joinedTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  joinedUnreadBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    height: 18,
    paddingHorizontal: 6,
    borderRadius: 9999,
    backgroundColor: Colors.primary,
  },
  joinedUnreadText: {
    fontSize: 10,
    lineHeight: 12,
    color: '#FFFFFF',
    fontFamily: Typography.labelFontFamilies.semibold,
  },
  joinedTitle: {
    flexShrink: 1,
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
  createBusinessCard: {
    marginTop: 28,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: Palette.card,
    borderWidth: 1,
    borderColor: Palette.softBorder,
    borderRadius: 16,
    padding: 14,
  },
  createBusinessIcon: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: Colors.accentLight,
    alignItems: 'center',
    justifyContent: 'center',
  },
  createBusinessCopy: {
    flex: 1,
  },
  createBusinessTitle: {
    fontSize: 15,
    color: Palette.text,
    fontFamily: Typography.fontFamilies.bold,
    fontWeight: Typography.weights.bold,
  },
  createBusinessSub: {
    marginTop: 2,
    fontSize: 12,
    lineHeight: 16,
    color: Palette.muted,
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
