import { useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View, ActivityIndicator } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Clipboard from 'expo-clipboard';
import {
  X,
  Share2,
  BellRing,
  CalendarPlus,
  Settings as SettingsIcon,
  ChevronRight,
  Sparkles,
} from '@/components/icons.generated';
import { Colors, Spacing, Typography, BorderRadius, Shadows } from '@/constants/theme';
import { Button } from '@/components/ui/Button';
import { shareEventLink, shareEventIcs } from '@/utils/eventShare';
import { getEventWebUrl } from '@/utils/eventIcs';
import { businessesService } from '@/services/businesses';
import { notify } from '@/utils/notify';
import { markChecklistSignal } from '@/utils/hostChecklistStore';

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

export type PublishedEventInfo = {
  id: string;
  title: string;
  startIso: string;
  endIso: string;
  address: string | null;
  description: string;
  timezone: string | null;
};

/**
 * What happens right after publishing (HOST_ONBOARDING_PLAN.md §11.2 step 4).
 * Replaces the bare toast: share the link, tell followers, put it in your own
 * calendar, or open the management hub.
 *
 * Sits on top of the event page, so dismissing it leaves the host exactly
 * where the old flow landed them.
 */
export function EventPublishedSheet({
  visible,
  event,
  followerCount,
  isFirstEvent,
  eventsLeftThisMonth,
  onClose,
  onOpenManage,
  businessId,
}: {
  visible: boolean;
  event: PublishedEventInfo | null;
  /** null = not loaded; 0 hides the notify action and explains followers. */
  followerCount: number | null;
  isFirstEvent: boolean;
  /** Remaining allowance after this event, or null when unknown/unlimited. */
  eventsLeftThisMonth: number | null;
  onClose: () => void;
  onOpenManage: () => void;
  /** Host profile id, to tick "Share an event" on the checklist. */
  businessId?: string | null;
}) {
  const insets = useSafeAreaInsets();
  const [busy, setBusy] = useState<'share' | 'notify' | 'calendar' | null>(null);
  const [notified, setNotified] = useState(false);
  if (!event) return null;

  const handleShare = async () => {
    setBusy('share');
    try {
      const outcome = await shareEventLink({
        title: event.title,
        url: getEventWebUrl(event.id),
        copyToClipboard: (text) => Clipboard.setStringAsync(text).then(() => {}),
      });
      if (outcome !== 'dismissed') markChecklistSignal(businessId, 'sharedEvent');
      if (outcome === 'copied') notify.success('Link copied to the clipboard.');
    } catch {
      notify.error('Could not share the link.');
    } finally {
      setBusy(null);
    }
  };

  const handleNotify = async () => {
    setBusy('notify');
    try {
      const sent = await businessesService.notifyFollowersAboutEvent(event.id);
      setNotified(true);
      notify.success(sent > 0 ? `${plural(sent, 'follower')} notified.` : 'Followers notified.');
    } catch {
      // The RPC is missing until 20261030112000 is applied.
      notify.error('Notifying followers is not available yet. Try from My Events later.');
    } finally {
      setBusy(null);
    }
  };

  const handleCalendar = async () => {
    setBusy('calendar');
    try {
      await shareEventIcs({
        id: event.id,
        title: event.title,
        startIso: event.startIso,
        endIso: event.endIso,
        address: event.address,
        description: event.description,
        timezone: event.timezone ?? undefined,
      });
    } catch {
      notify.error('Could not create the calendar file.');
    } finally {
      setBusy(null);
    }
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      {/* Tap-outside-to-close for pointer users; screen readers and keyboards
          use the Close button, so the backdrop is hidden from them. */}
      <Pressable
        style={styles.backdrop}
        onPress={onClose}
        accessible={false}
        focusable={false}
        importantForAccessibility="no-hide-descendants"
        aria-hidden
      />
      <View
        style={[styles.sheet, { paddingBottom: Math.max(insets.bottom, Spacing.md) }]}
        accessibilityViewIsModal
        onAccessibilityEscape={onClose}
      >
        <View style={styles.header}>
          <View style={styles.headerText}>
            <Text style={styles.title} accessibilityRole="header">
              {isFirstEvent ? 'Your first event is live' : 'Event published'}
            </Text>
            <Text style={styles.subtitle} numberOfLines={2}>
              {event.title}
            </Text>
          </View>
          <Pressable onPress={onClose} style={styles.closeBtn} accessibilityRole="button" accessibilityLabel="Close">
            <X size={20} color={Colors.text.secondary} />
          </Pressable>
        </View>

        <ScrollView style={styles.scroll} contentContainerStyle={styles.body} showsVerticalScrollIndicator={false}>
          <Action
            icon={<Share2 size={18} color={Colors.primary} />}
            title="Share the link"
            description="Send it to the people you want there."
            busy={busy === 'share'}
            onPress={handleShare}
          />
          {followerCount === null || followerCount > 0 ? (
            <Action
              icon={<BellRing size={18} color={Colors.primary} />}
              title={notified ? 'Followers notified' : 'Notify your followers'}
              description={
                followerCount && followerCount > 0
                  ? `${plural(followerCount, 'follower')} ${followerCount === 1 ? 'gets' : 'get'} an in-app notification.`
                  : 'Followers get an in-app notification.'
              }
              busy={busy === 'notify'}
              disabled={notified}
              onPress={handleNotify}
            />
          ) : (
            <View style={styles.note}>
              <BellRing size={16} color={Colors.text.tertiary} />
              <Text style={styles.noteText}>
                No followers yet. People who follow you from your host page get told about your next event
                automatically.
              </Text>
            </View>
          )}
          <Action
            icon={<CalendarPlus size={18} color={Colors.primary} />}
            title="Add to my calendar"
            description="So you don't miss the event you're hosting."
            busy={busy === 'calendar'}
            onPress={handleCalendar}
          />
          <Action
            icon={<SettingsIcon size={18} color={Colors.primary} />}
            title="Open Manage event"
            description="Attendees, capacity, announcements and chat."
            onPress={onOpenManage}
          />

          {isFirstEvent ? (
            <View style={styles.firstNote}>
              <Sparkles size={16} color={Colors.primary} />
              <Text style={styles.firstNoteText}>
                From here on you&apos;ll get a notification for each RSVP, and everything about the event lives in
                Manage event.
                {eventsLeftThisMonth != null
                  ? eventsLeftThisMonth === 0
                    ? ' That was your last event this month.'
                    : ` You can publish ${plural(eventsLeftThisMonth, 'more event')} this month.`
                  : ''}
              </Text>
            </View>
          ) : null}
        </ScrollView>

        <Button label="View Event" onPress={onClose} size="lg" fullWidth gradient style={styles.cta} />
      </View>
    </Modal>
  );
}

