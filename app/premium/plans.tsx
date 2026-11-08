import { useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  Linking,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import {
  Crown,
  Check,
} from '@/components/icons.generated';
import { usePremium } from '@/contexts/PremiumContext';
import { notify } from '@/utils/notify';
import { Button } from '@/components/ui/Button';
import { ScreenHeader } from '@/components/ui/ScreenHeader';
import { useApp } from '@/contexts/AppContext';
import { premiumService, PremiumPlan } from '@/services/premium';
import { Colors, Spacing, Typography, BorderRadius, Shadows } from '@/constants/theme';
import { choiceA11y } from '@/utils/accessibility';

const Palette = {
  gradientStart: Colors.primary,
  cardBg: Colors.surface,
  surface: Colors.background.primary,
  accentSoft: Colors.primarySoft,
  separator: Colors.border.light,
  premium: Colors.premium,
  premiumSoft: Colors.premiumSoft,
  success: Colors.success,
  successSoft: Colors.successSoft,
};

export default function PremiumPlansScreen() {
  const insets = useSafeAreaInsets();
  const { userBusiness, refreshBusiness } = useApp();
  const {
    allPlans,
    currentPlan,
    subscription,
    isPremium,
    loading: contextLoading,
  } = usePremium();
  const [billingCycle, setBillingCycle] = useState<'monthly' | 'yearly'>('monthly');
  const [subscribingPlanId, setSubscribingPlanId] = useState<string | null>(null);

  const freePlan = allPlans.find((p) => p.slug === 'free');
  const proPlan = allPlans.find((p) => p.slug === 'pro');
  const currentPlanSlug = currentPlan?.slug ?? 'free';

  const handleSubscribe = useCallback(
    async (plan: PremiumPlan) => {
      if (plan.slug === 'free' || subscribingPlanId) return;
      setSubscribingPlanId(plan.id);
      try {
        if (!userBusiness?.id) {
          notify.error('Please create a business profile first.');
          return;
        }
        const { success } = await premiumService.subscribeToPlan(
          userBusiness.id,
          plan.slug,
          billingCycle
        );
        if (success) {
          // refreshSubscription is the same business-row refresh; one call.
          await refreshBusiness();
          router.back();
        }
      } catch (err) {
        console.error('Failed to subscribe:', err);
        notify.error('We could not activate your plan. Please try again.');
      } finally {
        setSubscribingPlanId(null);
      }
    },
    [billingCycle, refreshBusiness, subscribingPlanId, userBusiness]
  );

  const proMonthly = proPlan?.price_monthly ?? 0;
  const proYearly = proPlan?.price_yearly ?? 0;
  const price = billingCycle === 'monthly' ? proMonthly : proYearly;
  const savingsPercent =
    proMonthly > 0
      ? Math.round(((proMonthly * 12 - proYearly) / (proMonthly * 12)) * 100)
      : 0;
  const monthlyEquivalent = (proYearly / 100 / 12).toFixed(2);

  const fmt = (cents: number) =>
    cents === 0 ? 'Free' : `$${(cents / 100).toFixed(2)}`;

  if (contextLoading) {
    return (
      <View style={[styles.container, { paddingTop: insets.top }]}>
        <ScreenHeader title="Premium" safeArea={false} />
        <View style={styles.center}>
          <ActivityIndicator size="large" color={Palette.gradientStart} />
        </View>
      </View>
    );
  }

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      {/* ── Nav ── */}
      <ScreenHeader title="Premium" safeArea={false} />

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.scroll}
      >
        {/* ── Hero ── */}
        <View style={styles.hero}>
          <View style={styles.iconWrap}>
            <Crown size={26} color={Palette.premium} />
          </View>
          <Text style={styles.heroTitle}>Go Pro</Text>
          <Text style={styles.heroSub}>
            Unlock powerful features to grow your events and reach more people.
          </Text>
        </View>

        {/* ── Active banner ── */}
        {isPremium && subscription && (
          <View style={styles.banner}>
            <View style={styles.dot} />
            <View style={{ flex: 1 }}>
              <Text style={styles.bannerTitle}>
                Active — {currentPlan?.name ?? 'Pro'}
              </Text>
              <Text style={styles.bannerSub}>
                {subscription.current_period_end
                  ? `Expires ${new Date(subscription.current_period_end).toLocaleDateString()}`
                  : 'Active subscription'}
              </Text>
            </View>
            <TouchableOpacity
              onPress={() => router.push('/premium/manage' as never)}
            >
              <Text style={styles.manageText}>Manage</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* ── Billing toggle ── */}
        <View style={styles.toggleRow}>
          <View style={styles.toggle} accessibilityRole="radiogroup" accessibilityLabel="Billing period">
            {(['monthly', 'yearly'] as const).map((c) => (
              <TouchableOpacity
                key={c}
                style={[styles.toggleBtn, billingCycle === c && styles.toggleBtnOn]}
                onPress={() => setBillingCycle(c)}
                activeOpacity={0.7}
                {...choiceA11y(
                  billingCycle === c,
                  c === 'monthly'
                    ? 'Monthly'
                    : `Yearly${savingsPercent > 0 ? `, save ${savingsPercent}%` : ''}`
                )}
              >
                <Text
                  style={[
                    styles.toggleLabel,
                    billingCycle === c && styles.toggleLabelOn,
                  ]}
                >
                  {c === 'monthly' ? 'Monthly' : 'Yearly'}
                </Text>
                {c === 'yearly' && savingsPercent > 0 && (
                  <View style={styles.savePill}>
                    <Text style={styles.savePillText}>–{savingsPercent}%</Text>
                  </View>
                )}
              </TouchableOpacity>
            ))}
          </View>
        </View>

        {/* ── Pro card ── */}
        {proPlan && (
          <View style={styles.proCard}>
            <Text style={styles.proName}>Pro</Text>

            <View style={styles.proPriceRow}>
              <Text style={styles.proPrice}>
                {billingCycle === 'monthly' ? fmt(price) : `$${monthlyEquivalent}`}
              </Text>
              <Text style={styles.proPeriod}>/mo</Text>
            </View>

            {billingCycle === 'yearly' && (
              <Text style={styles.proSavingsNote}>
                Billed {fmt(proYearly)}/yr · Save {savingsPercent}%
              </Text>
            )}

            <View style={styles.separator} />

            <View style={styles.features}>
              {proPlan.features.map((f, i) => (
                <View key={i} style={styles.featureRow}>
                  <View style={styles.checkDot}>
                    <Check size={11} color="#FFF" />
                  </View>
                  <Text style={styles.featureLabel}>{f}</Text>
                </View>
              ))}
            </View>

            {currentPlanSlug === 'pro' ? (
              <View style={styles.currentBtn}>
                <Check size={16} color={Palette.success} />
                <Text style={styles.currentBtnText}>Current Plan</Text>
              </View>
            ) : (
              <Button
                label="Get Pro"
                onPress={() => handleSubscribe(proPlan)}
                loading={subscribingPlanId === proPlan.id}
                disabled={!!subscribingPlanId}
                size="md"
                fullWidth
                gradient
              />
            )}
          </View>
        )}

        {/* ── Free card ── */}
        {freePlan && (
          <View style={styles.freeCard}>
            <View style={styles.freeHeader}>
              <View>
                <Text style={styles.freeName}>Free</Text>
                <Text style={styles.freePrice}>$0</Text>
              </View>
              {currentPlanSlug === 'free' && (
                <View style={styles.freeBadge}>
                  <Text style={styles.freeBadgeText}>Current</Text>
                </View>
              )}
            </View>

            <View style={styles.freeFeatures}>
              {freePlan.features.map((f, i) => (
                <View key={i} style={styles.freeFeatureRow}>
                  <Check size={14} color={Colors.text.tertiary} />
                  <Text style={styles.freeFeatureLabel}>{f}</Text>
                </View>
              ))}
            </View>
          </View>
        )}

        {/* ── Footer ── */}
        <View style={styles.footer}>
          <Text style={styles.footerText}>
            Simulated checkout — no payment is collected. Cancel anytime from
            Manage Subscription.
          </Text>
          <Text style={styles.footerText}>
            Questions?{' '}
            <Text
              style={styles.footerLink}
              onPress={() => Linking.openURL('mailto:support@eventmap.com')}
              accessibilityRole="link"
              accessibilityLabel="Email support at support@eventmap.com"
            >
              support@eventmap.com
            </Text>
          </Text>
        </View>
      </ScrollView>
    </View>
  );
}

