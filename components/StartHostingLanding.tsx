import { View, Text, StyleSheet, ScrollView, Image } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Button } from '@/components/ui/Button';
import { Colors, Shadows, Typography, BorderRadius } from '@/constants/theme';
import {
  CalendarPlus,
  ChevronRight,
  MessageCircle,
  Users,
  BadgeCheck,
} from '@/components/icons.generated';

/**
 * What the Create tab shows to someone without a host profile
 * (HOST_ONBOARDING_PLAN.md Stage 1). The tab is always visible so hosting can
 * be discovered; this screen explains it and hands off to host setup.
 */
export function StartHostingLanding() {
  const insets = useSafeAreaInsets();
  return (
    <ScrollView
      style={styles.root}
      contentContainerStyle={[
        styles.content,
        { paddingTop: insets.top + 32, paddingBottom: insets.bottom + 32 },
      ]}
      showsVerticalScrollIndicator={false}
    >
      <View style={styles.logoWrap} accessible={false} importantForAccessibility="no-hide-descendants">
        <Image
          source={require('@/assets/images/EMlogo.png')}
          style={styles.logo}
          resizeMode="contain"
        />
      </View>
      <Text style={styles.title} accessibilityRole="header">
        Start hosting
      </Text>
      <Text style={styles.subtitle}>
        Venues, clubs and individuals can all host on EventMap. Post an event and people nearby find
        it on the map.
      </Text>

      <View style={styles.card}>
        <Benefit
          icon={<CalendarPlus size={20} color={Colors.primary} />}
          title="Put your events on the map"
          text="One-off or recurring. Shown to people nearby who like that category."
        />
        <Benefit
          icon={<Users size={20} color={Colors.primary} />}
          title="Manage who's coming"
          text="Capacity, waitlists, approvals and announcements, all in one place."
        />
        <Benefit
          icon={<MessageCircle size={20} color={Colors.primary} />}
          title="Build a community"
          text="Event chat and followers who hear about your next event."
        />
      </View>

      <Text style={styles.stepsTitle} accessibilityRole="header">
        How it works
      </Text>
      <View style={styles.card}>
        <Step n={1} text="Set up your host profile: name, category and where you host." />
        <Step n={2} text="Create your first event. It takes a couple of minutes." />
        <Step n={3} text="Publish and share it. Manage everything from My Events." />
      </View>

      <Button
        label="Set Up Hosting"
        onPress={() => router.push('/business/onboarding' as never)}
        variant="primary"
        gradient
        size="lg"
        fullWidth
        icon={<ChevronRight size={20} color={Colors.white} />}
        style={styles.cta}
      />
      <View style={styles.footnote}>
        <BadgeCheck size={14} color={Colors.text.tertiary} />
        <Text style={styles.footnoteText}>
          Free to start: 2 events a month. Hosting doesn&apos;t change how you attend events.
        </Text>
      </View>
    </ScrollView>
  );
}

function Benefit({ icon, title, text }: { icon: React.ReactNode; title: string; text: string }) {
  return (
    <View style={styles.row}>
      <View style={styles.iconWrap}>{icon}</View>
      <View style={styles.rowText}>
        <Text style={styles.rowTitle}>{title}</Text>
        <Text style={styles.rowBody}>{text}</Text>
      </View>
    </View>
  );
}

function Step({ n, text }: { n: number; text: string }) {
  return (
    <View style={styles.row} accessible accessibilityLabel={`Step ${n}: ${text}`}>
      <View style={styles.stepBadge}>
        <Text style={styles.stepBadgeText}>{n}</Text>
      </View>
      <Text style={[styles.rowBody, styles.rowText]}>{text}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: Colors.background.primary },
  content: { paddingHorizontal: 20 },
  logoWrap: {
    alignSelf: 'center',
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: Colors.primarySoft,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
  },
  logo: { width: 44, height: 44 },
  title: {
    textAlign: 'center',
    fontSize: Typography.sizes.xxl,
    fontFamily: Typography.displayFontFamilies.bold,
    fontWeight: Typography.weights.bold,
    color: Colors.text.primary,
  },
  subtitle: {
    textAlign: 'center',
    marginTop: 8,
    marginBottom: 20,
    fontSize: Typography.sizes.md,
    fontFamily: Typography.fontFamily,
    color: Colors.text.secondary,
    lineHeight: 22,
  },
  card: {
    backgroundColor: Colors.surface,
    borderRadius: BorderRadius.lg,
    padding: 16,
    gap: 14,
    ...Shadows.sm,
  },
  row: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  iconWrap: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: Colors.primarySoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowText: { flex: 1 },
  rowTitle: {
    fontSize: Typography.sizes.md,
    fontFamily: Typography.labelFontFamilies.medium,
    color: Colors.text.primary,
    marginBottom: 2,
  },
  rowBody: {
    fontSize: Typography.sizes.sm,
    fontFamily: Typography.fontFamily,
    color: Colors.text.secondary,
    lineHeight: 20,
  },
  stepsTitle: {
    marginTop: 24,
    marginBottom: 10,
    fontSize: Typography.sizes.md,
    fontFamily: Typography.labelFontFamilies.medium,
    color: Colors.text.primary,
  },
  stepBadge: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: Colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepBadgeText: {
    color: Colors.white,
    fontSize: Typography.sizes.xs,
    fontFamily: Typography.labelFontFamilies.medium,
  },
  cta: { marginTop: 24 },
  footnote: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    marginTop: 12,
  },
  footnoteText: {
    flexShrink: 1,
    fontSize: Typography.sizes.xs,
    fontFamily: Typography.fontFamily,
    color: Colors.text.tertiary,
    textAlign: 'center',
  },
});
