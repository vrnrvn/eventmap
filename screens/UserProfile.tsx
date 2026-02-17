import { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  Linking,
  Dimensions,
  RefreshControl,
} from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuth } from '@/contexts/AuthContext';
import { profilesService } from '@/services/profiles';
import { socialService } from '@/services/social';
import { Profile, RankedEvent } from '@/types/database';
import { Colors, Spacing, Typography, BorderRadius } from '@/constants/theme';
import { Avatar } from '@/components/Avatar';
import { EventCardCarousel } from '@/components/EventCardCarousel';
import { CategoryIcon } from '@/components/CategoryIcon';
import { getCategoryIconColor } from '@/constants/categoryIcons';
import { ArrowLeft } from 'lucide-react-native';
import { EventmapCalendar } from '@/components/icons/EventmapIcons';
import { FacebookIcon, InstagramIcon } from '@/components/icons/BrandIcons';

const { width: SCREEN_WIDTH } = Dimensions.get('window');
const EVENT_CARD_WIDTH = SCREEN_WIDTH * 0.7;

function formatDate(iso: string) {
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: d.getFullYear() !== new Date().getFullYear() ? 'numeric' : undefined,
  });
}

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
  const { id } = useLocalSearchParams<{ id: string }>();
  const insets = useSafeAreaInsets();
  const { user, profile: currentUserProfile } = useAuth();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [isPrivate, setIsPrivate] = useState(false);
  const [upcomingEvents, setUpcomingEvents] = useState<RankedEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const isOwnProfile = user?.id === id;

  const load = useCallback(async () => {
    if (!id) return;
    try {
      if (isOwnProfile) {
        const p = await profilesService.getProfile(id);
        setProfile(p);
        setIsPrivate(false);
        const events = await socialService.getUserUpcomingEvents(id);
        setUpcomingEvents(events);
      } else {
        const result = await profilesService.getPublicProfile(id);
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
      setProfile(null);
      setIsPrivate(false);
      setUpcomingEvents([]);
    } finally {
      setLoading(false);
    }
  }, [id, isOwnProfile]);

  useEffect(() => {
    load();
  }, [load]);

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    load().finally(() => setRefreshing(false));
  }, [load]);

  const socialHandles = (profile?.social_handles as { instagram?: string; facebook?: string } | null) ?? {};

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
        <View style={styles.header}>
          <TouchableOpacity
            style={styles.backBtn}
            onPress={() => router.back()}
            hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
          >
            <ArrowLeft size={24} color={Colors.text.primary} />
          </TouchableOpacity>
        </View>
        <View style={styles.privateState}>
          <View style={styles.privateIconWrap}>
            <Avatar imageUrl={null} name="?" size={80} />
          </View>
          <Text style={styles.privateTitle}>Private Profile</Text>
          <Text style={styles.privateSubtitle}>
            This user has chosen to keep their profile private.
          </Text>
        </View>
      </View>
    );
  }

  if (!profile) {
    return (
      <View style={[styles.container, { paddingTop: insets.top }]}>
        <View style={styles.header}>
          <TouchableOpacity
            style={styles.backBtn}
            onPress={() => router.back()}
            hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
          >
            <ArrowLeft size={24} color={Colors.text.primary} />
          </TouchableOpacity>
        </View>
        <View style={styles.center}>
          <Text style={styles.errorText}>Profile not found</Text>
        </View>
      </View>
    );
  }

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <TouchableOpacity
          style={styles.backBtn}
          onPress={() => router.back()}
          hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
        >
          <ArrowLeft size={24} color={Colors.text.primary} />
        </TouchableOpacity>
      </View>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={Colors.primary} />
        }
      >
        <View style={styles.hero}>
          <Avatar imageUrl={profile.avatar_url} name={profile.name} size={100} />
          <Text style={styles.name}>{profile.name}</Text>
          {profile.bio ? (
            <>
              <Text style={styles.sectionLabel}>About me</Text>
              <Text style={styles.bio}>{profile.bio}</Text>
            </>
          ) : null}
          {profile.hobbies ? (
            <>
              <Text style={[styles.sectionLabel, { marginTop: profile.bio ? Spacing.md : Spacing.sm }]}>
                Hobbies
              </Text>
              <Text style={styles.hobbies}>{profile.hobbies}</Text>
            </>
          ) : null}
        </View>

        {(socialHandles.instagram || socialHandles.facebook) ? (
          <View style={styles.socialsSection}>
            <Text style={styles.socialsLabel}>Connect</Text>
            <View style={styles.socials}>
            {socialHandles.instagram ? (
              <TouchableOpacity
                style={styles.socialBtn}
                onPress={() => Linking.openURL(buildInstagramUrl(socialHandles.instagram!))}
                activeOpacity={0.7}
              >
                <InstagramIcon size={24} />
              </TouchableOpacity>
            ) : null}
            {socialHandles.facebook ? (
              <TouchableOpacity
                style={styles.socialBtn}
                onPress={() => Linking.openURL(buildFacebookUrl(socialHandles.facebook!))}
                activeOpacity={0.7}
              >
                <FacebookIcon size={24} />
              </TouchableOpacity>
            ) : null}
            </View>
          </View>
        ) : null}

        {upcomingEvents.length > 0 ? (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Events I'm Planning to Attend</Text>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={true}
              contentContainerStyle={styles.eventsRow}
            >
              {upcomingEvents.map((event) => (
                <TouchableOpacity
                  key={event.id}
                  style={styles.eventCard}
                  onPress={() => router.push(`/event/${event.id}` as any)}
                  activeOpacity={0.9}
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
                        {formatDate(event.start_datetime)}
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
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
  },
  backBtn: {
    padding: Spacing.xs,
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
    fontFamily: Typography.fontFamilies.bold,
    fontWeight: Typography.weights.bold,
    color: Colors.text.primary,
    marginTop: Spacing.md,
    textAlign: 'center',
  },
  sectionLabel: {
    fontSize: Typography.sizes.sm,
    fontFamily: Typography.fontFamilies.semibold,
    fontWeight: Typography.weights.semibold,
    color: Colors.text.tertiary,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    marginTop: Spacing.sm,
  },
  bio: {
    fontSize: Typography.sizes.md,
    color: Colors.text.secondary,
    marginTop: Spacing.xs,
    textAlign: 'center',
    lineHeight: 22,
  },
  hobbies: {
    fontSize: Typography.sizes.md,
    color: Colors.text.secondary,
    marginTop: Spacing.xs,
    textAlign: 'center',
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
    width: EVENT_CARD_WIDTH,
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
  privateState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: Spacing.xl,
  },
  privateIconWrap: {
    opacity: 0.5,
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
    color: Colors.text.secondary,
    marginTop: Spacing.sm,
    textAlign: 'center',
  },
  errorText: {
    fontSize: Typography.sizes.md,
    color: Colors.text.secondary,
  },
});
