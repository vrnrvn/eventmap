// components/PremiumDebugPanel.tsx

import { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Platform,
} from 'react-native';
import { usePremium } from '@/contexts/PremiumContext';
import { premiumTestHelpers } from '@/services/premium';
import { Colors, Typography } from '@/constants/theme';
import { Bug, X, ChevronUp, ChevronDown } from 'lucide-react-native';

const Palette = {
  cardBg: '#FFFFFF',
  surfaceMuted: '#F8F9FC',
  separator: '#F0F0F5',
  badge: '#6366F1',
  accentSoft: 'rgba(99,102,241,0.08)',
  warn: '#F59E0B',
  warnSoft: 'rgba(245,158,11,0.10)',
  error: '#EF4444',
  success: '#22C55E',
};

const PLANS = ['free', 'starter', 'pro', 'enterprise'] as const;

export function PremiumDebugPanel() {
  const [visible, setVisible] = useState(false);
  const {
    tierSlug,
    isPremium,
    eventCount,
    eventLimit,
    canUse,
    canCreateEvent,
    refreshSubscription,
  } = usePremium();

  if (!__DEV__) return null;

  if (!visible) {
    return (
      <TouchableOpacity
        style={styles.fab}
        onPress={() => setVisible(true)}
        activeOpacity={0.8}
      >
        <Bug size={20} color="#FFFFFF" />
      </TouchableOpacity>
    );
  }

  const handleSetPlan = async (
    slug: 'free' | 'starter' | 'pro' | 'enterprise'
  ) => {
    premiumTestHelpers.setMockPlan(slug);
    await refreshSubscription();
  };

  const handleSetEventCount = async (count: number) => {
    premiumTestHelpers.setMockEventCount(count);
    await refreshSubscription();
  };

  return (
    <View style={styles.panel}>
      {/* Header */}
      <View style={styles.panelHeader}>
        <Bug size={16} color={Palette.warn} />
        <Text style={styles.panelTitle}>Premium Debug</Text>
        <TouchableOpacity onPress={() => setVisible(false)}>
          <X size={18} color={Colors.text.tertiary} />
        </TouchableOpacity>
      </View>

      {/* Current state */}
      <View style={styles.stateRow}>
        <Text style={styles.stateLabel}>Plan:</Text>
        <View
          style={[
            styles.stateBadge,
            {
              backgroundColor:
                tierSlug === 'free' ? Palette.surfaceMuted : Palette.accentSoft,
            },
          ]}
        >
          <Text
            style={[
              styles.stateBadgeText,
              {
                color: tierSlug === 'free' ? Colors.text.tertiary : Palette.badge,
              },
            ]}
          >
            {tierSlug.toUpperCase()}
          </Text>
        </View>
      </View>

      <View style={styles.stateRow}>
        <Text style={styles.stateLabel}>Events:</Text>
        <Text style={styles.stateValue}>
          {eventCount} / {eventLimit === -1 ? '∞' : eventLimit}
        </Text>
      </View>

      <View style={styles.stateRow}>
        <Text style={styles.stateLabel}>Can create:</Text>
        <Text
          style={[
            styles.stateValue,
            { color: canCreateEvent() ? Palette.success : Palette.error },
          ]}
        >
          {canCreateEvent() ? 'YES' : 'NO'}
        </Text>
      </View>

      {/* Feature flags */}
      <Text style={styles.sectionTitle}>Feature Gates</Text>
      {(
        [
          'analytics',
          'recurring_events',
          'highlighted_markers',
          'multi_photos',
        ] as const
      ).map((f) => (
        <View key={f} style={styles.featureRow}>
          <Text style={styles.featureLabel}>{f}</Text>
          <View
            style={[
              styles.featureDot,
              { backgroundColor: canUse(f) ? Palette.success : Palette.error },
            ]}
          />
        </View>
      ))}

      {/* Plan switcher */}
      <Text style={styles.sectionTitle}>Switch Plan</Text>
      <View style={styles.planBtns}>
        {PLANS.map((slug) => (
          <TouchableOpacity
            key={slug}
            style={[
              styles.planBtn,
              tierSlug === slug && styles.planBtnActive,
            ]}
            onPress={() => handleSetPlan(slug)}
            activeOpacity={0.7}
          >
            <Text
              style={[
                styles.planBtnText,
                tierSlug === slug && styles.planBtnTextActive,
              ]}
            >
              {slug}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* Event count adjuster */}
      <Text style={styles.sectionTitle}>Mock Event Count</Text>
      <View style={styles.counterRow}>
        <TouchableOpacity
          style={styles.counterBtn}
          onPress={() => handleSetEventCount(Math.max(0, eventCount - 1))}
        >
          <ChevronDown size={16} color={Palette.badge} />
        </TouchableOpacity>
        <Text style={styles.counterValue}>{eventCount}</Text>
        <TouchableOpacity
          style={styles.counterBtn}
          onPress={() => handleSetEventCount(eventCount + 1)}
        >
          <ChevronUp size={16} color={Palette.badge} />
        </TouchableOpacity>
        {/* Quick presets */}
        {[0, 2, 5, 10].map((n) => (
          <TouchableOpacity
            key={n}
            style={[
              styles.presetBtn,
              eventCount === n && styles.presetBtnActive,
            ]}
            onPress={() => handleSetEventCount(n)}
          >
            <Text
              style={[
                styles.presetBtnText,
                eventCount === n && styles.presetBtnTextActive,
              ]}
            >
              {n}
            </Text>
          </TouchableOpacity>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  fab: {
    position: 'absolute',
    bottom: 100,
    right: 16,
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: Palette.warn,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 9999,
    ...Platform.select({
      ios: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.2,
        shadowRadius: 8,
      },
      android: { elevation: 8 },
    }),
  },
  panel: {
    position: 'absolute',
    bottom: 100,
    right: 16,
    left: 16,
    backgroundColor: Palette.cardBg,
    borderRadius: 20,
    padding: 18,
    zIndex: 9999,
    maxHeight: 480,
    ...Platform.select({
      ios: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 6 },
        shadowOpacity: 0.15,
        shadowRadius: 20,
      },
      android: { elevation: 12 },
    }),
  },
  panelHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 14,
  },
  panelTitle: {
    flex: 1,
    fontSize: Typography.sizes.md,
    fontFamily: Typography.fontFamilies.bold,
    fontWeight: Typography.weights.bold,
    color: Colors.text.primary,
  },
  stateRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 4,
  },
  stateLabel: {
    fontSize: Typography.sizes.sm,
    fontFamily: Typography.fontFamilies.medium,
    fontWeight: Typography.weights.medium,
    color: Colors.text.tertiary,
  },
  stateValue: {
    fontSize: Typography.sizes.sm,
    fontFamily: Typography.fontFamilies.semibold,
    fontWeight: Typography.weights.semibold,
    color: Colors.text.primary,
  },
  stateBadge: {
    paddingHorizontal: 10,
    paddingVertical: 3,
    borderRadius: 8,
  },
  stateBadgeText: {
    fontSize: 11,
    fontFamily: Typography.fontFamilies.bold,
    fontWeight: Typography.weights.bold,
    letterSpacing: 0.5,
  },
  sectionTitle: {
    fontSize: 11,
    fontFamily: Typography.fontFamilies.semibold,
    fontWeight: Typography.weights.semibold,
    color: Colors.text.tertiary,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    marginTop: 14,
    marginBottom: 8,
  },
  featureRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 3,
  },
  featureLabel: {
    fontSize: Typography.sizes.xs,
    fontFamily: Typography.fontFamily,
    color: Colors.text.secondary,
  },
  featureDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  planBtns: {
    flexDirection: 'row',
    gap: 6,
  },
  planBtn: {
    flex: 1,
    paddingVertical: 8,
    borderRadius: 10,
    backgroundColor: Palette.surfaceMuted,
    alignItems: 'center',
    borderWidth: 1.5,
    borderColor: Palette.separator,
  },
  planBtnActive: {
    backgroundColor: Palette.accentSoft,
    borderColor: Palette.badge,
  },
  planBtnText: {
    fontSize: 11,
    fontFamily: Typography.fontFamilies.semibold,
    fontWeight: Typography.weights.semibold,
    color: Colors.text.tertiary,
    textTransform: 'capitalize',
  },
  planBtnTextActive: {
    color: Palette.badge,
  },
  counterRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  counterBtn: {
    width: 32,
    height: 32,
    borderRadius: 10,
    backgroundColor: Palette.accentSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  counterValue: {
    fontSize: Typography.sizes.md,
    fontFamily: Typography.fontFamilies.bold,
    fontWeight: Typography.weights.bold,
    color: Colors.text.primary,
    minWidth: 24,
    textAlign: 'center',
  },
  presetBtn: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
    backgroundColor: Palette.surfaceMuted,
  },
  presetBtnActive: {
    backgroundColor: Palette.accentSoft,
  },
  presetBtnText: {
    fontSize: 11,
    fontFamily: Typography.fontFamilies.semibold,
    fontWeight: Typography.weights.semibold,
    color: Colors.text.tertiary,
  },
  presetBtnTextActive: {
    color: Palette.badge,
  },
});