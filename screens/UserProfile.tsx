import { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  Linking,
  useWindowDimensions,
  RefreshControl,
} from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ban, Flag, Lock, Pencil } from 'lucide-react-native';
import { useAuth } from '@/contexts/AuthContext';
import { complaintsService } from '@/services/complaints';
import { notify, notifyConfirm } from '@/utils/notify';
import { profilesService } from '@/services/profiles';
import { socialService } from '@/services/social';
import { Profile, RankedEvent } from '@/types/database';
import { alpha, Colors, Spacing, Typography, BorderRadius, Shadows } from '@/constants/theme';
import { formatEventDate } from '@/utils/formatEventWhen';
import { Avatar } from '@/components/Avatar';
import { EventCardCarousel } from '@/components/EventCardCarousel';
import { CategoryIcon } from '@/components/CategoryIcon';
import { getCategoryIconColor } from '@/constants/categoryIcons';
import { ScreenHeader } from '@/components/ui/ScreenHeader';
import { EventmapCalendar } from '@/components/icons/EventmapIcons';
import { FacebookIcon, InstagramIcon } from '@/components/icons/BrandIcons';

/** Share of the window each horizontal event card occupies. */
const EVENT_CARD_WIDTH_RATIO = 0.7;

const formatDate = (iso: string) => formatEventDate(iso);

function buildInstagramUrl(handle: string): string {
  const clean = handle.replace(/^@/, '').trim();
  return `https://instagram.com/${clean}`;
}

function buildFacebookUrl(handle: string): string {
  const clean = handle.trim();
  if (clean.startsWith('http')) return clean;
  if (clean.startsWith('facebook.com/') || clean.startsWith('fb.com/')) {
    return `https://${clean}`;
  }
  return `https://facebook.com/${clean}`;
}