/* ────────────────────── Styles ────────────────────── */

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Palette.surface },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },

  /* nav */
  nav: {
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.sm,
  },

  /* scroll */
  scroll: { paddingBottom: 60 },

  /* hero */
  hero: {
    alignItems: 'center',
    paddingHorizontal: Spacing.xl,
    paddingTop: Spacing.md,
    paddingBottom: Spacing.lg,
  },
  iconWrap: {
    width: 52,
    height: 52,
    borderRadius: 14,
    backgroundColor: Palette.premiumSoft,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: Spacing.md,
  },
  heroTitle: {
    fontSize: Typography.sizes.xl,
    fontFamily: Typography.displayFontFamilies.extrabold,
    fontWeight: Typography.weights.extrabold,
    color: Colors.text.primary,
    marginBottom: 6,
  },
  heroSub: {
    fontSize: Typography.sizes.md,
    fontFamily: Typography.fontFamily,
    color: Colors.text.secondary,
    textAlign: 'center',
    lineHeight: 22,
    maxWidth: 280,
  },

  /* banner */
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    marginHorizontal: Spacing.lg,
    marginBottom: Spacing.lg,
    paddingVertical: Spacing.md,
    paddingHorizontal: Spacing.md,
    backgroundColor: Palette.successSoft,
    borderRadius: BorderRadius.lg,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: Palette.success,
    marginRight: Spacing.sm,
  },
  bannerTitle: {
    fontSize: Typography.sizes.sm,
    fontFamily: Typography.fontFamilies.semibold,
    fontWeight: Typography.weights.semibold,
    color: Colors.text.primary,
  },
  bannerSub: {
    fontSize: Typography.sizes.xs,
    fontFamily: Typography.fontFamily,
    color: Colors.text.secondary,
    marginTop: 2,
  },
  manageText: {
    fontSize: Typography.sizes.sm,
    fontFamily: Typography.fontFamilies.semibold,
    fontWeight: Typography.weights.semibold,
    color: Palette.success,
  },

  /* toggle */
  toggleRow: { alignItems: 'center', marginBottom: Spacing.lg },
  toggle: {
    flexDirection: 'row',
    backgroundColor: Palette.cardBg,
    borderRadius: BorderRadius.round,
    padding: 3,
    ...Shadows.sm,
  },
  toggleBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: Spacing.lg,
    paddingVertical: 10,
    borderRadius: BorderRadius.round,
    gap: 6,
  },
  toggleBtnOn: { backgroundColor: Palette.accentSoft },
  toggleLabel: {
    fontSize: Typography.sizes.sm,
    fontFamily: Typography.fontFamily,
    color: Colors.text.tertiary,
  },
  toggleLabelOn: {
    fontFamily: Typography.fontFamilies.semibold,
    fontWeight: Typography.weights.semibold,
    color: Palette.gradientStart,
  },
  savePill: {
    backgroundColor: Palette.success,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: BorderRadius.round,
  },
  savePillText: {
    fontSize: Typography.sizes.xxs,
    fontFamily: Typography.fontFamilies.bold,
    fontWeight: Typography.weights.bold,
    color: '#FFF',
  },

  /* pro card */
  proCard: {
    marginHorizontal: Spacing.lg,
    marginBottom: Spacing.md,
    backgroundColor: Palette.cardBg,
    borderRadius: BorderRadius.xl,
    padding: Spacing.lg,
    borderWidth: 1.5,
    borderColor: Palette.gradientStart,
    ...Shadows.sm,
  },
  proName: {
    fontSize: Typography.sizes.lg,
    fontFamily: Typography.fontFamilies.bold,
    fontWeight: Typography.weights.bold,
    color: Colors.text.primary,
    marginBottom: 4,
  },
  proPriceRow: { flexDirection: 'row', alignItems: 'baseline' },
  proPrice: {
    fontSize: 34,
    fontFamily: Typography.displayFontFamilies.extrabold,
    fontWeight: Typography.weights.extrabold,
    color: Colors.text.primary,
  },
  proPeriod: {
    fontSize: Typography.sizes.md,
    fontFamily: Typography.fontFamily,
    color: Colors.text.tertiary,
    marginLeft: 2,
  },
  proSavingsNote: {
    fontSize: Typography.sizes.sm,
    fontFamily: Typography.fontFamilies.medium,
    fontWeight: Typography.weights.medium,
    color: Palette.success,
    marginTop: 4,
  },

  separator: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: Palette.separator,
    marginVertical: Spacing.md,
  },

  features: { gap: 12, marginBottom: Spacing.lg },
  featureRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  checkDot: {
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: Palette.gradientStart,
    alignItems: 'center',
    justifyContent: 'center',
  },
  featureLabel: {
    flex: 1,
    fontSize: Typography.sizes.sm,
    fontFamily: Typography.fontFamily,
    color: Colors.text.secondary,
    lineHeight: 20,
  },

  currentBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 14,
    backgroundColor: Palette.successSoft,
    borderRadius: BorderRadius.lg,
  },
  currentBtnText: {
    fontSize: Typography.sizes.md,
    fontFamily: Typography.fontFamilies.semibold,
    fontWeight: Typography.weights.semibold,
    color: Palette.success,
  },

  /* free card */
  freeCard: {
    marginHorizontal: Spacing.lg,
    marginBottom: Spacing.lg,
    backgroundColor: Palette.cardBg,
    borderRadius: BorderRadius.xl,
    padding: Spacing.lg,
    borderWidth: 1,
    borderColor: Palette.separator,
  },
  freeHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: Spacing.md,
  },
  freeName: {
    fontSize: Typography.sizes.lg,
    fontFamily: Typography.fontFamilies.bold,
    fontWeight: Typography.weights.bold,
    color: Colors.text.primary,
  },
  freePrice: {
    fontSize: Typography.sizes.xxl,
    fontFamily: Typography.fontFamilies.bold,
    fontWeight: Typography.weights.bold,
    color: Colors.text.primary,
    marginTop: 2,
  },
  freeBadge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    backgroundColor: Palette.accentSoft,
    borderRadius: BorderRadius.round,
  },
  freeBadgeText: {
    fontSize: Typography.sizes.xs,
    fontFamily: Typography.fontFamilies.semibold,
    fontWeight: Typography.weights.semibold,
    color: Colors.text.secondary,
  },
  freeFeatures: { gap: 10 },
  freeFeatureRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  freeFeatureLabel: {
    flex: 1,
    fontSize: Typography.sizes.sm,
    fontFamily: Typography.fontFamily,
    color: Colors.text.tertiary,
    lineHeight: 20,
  },

  /* footer */
  footer: {
    marginTop: Spacing.lg,
    marginHorizontal: Spacing.lg,
    alignItems: 'center',
    gap: 4,
  },
  footerText: {
    fontSize: Typography.sizes.xs,
    fontFamily: Typography.fontFamily,
    color: Colors.text.tertiary,
    textAlign: 'center',
  },
  footerLink: {
    color: Colors.primary,
    fontFamily: Typography.fontFamilies.semibold,
    fontWeight: Typography.weights.semibold,
    textDecorationLine: 'underline',
  },
});