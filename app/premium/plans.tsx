import { useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { router } from 'expo-router';
import {
  ArrowLeft,
  Crown,
  Check,
  Sparkles,
} from 'lucide-react-native';
import { usePremium } from '@/contexts/PremiumContext';
import { useApp } from '@/contexts/AppContext';
import { premiumService, PremiumPlan } from '@/services/premium';
import { Colors, Spacing, Typography, BorderRadius, Shadows } from '@/constants/theme';

const Palette = {
  gradientStart: Colors.primary,
  gradientEnd: Colors.accent,
  cardBg: Colors.background.primary,
  surface: Colors.background.primary,
  accentSoft: 'rgba(196, 92, 62, 0.08)',
  separator: Colors.border.light,
  premiumGold: Colors.accent,
  premiumGoldSoft: 'rgba(232, 168, 56, 0.10)',
  success: Colors.success,
  successSoft: 'rgba(45, 138, 110, 0.08)',
};

const PRO_MONTHLY = 699;
const PRO_YEARLY = 6999;

export default function PremiumPlansScreen() {
  const insets = useSafeAreaInsets();
  const { userBusiness, refreshBusiness } = useApp();
  const {
    allPlans,
    currentPlan,
    subscription,
    isPremium,
    loading: contextLoading,
    refreshSubscription,
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
          Alert.alert('Error', 'Please create a business profile first.');
          return;
        }
        const { success } = await premiumService.subscribeToPlan(
          userBusiness.id,
          plan.slug,
          billingCycle
        );
        if (success) {
          await refreshBusiness();
          await refreshSubscription();
          router.back();
        }
      } catch (err) {
        console.error('Failed to subscribe:', err);
      } finally {
        setSubscribingPlanId(null);
      }
    },
    [billingCycle, refreshBusiness, refreshSubscription, subscribingPlanId, userBusiness]
  );

  const price = billingCycle === 'monthly' ? PRO_MONTHLY : PRO_YEARLY;
  const savingsPercent = Math.round(
    ((PRO_MONTHLY * 12 - PRO_YEARLY) / (PRO_MONTHLY * 12)) * 100
  );
  const monthlyEquivalent = (PRO_YEARLY / 100 / 12).toFixed(2);

  const fmt = (cents: number) =>
    cents === 0 ? 'Free' : `$${(cents / 100).toFixed(2)}`;

  if (contextLoading) {
    return (
      <View style={[styles.container, { paddingTop: insets.top }]}>
        <View style={styles.center}>
          <ActivityIndicator size="large" color={Palette.gradientStart} />
        </View>
      </View>
    );
  }

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      {/* ── Nav ── */}
      <View style={styles.nav}>
        <TouchableOpacity onPress={() => router.back()} activeOpacity={0.7}>
          <ArrowLeft size={22} color={Colors.text.primary} />
        </TouchableOpacity>
      </View>

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.scroll}
      >
        {/* ── Hero ── */}
        <View style={styles.hero}>
          <View style={styles.iconWrap}>
            <Crown size={26} color={Palette.premiumGold} />
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
                  ? `Renews ${new Date(subscription.current_period_end).toLocaleDateString()}`
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
          <View style={styles.toggle}>
            {(['monthly', 'yearly'] as const).map((c) => (
              <TouchableOpacity
                key={c}
                style={[styles.toggleBtn, billingCycle === c && styles.toggleBtnOn]}
                onPress={() => setBillingCycle(c)}
                activeOpacity={0.7}
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
            <View style={styles.proBadge}>
              <Sparkles size={11} color="#FFF" />
              <Text style={styles.proBadgeText}>Recommended</Text>
            </View>

            <Text style={styles.proName}>Pro</Text>

            <View style={styles.proPriceRow}>
              <Text style={styles.proPrice}>{fmt(price)}</Text>
              <Text style={styles.proPeriod}>
                /{billingCycle === 'monthly' ? 'mo' : 'yr'}
              </Text>
            </View>

            {billingCycle === 'yearly' && (
              <Text style={styles.proSavingsNote}>
                ${monthlyEquivalent}/mo · Save {savingsPercent}%
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
              <TouchableOpacity
                style={styles.cta}
                onPress={() => handleSubscribe(proPlan)}
                disabled={!!subscribingPlanId}
                activeOpacity={0.85}
              >
                {subscribingPlanId === proPlan.id ? (
                  <View style={styles.ctaInner}>
                    <ActivityIndicator size="small" color="#FFF" />
                  </View>
                ) : (
                  <LinearGradient
                    colors={[Palette.gradientStart, Palette.gradientEnd]}
                    start={{ x: 0, y: 0 }}
                    end={{ x: 1, y: 0 }}
                    style={styles.ctaInner}
                  >
                    <Text style={styles.ctaText}>Get Pro</Text>
                  </LinearGradient>
                )}
              </TouchableOpacity>
            )}
          </View>
        )}

        {/* ── Free card ── */}
        {freePlan && (
          <View style={styles.freeCard}>
            <View style={styles.freeHeader}>
              <View>
                <Text style={styles.freeName}>Free</Text>
                <Text style={styles.freePrice}>\$0</Text>
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
            14-day free trial included. Cancel anytime.
          </Text>
          <Text style={styles.footerText}>
            Questions? support@eventmap.com
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
    backgroundColor: Palette.premiumGoldSoft,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: Spacing.md,
  },
  heroTitle: {
    fontSize: 28,
    fontFamily: Typography.fontFamilies.bold,
    fontWeight: Typography.weights.bold,
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
    fontSize: 10,
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
  proBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: 4,
    backgroundColor: Palette.gradientStart,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: BorderRadius.round,
    marginBottom: Spacing.md,
  },
  proBadgeText: {
    fontSize: 11,
    fontFamily: Typography.fontFamilies.bold,
    fontWeight: Typography.weights.bold,
    color: '#FFF',
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
    fontFamily: Typography.fontFamilies.bold,
    fontWeight: Typography.weights.bold,
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

  /* cta */
  cta: { borderRadius: BorderRadius.lg, overflow: 'hidden' },
  ctaInner: {
    paddingVertical: 14,
    alignItems: 'center',
    borderRadius: BorderRadius.lg,
  },
  ctaText: {
    fontSize: Typography.sizes.md,
    fontFamily: Typography.fontFamilies.bold,
    fontWeight: Typography.weights.bold,
    color: '#FFF',
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
});