export default function UserProfile() {
  const { width: windowWidth } = useWindowDimensions();
  const EVENT_CARD_WIDTH = windowWidth * EVENT_CARD_WIDTH_RATIO;
  const { id } = useLocalSearchParams<{ id: string }>();
  const insets = useSafeAreaInsets();
  const { user, profile: currentUserProfile } = useAuth();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [isPrivate, setIsPrivate] = useState(false);
  const [upcomingEvents, setUpcomingEvents] = useState<RankedEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [reportSubmitting, setReportSubmitting] = useState(false);
  const [blocked, setBlocked] = useState(false);
  const [blockBusy, setBlockBusy] = useState(false);

  const isOwnProfile = user?.id === id;

  const load = useCallback(async () => {
    if (!id) return;
    try {
      setLoadError(false);
      if (isOwnProfile) {
        const [p, events] = await Promise.all([
          profilesService.getProfile(id),
          socialService.getUserUpcomingEvents(id),
        ]);
        setProfile(p);
        setIsPrivate(false);
        setUpcomingEvents(events);
      } else {
        const [result, isBlockedResult] = await Promise.all([
          profilesService.getPublicProfile(id),
          // Best-effort: blocking is NOT_AVAILABLE until migration
          // 20261030111000 is applied — treat any failure as "not blocked".
          socialService.isBlocked(id).catch(() => false),
        ]);
        setBlocked(isBlockedResult);
        if (!result) {
          setProfile(null);
          setIsPrivate(false);
          setUpcomingEvents([]);
          return;
        }
        if (result.isPrivate) {
          setProfile(null);
          setIsPrivate(true);
          setUpcomingEvents([]);
          return;
        }
        setProfile(result.profile);
        setIsPrivate(false);
        if (result.profile.show_future_events !== false) {
          const events = await socialService.getUserUpcomingEvents(id);
          setUpcomingEvents(events);
        } else {
          setUpcomingEvents([]);
        }
      }
    } catch {
      // Fetch failure (network/server) — not a missing profile. Surface an
      // error state with Retry instead of a misleading "Profile not found".
      setProfile(null);
      setIsPrivate(false);
      setUpcomingEvents([]);
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  }, [id, isOwnProfile]);

  // Reset to the loading state whenever the route id changes so a previous
  // user's profile is not shown while the next one loads.
  useEffect(() => {
    setLoading(true);
    load();
  }, [load]);

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    load().finally(() => setRefreshing(false));
  }, [load]);

  const socialHandles = (profile?.social_handles as { instagram?: string; facebook?: string } | null) ?? {};

  const handleReportUser = useCallback(() => {
    if (!id || reportSubmitting) return;
    notifyConfirm({
      title: 'Report user',
      message: 'Report this user for inappropriate content or behavior? Our team reviews reports within about 48 hours.',
      confirmLabel: 'Report',
      destructive: true,
      onConfirm: () => {
        void (async () => {
          setReportSubmitting(true);
          try {
            await complaintsService.createComplaint('user', id, 'Reported from profile');
            notify.success('Thanks for your report. We will review it shortly.');
          } catch (err) {
            // Unique violation: this user was already reported by this account.
            if ((err as { code?: string } | null)?.code === '23505') {
              notify.success('You have already reported this user. Our team is on it.');
            } else {
              notify.error('Failed to submit report. Please try again.');
            }
          } finally {
            setReportSubmitting(false);
          }
        })();
      },
    });
  }, [id, reportSubmitting]);

  const handleToggleBlock = useCallback(() => {
    if (!id || blockBusy) return;
    const blocking = !blocked;
    notifyConfirm({
      title: blocking ? 'Block user' : 'Unblock user',
      message: blocking
        ? 'Block this user? They will not be notified. You can unblock them from their profile at any time.'
        : 'Unblock this user?',
      confirmLabel: blocking ? 'Block' : 'Unblock',
      destructive: blocking,
      onConfirm: () => {
        void (async () => {
          setBlockBusy(true);
          try {
            if (blocking) {
              await socialService.blockUser(id);
            } else {
              await socialService.unblockUser(id);
            }
            setBlocked(blocking);
            notify.success(blocking ? 'User blocked.' : 'User unblocked.');
          } catch (err) {
            if ((err as { code?: string } | null)?.code === 'NOT_AVAILABLE') {
              notify.error("Blocking isn't enabled on this server yet.");
            } else {
              notify.error(
                blocking
                  ? 'Failed to block user. Please try again.'
                  : 'Failed to unblock user. Please try again.'
              );
            }
          } finally {
            setBlockBusy(false);
          }
        })();
      },
    });
  }, [id, blocked, blockBusy]);

  const headerActions = user && isOwnProfile ? (
    <TouchableOpacity
      onPress={() => router.push('/settings' as never)}
      style={styles.headerIconBtn}
      hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
      accessibilityRole="button"
      accessibilityLabel="Edit profile"
      activeOpacity={0.7}
    >
      <Pencil size={20} color={Colors.text.secondary} />
    </TouchableOpacity>
  ) : user && !isOwnProfile ? (
      <View style={styles.headerActions}>
        <TouchableOpacity
          onPress={handleToggleBlock}
          disabled={blockBusy}
          style={styles.reportBtn}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          accessibilityRole="button"
          accessibilityLabel={blocked ? 'Unblock user' : 'Block user'}
          activeOpacity={0.7}
        >
          <Ban size={20} color={blocked ? Colors.error : Colors.text.tertiary} />
        </TouchableOpacity>
        <TouchableOpacity
          onPress={handleReportUser}
          disabled={reportSubmitting}
          style={styles.reportBtn}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          accessibilityRole="button"
          accessibilityLabel="Report user"
          activeOpacity={0.7}
        >
          <Flag size={20} color={Colors.text.tertiary} />
        </TouchableOpacity>
      </View>
    ) : undefined;

  if (loading) {
    return (
      <View style={[styles.center, { paddingTop: insets.top }]}>
        <ActivityIndicator size="large" color={Colors.primary} />
      </View>
    );
  }

  if (isPrivate) {
    return (
      <View style={[styles.container, { paddingTop: insets.top }]}>
        <ScreenHeader title="Profile" safeArea={false} />
        <View style={styles.privateState}>
          <View style={styles.privateIconWrap}>
            <Lock size={32} color={Colors.text.tertiary} />
          </View>
          <Text style={styles.privateTitle}>Private Profile</Text>
          <Text style={styles.privateSubtitle}>
            This user has chosen to keep their profile private.
          </Text>
        </View>
      </View>
    );
  }

  if (loadError) {
    return (
      <View style={[styles.container, { paddingTop: insets.top }]}>
        <ScreenHeader title="Profile" safeArea={false} />
        <View style={styles.center}>
          <Text style={styles.errorText}>
            Couldn&apos;t load this profile. Check your connection and try again.
          </Text>
          <TouchableOpacity
            style={styles.retryBtn}
            onPress={() => {
              setLoading(true);
              load();
            }}
            accessibilityRole="button"
            accessibilityLabel="Retry loading profile"
            activeOpacity={0.8}
          >
            <Text style={styles.retryText}>Retry</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  if (!profile) {
    return (
      <View style={[styles.container, { paddingTop: insets.top }]}>
        <ScreenHeader title="Profile" safeArea={false} />
        <View style={styles.center}>
          <Text style={styles.errorText}>Profile not found</Text>
        </View>
      </View>
    );
  }

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <ScreenHeader title="Profile" safeArea={false} right={headerActions} />

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={Colors.primary} />
        }
      >
        {blocked ? (
          <View style={styles.blockedBanner}>
            <Ban size={16} color={Colors.error} />
            <Text style={styles.blockedBannerText}>You&apos;ve blocked this user.</Text>
            <TouchableOpacity
              onPress={handleToggleBlock}
              disabled={blockBusy}
              hitSlop={{ top: 14, bottom: 14, left: 12, right: 12 }}
              accessibilityRole="button"
              accessibilityLabel="Unblock user"
            >
              <Text style={styles.blockedBannerAction}>Unblock</Text>
            </TouchableOpacity>
          </View>
        ) : null}

        <View style={styles.hero}>
          <Avatar imageUrl={profile.avatar_url} name={profile.name} size={100} />
          <Text style={styles.name}>{profile.name}</Text>
        </View>

        {(profile.bio || profile.hobbies) ? (
          <View style={styles.aboutCard}>
            {profile.bio ? (
              <>
                <Text style={styles.sectionLabel}>About me</Text>
                <Text style={styles.bio}>{profile.bio}</Text>
              </>
            ) : null}
            {profile.hobbies ? (
              <>
                <Text style={[styles.sectionLabel, profile.bio ? styles.sectionLabelSpaced : null]}>
                  Hobbies
                </Text>
                <Text style={styles.hobbies}>{profile.hobbies}</Text>
              </>
            ) : null}
          </View>
        ) : null}

        {(socialHandles.instagram || socialHandles.facebook) ? (
          <View style={styles.socialsSection}>
            <Text style={styles.socialsLabel}>Connect</Text>
            <View style={styles.socials}>
            {socialHandles.instagram ? (
              <TouchableOpacity
                style={styles.socialBtn}
                onPress={() => Linking.openURL(buildInstagramUrl(socialHandles.instagram!))}
                activeOpacity={0.7}
                accessibilityRole="button"
                accessibilityLabel="Open Instagram profile"
                hitSlop={{ top: 4, bottom: 4, left: 4, right: 4 }}
              >
                <InstagramIcon size={24} />
              </TouchableOpacity>
            ) : null}
            {socialHandles.facebook ? (
              <TouchableOpacity
                style={styles.socialBtn}
                onPress={() => Linking.openURL(buildFacebookUrl(socialHandles.facebook!))}
                activeOpacity={0.7}
                accessibilityRole="button"
                accessibilityLabel="Open Facebook profile"
                hitSlop={{ top: 4, bottom: 4, left: 4, right: 4 }}
              >
                <FacebookIcon size={24} />
              </TouchableOpacity>
            ) : null}
            </View>
          </View>
        ) : null}

        {/* Hidden entirely (not "No upcoming events") when the user opted out
            of showing future events — an empty state would misrepresent a
            privacy choice as an empty schedule. */}
        {profile.show_future_events !== false ? (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Events I&apos;m Planning to Attend</Text>
          {upcomingEvents.length > 0 ? (
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={true}
              contentContainerStyle={styles.eventsRow}
            >
              {upcomingEvents.map((event) => (
                <TouchableOpacity
                  key={event.id}
                  style={[styles.eventCard, { width: EVENT_CARD_WIDTH }]}
                  onPress={() => router.push(`/event/${event.id}` as any)}
                  activeOpacity={0.9}
                  accessibilityRole="button"
                  accessibilityLabel={`${event.title}, ${formatDate(event.next_start_datetime || event.start_datetime)}`}
                >
                  <EventCardCarousel
                    imageUrls={event.cover_image_url ? [event.cover_image_url] : []}
                    imageHeight={120}
                  />
                  <View style={styles.eventCardContent}>
                    <Text style={styles.eventTitle} numberOfLines={2}>
                      {event.title}
                    </Text>
                    <View style={styles.eventMeta}>
                      <EventmapCalendar size={14} color={Colors.text.secondary} />
                      <Text style={styles.eventMetaText}>
                        {formatDate(event.next_start_datetime || event.start_datetime)}
                      </Text>
                    </View>
                    <View style={[styles.categoryBadge, { backgroundColor: `${getCategoryIconColor(event.category_slug)}18` }]}>
                      <CategoryIcon category={event.category_slug} size="sm" variant="minimal" />
                      <Text style={[styles.categoryText, { color: getCategoryIconColor(event.category_slug) }]}>
                        {event.category_label}
                      </Text>
                    </View>
                  </View>
                </TouchableOpacity>
              ))}
            </ScrollView>
          ) : (
            <Text style={styles.emptyEventsText}>No upcoming events</Text>
          )}
        </View>
        ) : null}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background.primary,
  },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    paddingBottom: Spacing.xl,
  },
  hero: {
    alignItems: 'center',
    paddingHorizontal: Spacing.xl,
    paddingBottom: Spacing.xl,
  },
  name: {
    fontSize: Typography.sizes.xxl,
    fontFamily: Typography.displayFontFamilies.bold,
    fontWeight: Typography.weights.bold,
    color: Colors.text.primary,
    marginTop: Spacing.md,
    textAlign: 'center',
  },
  aboutCard: {
    marginHorizontal: Spacing.lg,
    marginBottom: Spacing.xl,
    padding: Spacing.md,
    backgroundColor: Colors.surface,
    borderRadius: BorderRadius.lg,
    ...Shadows.card,
  },
  sectionLabel: {
    fontSize: Typography.sizes.sm,
    fontFamily: Typography.fontFamilies.semibold,
    fontWeight: Typography.weights.semibold,
    color: Colors.text.tertiary,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
  },
  sectionLabelSpaced: {
    marginTop: Spacing.md,
  },
  bio: {
    fontSize: Typography.sizes.md,
    fontFamily: Typography.fontFamily,
    color: Colors.text.secondary,
    marginTop: Spacing.xs,
    textAlign: 'left',
    lineHeight: 22,
  },
  hobbies: {
    fontSize: Typography.sizes.md,
    fontFamily: Typography.fontFamily,
    color: Colors.text.secondary,
    marginTop: Spacing.xs,
    textAlign: 'left',
    lineHeight: 22,
  },
  socialsSection: {
    marginBottom: Spacing.xl,
  },
  socialsLabel: {
    fontSize: Typography.sizes.sm,
    fontFamily: Typography.fontFamilies.semibold,
    fontWeight: Typography.weights.semibold,
    color: Colors.text.tertiary,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    marginBottom: Spacing.sm,
    textAlign: 'center',
  },
  socials: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: Spacing.lg,
  },
  socialBtn: {
    padding: Spacing.sm,
  },
  section: {
    marginTop: Spacing.md,
  },
  sectionTitle: {
    fontSize: Typography.sizes.lg,
    fontFamily: Typography.fontFamilies.semibold,
    fontWeight: Typography.weights.semibold,
    color: Colors.text.primary,
    marginBottom: Spacing.md,
    paddingHorizontal: Spacing.xl,
  },
  eventsRow: {
    paddingHorizontal: Spacing.xl,
    gap: Spacing.md,
    paddingRight: Spacing.xl,
  },
  eventCard: {
    borderRadius: BorderRadius.lg,
    overflow: 'hidden',
    backgroundColor: Colors.background.secondary,
  },
  eventCardContent: {
    padding: Spacing.md,
  },
  eventTitle: {
    fontSize: Typography.sizes.md,
    fontFamily: Typography.fontFamilies.semibold,
    fontWeight: Typography.weights.semibold,
    color: Colors.text.primary,
  },
  eventMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs,
    marginTop: Spacing.xs,
  },
  eventMetaText: {
    fontSize: Typography.sizes.sm,
    fontFamily: Typography.fontFamily,
    color: Colors.text.secondary,
  },
  categoryBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: Spacing.xs,
    paddingHorizontal: Spacing.sm,
    paddingVertical: Spacing.xs,
    borderRadius: BorderRadius.round,
    marginTop: Spacing.sm,
  },
  categoryText: {
    fontSize: Typography.sizes.xs,
    fontFamily: Typography.fontFamilies.medium,
    fontWeight: Typography.weights.medium,
  },
  emptyEventsText: {
    fontSize: Typography.sizes.md,
    fontFamily: Typography.fontFamily,
    color: Colors.text.tertiary,
    paddingHorizontal: Spacing.xl,
  },
  privateState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: Spacing.xl,
  },
  privateIconWrap: {
    width: 72,
    height: 72,
    borderRadius: BorderRadius.round,
    backgroundColor: Colors.neutralSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  privateTitle: {
    fontSize: Typography.sizes.xl,
    fontFamily: Typography.fontFamilies.semibold,
    fontWeight: Typography.weights.semibold,
    color: Colors.text.primary,
    marginTop: Spacing.lg,
  },
  privateSubtitle: {
    fontSize: Typography.sizes.md,
    fontFamily: Typography.fontFamily,
    color: Colors.text.secondary,
    marginTop: Spacing.sm,
    textAlign: 'center',
  },
  errorText: {
    fontSize: Typography.sizes.md,
    fontFamily: Typography.fontFamily,
    color: Colors.text.secondary,
    textAlign: 'center',
    paddingHorizontal: Spacing.xl,
  },
  retryBtn: {
    marginTop: Spacing.lg,
    paddingHorizontal: Spacing.xl,
    paddingVertical: Spacing.sm,
    borderRadius: BorderRadius.round,
    backgroundColor: Colors.primarySoft,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  retryText: {
    fontSize: Typography.sizes.md,
    fontFamily: Typography.fontFamilies.semibold,
    fontWeight: Typography.weights.semibold,
    color: Colors.primary,
  },
  headerActions: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  reportBtn: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerIconBtn: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  blockedBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    marginHorizontal: Spacing.xl,
    marginBottom: Spacing.lg,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    borderRadius: BorderRadius.md,
    backgroundColor: alpha(Colors.error, 0.08),
  },
  blockedBannerText: {
    flex: 1,
    fontSize: Typography.sizes.sm,
    color: Colors.text.secondary,
  },
  blockedBannerAction: {
    fontSize: Typography.sizes.sm,
    fontFamily: Typography.fontFamilies.semibold,
    fontWeight: Typography.weights.semibold,
    color: Colors.error,
  },
});