function Action({
  icon,
  title,
  description,
  onPress,
  busy,
  disabled,
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
  onPress: () => void;
  busy?: boolean;
  disabled?: boolean;
}) {
  return (
    <Pressable
      style={[styles.action, disabled && styles.actionDisabled]}
      onPress={onPress}
      disabled={busy || disabled}
      accessibilityRole="button"
      accessibilityLabel={`${title}. ${description}`}
      accessibilityState={{ disabled: !!disabled || !!busy, busy: !!busy }}
    >
      <View style={styles.actionIcon}>{icon}</View>
      <View style={styles.actionText}>
        <Text style={styles.actionTitle}>{title}</Text>
        <Text style={styles.actionDesc}>{description}</Text>
      </View>
      {busy ? <ActivityIndicator size="small" color={Colors.primary} /> : <ChevronRight size={18} color={Colors.text.tertiary} />}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  // 44 px box: hitSlop does not enlarge the target on web.
  closeBtn: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center', marginRight: -10 },
  scroll: { flexShrink: 1 },
  backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.4)' },
  sheet: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    // Phones fill the width; on tablets / desktop web the sheet stays a
    // readable column instead of a 1,200 px wide button.
    width: '100%',
    maxWidth: 560,
    marginHorizontal: 'auto',
    maxHeight: '90%',
    backgroundColor: Colors.background.primary,
    borderTopLeftRadius: BorderRadius.xl,
    borderTopRightRadius: BorderRadius.xl,
    paddingHorizontal: Spacing.md,
    paddingTop: Spacing.md,
    ...Shadows.md,
  },
  header: { flexDirection: 'row', alignItems: 'flex-start', gap: 12, marginBottom: 12 },
  headerText: { flex: 1 },
  title: {
    fontSize: Typography.sizes.lg,
    fontFamily: Typography.displayFontFamilies.bold,
    fontWeight: Typography.weights.bold,
    color: Colors.text.primary,
  },
  subtitle: { marginTop: 2, fontSize: Typography.sizes.sm, fontFamily: Typography.fontFamily, color: Colors.text.secondary },
  body: { gap: 8, paddingBottom: 12 },
  action: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    minHeight: 56,
    paddingHorizontal: 14,
    backgroundColor: Colors.surface,
    borderRadius: BorderRadius.lg,
  },
  actionDisabled: { opacity: 0.6 },
  actionIcon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: Colors.primarySoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  actionText: { flex: 1, paddingVertical: 10 },
  actionTitle: { fontSize: Typography.sizes.md, fontFamily: Typography.labelFontFamilies.medium, color: Colors.text.primary },
  actionDesc: { marginTop: 2, fontSize: Typography.sizes.sm, fontFamily: Typography.fontFamily, color: Colors.text.secondary },
  note: { flexDirection: 'row', gap: 10, padding: 14, borderRadius: BorderRadius.lg, backgroundColor: Colors.surface },
  noteText: { flex: 1, fontSize: Typography.sizes.sm, fontFamily: Typography.fontFamily, color: Colors.text.tertiary, lineHeight: 19 },
  firstNote: { flexDirection: 'row', gap: 10, padding: 14, borderRadius: BorderRadius.lg, backgroundColor: Colors.primarySoft },
  firstNoteText: { flex: 1, fontSize: Typography.sizes.sm, fontFamily: Typography.fontFamily, color: Colors.text.secondary, lineHeight: 19 },
  cta: { marginTop: 8, flexShrink: 0 },
});
