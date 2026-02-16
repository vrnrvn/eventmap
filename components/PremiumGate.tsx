// components/PremiumGate.tsx

import { ReactNode } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Platform,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { router } from 'expo-router';
import { Lock, Crown, ChevronRight } from 'lucide-react-native';
import { usePremium } from '@/contexts/PremiumContext';
import { Colors, Typography } from '@/constants/theme';

const Palette = {
  gradientStart: Colors.primary,
  gradientEnd: Colors.accent,
  cardBg: Colors.background.primary,
  surfaceMuted: Colors.background.primary,
  accentSoft: 'rgba(196, 92, 62, 0.12)',
  separator: Colors.border.light,
  premiumGold: Colors.accent,
  premiumGoldSoft: 'rgba(232, 168, 56, 0.12)',
};

type FeatureKey =
  | 'analytics'
  | 'highlighted_markers'
  | 'recurring_events'
  | 'multi_photos';

interface PremiumGateProps {
  feature: FeatureKey;
  children: ReactNode;
  fallback?: ReactNode;
  inline?: boolean; // compact inline lock vs. full card
  requiredPlan?: string; // e.g. "Starter" for messaging
}

const FEATURE_LABELS: Record<FeatureKey, string> = {
  analytics: 'Event Analytics',
  highlighted_markers: 'Highlighted Markers',
  recurring_events: 'Recurring Events',
  multi_photos: 'Multiple Photos',
};

export function PremiumGate({
  feature,
  children,
  fallback,
  inline = false,
  requiredPlan,
}: PremiumGateProps) {
  const { canUse } = usePremium();

  if (canUse(feature)) {
    return <>{children}</>;
  }

  if (fallback) {
    return <>{fallback}</>;
  }

  if (inline) {
    return <InlineLock feature={feature} requiredPlan={requiredPlan} />;
  }

  return <FullLock feature={feature} requiredPlan={requiredPlan} />;
}

function InlineLock({
  feature,
  requiredPlan,
}: {
  feature: FeatureKey;
  requiredPlan?: string;
}) {
  return (
    <TouchableOpacity
      style={styles.inlineLock}
      onPress={() => router.push('/premium/plans' as never)}
      activeOpacity={0.7}
    >
      <View style={styles.inlineLockIcon}>
        <Lock size={12} color={Palette.premiumGold} />
      </View>
      <Text style={styles.inlineLockText}>
        {FEATURE_LABELS[feature]}
      </Text>
      <View style={styles.inlineUpgradePill}>
        <Text style={styles.inlineUpgradeText}>
          {requiredPlan ?? 'Upgrade'}
        </Text>
      </View>
    </TouchableOpacity>
  );
}

function FullLock({
  feature,
  requiredPlan,
}: {
  feature: FeatureKey;
  requiredPlan?: string;
}) {
  return (
    <View style={styles.fullLockCard}>
      <View style={styles.fullLockIconWrap}>
        <Crown size={24} color={Palette.premiumGold} />
      </View>
      <Text style={styles.fullLockTitle}>
        {FEATURE_LABELS[feature]}
      </Text>
      <Text style={styles.fullLockDesc}>
        Upgrade to {requiredPlan ?? 'a premium plan'} to unlock this feature
      </Text>
      <TouchableOpacity
        style={styles.fullLockCta}
        onPress={() => router.push('/premium/plans' as never)}
        activeOpacity={0.85}
      >
        <LinearGradient
          colors={[Palette.gradientStart, Palette.gradientEnd]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 0 }}
          style={styles.fullLockCtaGradient}
        >
          <Text style={styles.fullLockCtaText}>View Plans</Text>
          <ChevronRight size={16} color="#FFFFFF" />
        </LinearGradient>
      </TouchableOpacity>
    </View>
  );
}

