import { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  Image,
  Linking,
  Platform,
} from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useAuth } from '@/contexts/AuthContext';
import { useApp } from '@/contexts/AppContext';
import { eventsService } from '@/services/events';
import { socialService } from '@/services/social';
import { EventDetails } from '@/types/database';
import { Colors, Spacing, Typography, BorderRadius, Shadows } from '@/constants/theme';
import {
  ArrowLeft,
  Calendar,
  MapPin,
  Building2,
  ExternalLink,
  Heart,
  Users,
  Pencil,
  Trash2,
} from 'lucide-react-native';

export default function EventDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { user } = useAuth();
  const { userBusiness } = useApp();
  const [details, setDetails] = useState<EventDetails | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const isOwner = userBusiness && details?.event.business_id === userBusiness.id;

  useEffect(() => {
    if (!id) return;
    const load = async () => {
      try {
        const data = await eventsService.getEventDetails(id);
        setDetails(data);
      } catch {
        setDetails(null);
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [id]);

  const handleRsvp = async (status: 'going' | 'interested') => {
    if (!user || !id) return;
    setSaving(true);
    try {
      await socialService.createOrUpdateRsvp(id, status);
      setDetails((d) =>
        d
          ? {
              ...d,
              user_rsvp: status,
              rsvp_count:
                d.user_rsvp === status
                  ? d.rsvp_count
                  : d.user_rsvp
                    ? d.rsvp_count
                    : d.rsvp_count + 1,
            }
          : null
      );
    } catch {
      Alert.alert('Error', 'Failed to update RSVP');
    } finally {
      setSaving(false);
    }
  };

  const handleRemoveRsvp = async () => {
    if (!user || !id) return;
    setSaving(true);
    try {
      await socialService.deleteRsvp(id);
      setDetails((d) =>
        d ? { ...d, user_rsvp: null, rsvp_count: Math.max(0, d.rsvp_count - 1) } : null
      );
    } catch {
      Alert.alert('Error', 'Failed to remove RSVP');
    } finally {
      setSaving(false);
    }
  };

  const handleSave = async () => {
    if (!user || !id) return;
    setSaving(true);
    try {
      if (details?.user_saved) {
        await socialService.unsaveEvent(id);
        setDetails((d) =>
          d ? { ...d, user_saved: false, save_count: Math.max(0, d.save_count - 1) } : null
        );
      } else {
        await socialService.saveEvent(id);
        setDetails((d) =>
          d ? { ...d, user_saved: true, save_count: d.save_count + 1 } : null
        );
      }
    } catch {
      Alert.alert('Error', 'Failed to update save');
    } finally {
      setSaving(false);
    }
  };

  const handleFollow = async () => {
    if (!user || !details) return;
    setSaving(true);
    try {
      if (details.user_following_business) {
        await socialService.unfollowBusiness(details.business.id);
        setDetails((d) => (d ? { ...d, user_following_business: false } : null));
      } else {
        await socialService.followBusiness(details.business.id);
        setDetails((d) => (d ? { ...d, user_following_business: true } : null));
      }
    } catch {
      Alert.alert('Error', 'Failed to update follow');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = () => {
    if (!id) return;
    Alert.alert('Delete Event', 'Are you sure? This cannot be undone.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          try {
            await eventsService.deleteEvent(id);
            router.back();
          } catch {
            Alert.alert('Error', 'Failed to delete event');
          }
        },
      },
    ]);
  };

  const formatDate = (dateString: string) =>
    new Date(dateString).toLocaleDateString('en-US', {
      weekday: 'long',
      month: 'long',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    });

  if (loading) {
    return (
      <View style={styles.centerContainer}>
        <ActivityIndicator size="large" color={Colors.primary} />
      </View>
    );
  }

  if (!details) {
    return (
      <View style={styles.container}>
        <View style={styles.header}>
          <TouchableOpacity style={styles.backButton} onPress={() => router.back()}>
            <ArrowLeft size={24} color={Colors.text.primary} />
          </TouchableOpacity>
        </View>
        <View style={styles.centerContainer}>
          <Text style={styles.errorText}>Event not found</Text>
        </View>
      </View>
    );
  }

  const { event, business, category, links } = details;

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity style={styles.backButton} onPress={() => router.back()}>
          <ArrowLeft size={24} color={Colors.text.primary} />
        </TouchableOpacity>
        <Text style={styles.headerTitle} numberOfLines={1}>
          {event.title}
        </Text>
        <View style={styles.headerRight} />
      </View>

      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {event.cover_image_url ? (
          <Image
            source={{ uri: event.cover_image_url }}
            style={styles.coverImage}
            resizeMode="cover"
          />
        ) : (
          <View style={styles.coverPlaceholder}>
            <Calendar size={48} color={Colors.text.tertiary} />
          </View>
        )}

        <View style={styles.content}>
          <Text style={styles.title}>{event.title}</Text>
          <View style={styles.categoryBadge}>
            <Text style={styles.categoryText}>{category.label}</Text>
          </View>

          <View style={styles.businessRow}>
            <Building2 size={18} color={Colors.text.secondary} />
            <Text style={styles.businessName}>{business.name}</Text>
            {user && !isOwner && (
              <TouchableOpacity
                style={[
                  styles.followButton,
                  details.user_following_business && styles.followButtonActive,
                ]}
                onPress={handleFollow}
                disabled={saving}
              >
                <Text
                  style={[
                    styles.followButtonText,
                    details.user_following_business && styles.followButtonTextActive,
                  ]}
                >
                  {details.user_following_business ? 'Following' : 'Follow'}
                </Text>
              </TouchableOpacity>
            )}
          </View>

          <View style={styles.metaRow}>
            <Calendar size={18} color={Colors.text.secondary} />
            <Text style={styles.metaText}>
              {formatDate(event.start_datetime)}
              {event.end_datetime && ` – ${formatDate(event.end_datetime)}`}
            </Text>
          </View>

          {event.address && (
            <View style={styles.metaRow}>
              <MapPin size={18} color={Colors.text.secondary} />
              <Text style={styles.metaText}>{event.address}</Text>
            </View>
          )}

          {event.description && (
            <Text style={styles.description}>{event.description}</Text>
          )}

          {links.length > 0 && (
            <View style={styles.linksSection}>
              <Text style={styles.sectionTitle}>Links</Text>
              {links.map((link) => (
                <TouchableOpacity
                  key={link.id}
                  style={styles.linkRow}
                  onPress={() => Linking.openURL(link.url)}
                >
                  <ExternalLink size={18} color={Colors.primary} />
                  <Text style={styles.linkText} numberOfLines={1}>
                    {link.label || link.url}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          )}

          {user && !isOwner && (
            <View style={styles.actionsSection}>
              <Text style={styles.sectionTitle}>Actions</Text>
              <View style={styles.actionRow}>
                {details.user_rsvp ? (
                  <>
                    <TouchableOpacity
                      style={[
                        styles.actionChip,
                        details.user_rsvp === 'going' && styles.actionChipActive,
                      ]}
                      onPress={() => handleRsvp('going')}
                      disabled={saving}
                    >
                      <Text
                        style={[
                          styles.actionChipText,
                          details.user_rsvp === 'going' && styles.actionChipTextActive,
                        ]}
                      >
                        Going
                      </Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={[
                        styles.actionChip,
                        details.user_rsvp === 'interested' && styles.actionChipActive,
                      ]}
                      onPress={() => handleRsvp('interested')}
                      disabled={saving}
                    >
                      <Text
                        style={[
                          styles.actionChipText,
                          details.user_rsvp === 'interested' && styles.actionChipTextActive,
                        ]}
                      >
                        Interested
                      </Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={styles.actionChipOutlined}
                      onPress={handleRemoveRsvp}
                      disabled={saving}
                    >
                      <Text style={styles.actionChipOutlinedText}>Remove</Text>
                    </TouchableOpacity>
                  </>
                ) : (
                  <>
                    <TouchableOpacity
                      style={styles.actionChip}
                      onPress={() => handleRsvp('going')}
                      disabled={saving}
                    >
                      <Text style={styles.actionChipText}>Going</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={styles.actionChip}
                      onPress={() => handleRsvp('interested')}
                      disabled={saving}
                    >
                      <Text style={styles.actionChipText}>Interested</Text>
                    </TouchableOpacity>
                  </>
                )}
              </View>
              <TouchableOpacity
                style={styles.saveButton}
                onPress={handleSave}
                disabled={saving}
              >
                <Heart
                  size={20}
                  color={details.user_saved ? Colors.error : Colors.text.secondary}
                  fill={details.user_saved ? Colors.error : 'transparent'}
                />
                <Text
                  style={[
                    styles.saveButtonText,
                    details.user_saved && styles.saveButtonTextActive,
                  ]}
                >
                  {details.user_saved ? 'Saved' : 'Save'}
                </Text>
              </TouchableOpacity>
            </View>
          )}

          {isOwner && (
            <View style={styles.ownerActions}>
              <TouchableOpacity
                style={styles.editButton}
                onPress={() => router.push(`/business/edit-event/${event.id}` as any)}
              >
                <Pencil size={18} color={Colors.primary} />
                <Text style={styles.editButtonText}>Edit Event</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.deleteButton}
                onPress={handleDelete}
              >
                <Trash2 size={18} color={Colors.error} />
                <Text style={styles.deleteButtonText}>Delete Event</Text>
              </TouchableOpacity>
            </View>
          )}

          <View style={styles.statsRow}>
            <View style={styles.stat}>
              <Users size={16} color={Colors.text.tertiary} />
              <Text style={styles.statText}>{details.rsvp_count} going</Text>
            </View>
            <View style={styles.stat}>
              <Heart size={16} color={Colors.text.tertiary} />
              <Text style={styles.statText}>{details.save_count} saved</Text>
            </View>
          </View>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background.primary,
  },
  centerContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: Spacing.md,
    paddingTop: Platform.OS === 'ios' ? Spacing.xxl + 24 : Spacing.lg,
    paddingBottom: Spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border.light,
  },
  backButton: {
    padding: Spacing.sm,
    marginRight: Spacing.sm,
  },
  headerTitle: {
    flex: 1,
    fontSize: Typography.sizes.lg,
    fontWeight: Typography.weights.semibold,
    color: Colors.text.primary,
  },
  headerRight: {
    width: 40,
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    paddingBottom: Spacing.xxl,
  },
  coverImage: {
    width: '100%',
    height: 200,
    backgroundColor: Colors.background.secondary,
  },
  coverPlaceholder: {
    width: '100%',
    height: 160,
    backgroundColor: Colors.background.secondary,
    justifyContent: 'center',
    alignItems: 'center',
  },
  content: {
    padding: Spacing.xl,
  },
  title: {
    fontSize: Typography.sizes.xxl,
    fontWeight: Typography.weights.bold,
    color: Colors.text.primary,
    marginBottom: Spacing.sm,
  },
  categoryBadge: {
    alignSelf: 'flex-start',
    backgroundColor: Colors.background.secondary,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.xs,
    borderRadius: BorderRadius.round,
    marginBottom: Spacing.md,
  },
  categoryText: {
    fontSize: Typography.sizes.sm,
    color: Colors.text.secondary,
    fontWeight: Typography.weights.medium,
  },
  businessRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    marginBottom: Spacing.md,
  },
  businessName: {
    flex: 1,
    fontSize: Typography.sizes.md,
    color: Colors.text.secondary,
  },
  followButton: {
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.xs,
    borderRadius: BorderRadius.round,
    borderWidth: 1,
    borderColor: Colors.primary,
  },
  followButtonActive: {
    backgroundColor: Colors.primary,
  },
  followButtonText: {
    fontSize: Typography.sizes.sm,
    color: Colors.primary,
    fontWeight: Typography.weights.semibold,
  },
  followButtonTextActive: {
    color: Colors.text.inverse,
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: Spacing.sm,
    marginBottom: Spacing.sm,
  },
  metaText: {
    flex: 1,
    fontSize: Typography.sizes.md,
    color: Colors.text.primary,
  },
  description: {
    fontSize: Typography.sizes.md,
    color: Colors.text.primary,
    lineHeight: 24,
    marginTop: Spacing.md,
    marginBottom: Spacing.lg,
  },
  linksSection: {
    marginBottom: Spacing.lg,
  },
  sectionTitle: {
    fontSize: Typography.sizes.sm,
    fontWeight: Typography.weights.semibold,
    color: Colors.text.secondary,
    textTransform: 'uppercase',
    marginBottom: Spacing.sm,
  },
  linkRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    paddingVertical: Spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border.light,
  },
  linkText: {
    flex: 1,
    fontSize: Typography.sizes.md,
    color: Colors.primary,
  },
  actionsSection: {
    marginBottom: Spacing.lg,
  },
  actionRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.sm,
    marginBottom: Spacing.md,
  },
  actionChip: {
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    borderRadius: BorderRadius.round,
    backgroundColor: Colors.background.secondary,
  },
  actionChipActive: {
    backgroundColor: Colors.primary,
  },
  actionChipText: {
    fontSize: Typography.sizes.sm,
    color: Colors.text.primary,
    fontWeight: Typography.weights.medium,
  },
  actionChipTextActive: {
    color: Colors.text.inverse,
  },
  actionChipOutlined: {
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    borderRadius: BorderRadius.round,
    borderWidth: 1,
    borderColor: Colors.border.medium,
  },
  actionChipOutlinedText: {
    fontSize: Typography.sizes.sm,
    color: Colors.text.secondary,
  },
  saveButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    paddingVertical: Spacing.sm,
  },
  saveButtonText: {
    fontSize: Typography.sizes.md,
    color: Colors.text.secondary,
  },
  saveButtonTextActive: {
    color: Colors.error,
    fontWeight: Typography.weights.semibold,
  },
  ownerActions: {
    flexDirection: 'row',
    gap: Spacing.md,
    marginBottom: Spacing.lg,
  },
  editButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.sm,
    paddingVertical: Spacing.md,
    borderRadius: BorderRadius.md,
    borderWidth: 1,
    borderColor: Colors.primary,
  },
  editButtonText: {
    fontSize: Typography.sizes.md,
    color: Colors.primary,
    fontWeight: Typography.weights.semibold,
  },
  deleteButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.sm,
    paddingVertical: Spacing.md,
    borderRadius: BorderRadius.md,
    borderWidth: 1,
    borderColor: Colors.error,
  },
  deleteButtonText: {
    fontSize: Typography.sizes.md,
    color: Colors.error,
    fontWeight: Typography.weights.semibold,
  },
  statsRow: {
    flexDirection: 'row',
    gap: Spacing.lg,
  },
  stat: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs,
  },
  statText: {
    fontSize: Typography.sizes.sm,
    color: Colors.text.tertiary,
  },
  errorText: {
    fontSize: Typography.sizes.md,
    color: Colors.error,
  },
});