/* ── Upgrade banner (for embedding in other screens) ── */
export function UpgradeBanner({
  message,
  compact = false,
}: {
  message?: string;
  compact?: boolean;
}) {
  const { isPremium, currentPlan } = usePremium();

  if (isPremium) return null;

  if (compact) {
    return (
      <TouchableOpacity
        style={styles.compactBanner}
        onPress={() => router.push('/premium/plans' as never)}
        activeOpacity={0.8}
      >
        <Crown size={16} color={Palette.premiumGold} />
        <Text style={styles.compactBannerText}>
          {message ?? 'Upgrade for more features'}
        </Text>
        <ChevronRight size={16} color={Palette.gradientStart} />
      </TouchableOpacity>
    );
  }

  return (
    <TouchableOpacity
      style={styles.bannerWrap}
      onPress={() => router.push('/premium/plans' as never)}
      activeOpacity={0.85}
    >
      <LinearGradient
        colors={[Palette.gradientStart, Palette.gradientEnd]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 0 }}
        style={styles.bannerGradient}
      >
        <View style={styles.bannerIconWrap}>
          <Crown size={20} color={Palette.gradientStart} />
        </View>
        <View style={styles.bannerContent}>
          <Text style={styles.bannerTitle}>
            Upgrade to {currentPlan?.slug === 'free' ? 'Starter' : 'Pro'}
          </Text>
          <Text style={styles.bannerSubtitle}>
            {message ?? 'Unlock analytics, boosted events & more'}
          </Text>
        </View>
        <ChevronRight size={18} color="rgba(255,255,255,0.6)" />
      </LinearGradient>
    </TouchableOpacity>
  );
}

/* ── Styles ── */
const styles = StyleSheet.create({
  /* Inline lock */
  inlineLock: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: Palette.premiumGoldSoft,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(245,158,11,0.2)',
  },
  inlineLockIcon: {
    width: 24,
    height: 24,
    borderRadius: 7,
    backgroundColor: 'rgba(245,158,11,0.15)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  inlineLockText: {
    flex: 1,
    fontSize: Typography.sizes.sm,
    fontFamily: Typography.fontFamilies.medium,
    fontWeight: Typography.weights.medium,
    color: Colors.text.primary,
  },
  inlineUpgradePill: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 8,
    backgroundColor: Palette.gradientStart,
  },
  inlineUpgradeText: {
    fontSize: Typography.sizes.xs,
    fontFamily: Typography.fontFamilies.semibold,
    fontWeight: Typography.weights.semibold,
    color: '#FFFFFF',
  },

  /* Full lock */
  fullLockCard: {
    alignItems: 'center',
    backgroundColor: Palette.cardBg,
    borderRadius: 20,
    padding: 28,
    ...Platform.select({
      ios: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.06,
        shadowRadius: 10,
      },
      android: { elevation: 3 },
    }),
  },
  fullLockIconWrap: {
    width: 56,
    height: 56,
    borderRadius: 18,
    backgroundColor: Palette.premiumGoldSoft,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
  },
  fullLockTitle: {
    fontSize: Typography.sizes.lg,
    fontFamily: Typography.fontFamilies.bold,
    fontWeight: Typography.weights.bold,
    color: Colors.text.primary,
    marginBottom: 6,
  },
  fullLockDesc: {
    fontSize: Typography.sizes.sm,
    fontFamily: Typography.fontFamily,
    color: Colors.text.tertiary,
    textAlign: 'center',
    lineHeight: 20,
    marginBottom: 20,
  },
  fullLockCta: {
    width: '100%',
    borderRadius: 14,
    overflow: 'hidden',
  },
  fullLockCtaGradient: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 14,
  },
  fullLockCtaText: {
    fontSize: Typography.sizes.md,
    fontFamily: Typography.fontFamilies.bold,
    fontWeight: Typography.weights.bold,
    color: '#FFFFFF',
  },

  /* Compact banner */
  compactBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: Palette.premiumGoldSoft,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: 'rgba(245,158,11,0.2)',
  },
  compactBannerText: {
    flex: 1,
    fontSize: Typography.sizes.sm,
    fontFamily: Typography.fontFamilies.medium,
    fontWeight: Typography.weights.medium,
    color: Colors.text.primary,
  },

  /* Full banner */
  bannerWrap: {
    borderRadius: 18,
    overflow: 'hidden',
    ...Platform.select({
      ios: {
        shadowColor: Palette.gradientStart,
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.2,
        shadowRadius: 12,
      },
      android: { elevation: 6 },
    }),
  },
  bannerGradient: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 16,
    paddingHorizontal: 18,
    gap: 14,
  },
  bannerIconWrap: {
    width: 42,
    height: 42,
    borderRadius: 12,
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  bannerContent: {
    flex: 1,
  },
  bannerTitle: {
    fontSize: Typography.sizes.md,
    fontFamily: Typography.fontFamilies.bold,
    fontWeight: Typography.weights.bold,
    color: '#FFFFFF',
  },
  bannerSubtitle: {
    fontSize: Typography.sizes.xs,
    fontFamily: Typography.fontFamily,
    color: 'rgba(255,255,255,0.75)',
    marginTop: 2,
  },
});