import { useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  Platform,
  Dimensions,
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
  TrendingUp,
  MapPin,
  BarChart3,
  Image as ImageIcon,
  Repeat,
  Zap,
  Star,
} from 'lucide-react-native';
import { usePremium } from '@/contexts/PremiumContext';
import { useApp } from '@/contexts/AppContext';
import { premiumService, PremiumPlan } from '@/services/premium';
import { Colors, Spacing, Typography, BorderRadius, Shadows } from '@/constants/theme';

const { width: SCREEN_WIDTH } = Dimensions.get('window');

const Palette = {
  gradientStart: '#6366F1',
  gradientEnd: '#8B5CF6',
  cardBg: '#FFFFFF',
  surfaceMuted: '#F8F9FC',
  accentSoft: 'rgba(99,102,241,0.08)',
  accentMedium: 'rgba(99,102,241,0.15)',
  separator: '#F0F0F5',
  premiumGold: '#F59E0B',
  premiumGoldSoft: 'rgba(245,158,11,0.10)',
  success: '#22C55E',
  successSoft: 'rgba(34,197,94,0.10)',
};

const FEATURE_ICONS: Record<string, any> = {
  events: TrendingUp,
  photos: ImageIcon,
  recurring: Repeat,
  analytics: BarChart3,
  markers: MapPin,
  boost: Zap,
  support: Star,
};

export default function PremiumPlansScreen() {
  const insets = useSafeAreaInsets();
  const { userBusiness } = useApp();
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

  const handleSubscribe = useCallback(
    async (plan: PremiumPlan) => {
      if (plan.slug === 'free') return;
      if (subscribingPlanId) return;

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
          await refreshSubscription();
          router.back();
        }
      } catch (err) {
        console.error('Failed to subscribe:', err);
      } finally {
        setSubscribingPlanId(null);
      }
    },
    [billingCycle, refreshSubscription, subscribingPlanId]
  );

  const formatPrice = (cents: number) => {
    if (cents === 0) return 'Free';
    const dollars = cents / 100;
    return `$${dollars.toFixed(2)}`;
  };

  const getSavingsPercent = (plan: PremiumPlan) => {
    if (plan.price_yearly === 0) return 0;
    const monthlyTotal = plan.price_monthly * 12;
    const savings = monthlyTotal - plan.price_yearly;
    return Math.round((savings / monthlyTotal) * 100);
  };

  const paidPlans = allPlans.filter((p) => p.slug !== 'free');
  const currentPlanSlug = currentPlan?.slug ?? 'free';

  if (contextLoading) {
    return (
      <View style={[styles.container, { paddingTop: insets.top }]}>
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={Palette.gradientStart} />
        </View>
      </View>
    );
  }

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity
          style={styles.backButton}
          onPress={() => router.back()}
          activeOpacity={0.7}
        >
          <ArrowLeft size={24} color={Colors.text.primary} />
        </TouchableOpacity>
        <View style={styles.headerContent}>
          <View style={styles.headerIconWrap}>
            <Crown size={24} color={Palette.premiumGold} />
          </View>
          <Text style={styles.headerTitle}>Upgrade to Premium</Text>
          <Text style={styles.headerSubtitle}>
            Unlock powerful features to grow your events
          </Text>
        </View>
      </View>

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.scrollContent}
      >
        {/* Current status banner */}
        {isPremium && subscription && (
          <View style={styles.currentStatusBanner}>
            <View style={styles.currentStatusIcon}>
              <Check size={18} color={Palette.success} />
            </View>
            <View style={styles.currentStatusContent}>
              <Text style={styles.currentStatusTitle}>
                You're on {currentPlan?.name ?? 'Premium'}
              </Text>
              <Text style={styles.currentStatusSubtitle}>
                {subscription.current_period_end
                  ? `Renews ${new Date(subscription.current_period_end).toLocaleDateString()}`
                  : 'Active subscription'}
              </Text>
            </View>
            <TouchableOpacity
              style={styles.manageButton}
              onPress={() => router.push('/premium/manage' as never)}
            >
              <Text style={styles.manageButtonText}>Manage</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* Billing cycle toggle */}
        {paidPlans.length > 0 && (
          <View style={styles.billingToggle}>
            <TouchableOpacity
              style={[
                styles.billingOption,
                billingCycle === 'monthly' && styles.billingOptionActive,
              ]}
              onPress={() => setBillingCycle('monthly')}
              activeOpacity={0.7}
            >
              <Text
                style={[
                  styles.billingOptionText,
                  billingCycle === 'monthly' && styles.billingOptionTextActive,
                ]}
              >
                Monthly
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[
                styles.billingOption,
                billingCycle === 'yearly' && styles.billingOptionActive,
              ]}
              onPress={() => setBillingCycle('yearly')}
              activeOpacity={0.7}
            >
              <Text
                style={[
                  styles.billingOptionText,
                  billingCycle === 'yearly' && styles.billingOptionTextActive,
                ]}
              >
                Yearly
                {paidPlans[0] && getSavingsPercent(paidPlans[0]) > 0 && (
                  <Text style={styles.savingsBadge}>
                    {' '}
                    Save {getSavingsPercent(paidPlans[0])}%
                  </Text>
                )}
              </Text>
            </TouchableOpacity>
          </View>
        )}

        {/* Plans grid */}
        <View style={styles.plansGrid}>
          {allPlans.map((plan) => {
            const isCurrentPlan = plan.slug === currentPlanSlug;
            const isPopular = plan.slug === 'pro';
            const price =
              billingCycle === 'monthly' ? plan.price_monthly : plan.price_yearly;
            const isSubscribing = subscribingPlanId === plan.id;

            return (
              <View
                key={plan.id}
                style={[
                  styles.planCard,
                  isPopular && styles.planCardPopular,
                  isCurrentPlan && styles.planCardCurrent,
                ]}
              >
                {isPopular && (
                  <View style={styles.popularBadge}>
                    <Sparkles size={12} color="#FFFFFF" />
                    <Text style={styles.popularBadgeText}>Most Popular</Text>
                  </View>
                )}
                {isCurrentPlan && (
                  <View style={styles.currentBadge}>
                    <Check size={12} color={Palette.success} />
                    <Text style={styles.currentBadgeText}>Current Plan</Text>
                  </View>
                )}

                <View style={styles.planHeader}>
                  <Text style={styles.planName}>{plan.name}</Text>
                  <Text style={styles.planDescription}>{plan.description}</Text>
                  <View style={styles.planPriceRow}>
                    <Text style={styles.planPrice}>{formatPrice(price)}</Text>
                    {price > 0 && (
                      <Text style={styles.planPeriod}>
                        /{billingCycle === 'monthly' ? 'month' : 'year'}
                      </Text>
                    )}
                  </View>
                  {billingCycle === 'yearly' &&
                    plan.price_yearly > 0 &&
                    getSavingsPercent(plan) > 0 && (
                      <Text style={styles.planSavings}>
                        Save {getSavingsPercent(plan)}% vs monthly
                      </Text>
                    )}
                </View>

                <View style={styles.planFeatures}>
                  {plan.features.map((feature, idx) => (
                    <View key={idx} style={styles.featureRow}>
                      <Check
                        size={16}
                        color={
                          plan.slug === 'free'
                            ? Colors.text.tertiary
                            : Palette.gradientStart
                        }
                      />
                      <Text style={styles.featureText}>{feature}</Text>
                    </View>
                  ))}
                </View>

                <TouchableOpacity
                  style={[
                    styles.planButton,
                    isCurrentPlan && styles.planButtonCurrent,
                    isPopular && !isCurrentPlan && styles.planButtonPopular,
                    plan.slug === 'free' && styles.planButtonFree,
                  ]}
                  onPress={() => handleSubscribe(plan)}
                  disabled={isCurrentPlan || isSubscribing}
                  activeOpacity={0.85}
                >
                  {isSubscribing ? (
                    <ActivityIndicator size="small" color="#FFFFFF" />
                  ) : isCurrentPlan ? (
                    <Text style={styles.planButtonTextCurrent}>Current Plan</Text>
                  ) : plan.slug === 'free' ? (
                    <Text style={styles.planButtonTextFree}>Current Plan</Text>
                  ) : (
                    <LinearGradient
                      colors={
                        isPopular
                          ? [Palette.gradientStart, Palette.gradientEnd]
                          : [Palette.gradientStart, Palette.gradientEnd]
                      }
                      start={{ x: 0, y: 0 }}
                      end={{ x: 1, y: 0 }}
                      style={styles.planButtonGradient}
                    >
                      <Text style={styles.planButtonText}>
                        {plan.slug === 'enterprise' ? 'Contact Sales' : 'Subscribe'}
                      </Text>
                    </LinearGradient>
                  )}
                </TouchableOpacity>
              </View>
            );
          })}
        </View>

        {/* Feature comparison */}
        <View style={styles.comparisonSection}>
          <Text style={styles.comparisonTitle}>Feature Comparison</Text>
          <View style={styles.comparisonTable}>
            <View style={styles.comparisonRow}>
              <Text style={styles.comparisonLabel}>Max Events</Text>
              <View style={styles.comparisonValues}>
                {allPlans.map((plan) => (
                  <Text
                    key={plan.id}
                    style={[
                      styles.comparisonValue,
                      plan.slug === currentPlanSlug && styles.comparisonValueCurrent,
                    ]}
                  >
                    {plan.max_events === -1 ? '∞' : plan.max_events}
                  </Text>
                ))}
              </View>
            </View>
            <View style={styles.comparisonRow}>
              <Text style={styles.comparisonLabel}>Photos per Event</Text>
              <View style={styles.comparisonValues}>
                {allPlans.map((plan) => (
                  <Text
                    key={plan.id}
                    style={[
                      styles.comparisonValue,
                      plan.slug === currentPlanSlug && styles.comparisonValueCurrent,
                    ]}
                  >
                    {plan.max_photos_per_event}
                  </Text>
                ))}
              </View>
            </View>
            <View style={styles.comparisonRow}>
              <Text style={styles.comparisonLabel}>Boost Multiplier</Text>
              <View style={styles.comparisonValues}>
                {allPlans.map((plan) => (
                  <Text
                    key={plan.id}
                    style={[
                      styles.comparisonValue,
                      plan.slug === currentPlanSlug && styles.comparisonValueCurrent,
                    ]}
                  >
                    {plan.boost_multiplier}×
                  </Text>
                ))}
              </View>
            </View>
            <View style={styles.comparisonRow}>
              <Text style={styles.comparisonLabel}>Analytics</Text>
              <View style={styles.comparisonValues}>
                {allPlans.map((plan) => (
                  <View key={plan.id} style={styles.comparisonCheck}>
                    {plan.analytics_enabled ? (
                      <Check size={14} color={Palette.success} />
                    ) : (
                      <Text style={styles.comparisonX}>—</Text>
                    )}
                  </View>
                ))}
              </View>
            </View>
            <View style={styles.comparisonRow}>
              <Text style={styles.comparisonLabel}>Highlighted Markers</Text>
              <View style={styles.comparisonValues}>
                {allPlans.map((plan) => (
                  <View key={plan.id} style={styles.comparisonCheck}>
                    {plan.highlighted_markers ? (
                      <Check size={14} color={Palette.success} />
                    ) : (
                      <Text style={styles.comparisonX}>—</Text>
                    )}
                  </View>
                ))}
              </View>
            </View>
            <View style={styles.comparisonRow}>
              <Text style={styles.comparisonLabel}>Recurring Events</Text>
              <View style={styles.comparisonValues}>
                {allPlans.map((plan) => (
                  <View key={plan.id} style={styles.comparisonCheck}>
                    {plan.recurring_events ? (
                      <Check size={14} color={Palette.success} />
                    ) : (
                      <Text style={styles.comparisonX}>—</Text>
                    )}
                  </View>
                ))}
              </View>
            </View>
          </View>
        </View>

        {/* Footer note */}
        <View style={styles.footer}>
          <Text style={styles.footerText}>
            All plans include a 14-day free trial. Cancel anytime.
          </Text>
          <Text style={styles.footerText}>
            Questions? Contact support@eventmap.com
          </Text>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Palette.surfaceMuted,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  header: {
    backgroundColor: Palette.cardBg,
    paddingHorizontal: Spacing.lg,
    paddingBottom: Spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: Palette.separator,
  },
  backButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: Palette.accentSoft,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: Spacing.md,
  },
  headerContent: {
    alignItems: 'center',
  },
  headerIconWrap: {
    width: 64,
    height: 64,
    borderRadius: 20,
    backgroundColor: Palette.premiumGoldSoft,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: Spacing.md,
  },
  headerTitle: {
    fontSize: Typography.sizes.xxl,
    fontFamily: Typography.fontFamilies.bold,
    fontWeight: Typography.weights.bold,
    color: Colors.text.primary,
    marginBottom: Spacing.xs,
  },
  headerSubtitle: {
    fontSize: Typography.sizes.md,
    fontFamily: Typography.fontFamily,
    color: Colors.text.secondary,
    textAlign: 'center',
  },
  scrollContent: {
    paddingBottom: Spacing.xxl,
  },
  currentStatusBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Palette.successSoft,
    marginHorizontal: Spacing.lg,
    marginTop: Spacing.lg,
    padding: Spacing.md,
    borderRadius: BorderRadius.lg,
    borderWidth: 1,
    borderColor: 'rgba(34,197,94,0.2)',
  },
  currentStatusIcon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: Palette.success,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: Spacing.md,
  },
  currentStatusContent: {
    flex: 1,
  },
  currentStatusTitle: {
    fontSize: Typography.sizes.md,
    fontFamily: Typography.fontFamilies.semibold,
    fontWeight: Typography.weights.semibold,
    color: Colors.text.primary,
    marginBottom: 2,
  },
  currentStatusSubtitle: {
    fontSize: Typography.sizes.sm,
    fontFamily: Typography.fontFamily,
    color: Colors.text.secondary,
  },
  manageButton: {
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    borderRadius: BorderRadius.md,
    backgroundColor: Palette.success,
  },
  manageButtonText: {
    fontSize: Typography.sizes.sm,
    fontFamily: Typography.fontFamilies.semibold,
    fontWeight: Typography.weights.semibold,
    color: '#FFFFFF',
  },
  billingToggle: {
    flexDirection: 'row',
    backgroundColor: Palette.cardBg,
    marginHorizontal: Spacing.lg,
    marginTop: Spacing.lg,
    padding: 4,
    borderRadius: BorderRadius.md,
    ...Shadows.sm,
  },
  billingOption: {
    flex: 1,
    paddingVertical: Spacing.sm,
    alignItems: 'center',
    borderRadius: BorderRadius.sm,
  },
  billingOptionActive: {
    backgroundColor: Palette.accentSoft,
  },
  billingOptionText: {
    fontSize: Typography.sizes.sm,
    fontFamily: Typography.fontFamily,
    color: Colors.text.secondary,
  },
  billingOptionTextActive: {
    fontFamily: Typography.fontFamilies.semibold,
    fontWeight: Typography.weights.semibold,
    color: Palette.gradientStart,
  },
  savingsBadge: {
    fontSize: Typography.sizes.xs,
    fontFamily: Typography.fontFamilies.medium,
    fontWeight: Typography.weights.medium,
    color: Palette.success,
  },
  plansGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    paddingHorizontal: Spacing.md,
    marginTop: Spacing.lg,
    gap: Spacing.md,
  },
  planCard: {
    width: (SCREEN_WIDTH - Spacing.lg * 2 - Spacing.md) / 2,
    backgroundColor: Palette.cardBg,
    borderRadius: BorderRadius.xl,
    padding: Spacing.md,
    position: 'relative',
    ...Shadows.md,
  },
  planCardPopular: {
    borderWidth: 2,
    borderColor: Palette.gradientStart,
  },
  planCardCurrent: {
    borderWidth: 2,
    borderColor: Palette.success,
  },
  popularBadge: {
    position: 'absolute',
    top: -10,
    left: '50%',
    transform: [{ translateX: -50 }],
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: Palette.gradientStart,
    paddingHorizontal: Spacing.sm,
    paddingVertical: 4,
    borderRadius: BorderRadius.round,
    zIndex: 1,
  },
  popularBadgeText: {
    fontSize: Typography.sizes.xs,
    fontFamily: Typography.fontFamilies.bold,
    fontWeight: Typography.weights.bold,
    color: '#FFFFFF',
  },
  currentBadge: {
    position: 'absolute',
    top: -10,
    left: '50%',
    transform: [{ translateX: -50 }],
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: Palette.success,
    paddingHorizontal: Spacing.sm,
    paddingVertical: 4,
    borderRadius: BorderRadius.round,
    zIndex: 1,
  },
  currentBadgeText: {
    fontSize: Typography.sizes.xs,
    fontFamily: Typography.fontFamilies.bold,
    fontWeight: Typography.weights.bold,
    color: '#FFFFFF',
  },
  planHeader: {
    marginTop: Spacing.sm,
    marginBottom: Spacing.md,
  },
  planName: {
    fontSize: Typography.sizes.xl,
    fontFamily: Typography.fontFamilies.bold,
    fontWeight: Typography.weights.bold,
    color: Colors.text.primary,
    marginBottom: 4,
  },
  planDescription: {
    fontSize: Typography.sizes.xs,
    fontFamily: Typography.fontFamily,
    color: Colors.text.tertiary,
    marginBottom: Spacing.sm,
  },
  planPriceRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    marginBottom: 4,
  },
  planPrice: {
    fontSize: Typography.sizes.xxl,
    fontFamily: Typography.fontFamilies.bold,
    fontWeight: Typography.weights.bold,
    color: Colors.text.primary,
  },
  planPeriod: {
    fontSize: Typography.sizes.sm,
    fontFamily: Typography.fontFamily,
    color: Colors.text.tertiary,
    marginLeft: 4,
  },
  planSavings: {
    fontSize: Typography.sizes.xs,
    fontFamily: Typography.fontFamilies.medium,
    fontWeight: Typography.weights.medium,
    color: Palette.success,
  },
  planFeatures: {
    marginBottom: Spacing.md,
    gap: Spacing.xs,
  },
  featureRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs,
  },
  featureText: {
    flex: 1,
    fontSize: Typography.sizes.xs,
    fontFamily: Typography.fontFamily,
    color: Colors.text.secondary,
  },
  planButton: {
    borderRadius: BorderRadius.md,
    overflow: 'hidden',
  },
  planButtonCurrent: {
    backgroundColor: Palette.successSoft,
  },
  planButtonPopular: {},
  planButtonFree: {
    backgroundColor: Palette.surfaceMuted,
  },
  planButtonGradient: {
    paddingVertical: Spacing.md,
    alignItems: 'center',
  },
  planButtonText: {
    fontSize: Typography.sizes.md,
    fontFamily: Typography.fontFamilies.bold,
    fontWeight: Typography.weights.bold,
    color: '#FFFFFF',
  },
  planButtonTextCurrent: {
    fontSize: Typography.sizes.md,
    fontFamily: Typography.fontFamilies.semibold,
    fontWeight: Typography.weights.semibold,
    color: Palette.success,
    textAlign: 'center',
    paddingVertical: Spacing.md,
  },
  planButtonTextFree: {
    fontSize: Typography.sizes.md,
    fontFamily: Typography.fontFamilies.semibold,
    fontWeight: Typography.weights.semibold,
    color: Colors.text.secondary,
    textAlign: 'center',
    paddingVertical: Spacing.md,
  },
  comparisonSection: {
    marginTop: Spacing.xl,
    marginHorizontal: Spacing.lg,
    backgroundColor: Palette.cardBg,
    borderRadius: BorderRadius.xl,
    padding: Spacing.lg,
    ...Shadows.md,
  },
  comparisonTitle: {
    fontSize: Typography.sizes.lg,
    fontFamily: Typography.fontFamilies.bold,
    fontWeight: Typography.weights.bold,
    color: Colors.text.primary,
    marginBottom: Spacing.md,
  },
  comparisonTable: {
    gap: Spacing.sm,
  },
  comparisonRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: Spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: Palette.separator,
  },
  comparisonLabel: {
    width: 140,
    fontSize: Typography.sizes.sm,
    fontFamily: Typography.fontFamily,
    color: Colors.text.secondary,
  },
  comparisonValues: {
    flex: 1,
    flexDirection: 'row',
    justifyContent: 'space-around',
  },
  comparisonValue: {
    flex: 1,
    fontSize: Typography.sizes.sm,
    fontFamily: Typography.fontFamilies.medium,
    fontWeight: Typography.weights.medium,
    color: Colors.text.primary,
    textAlign: 'center',
  },
  comparisonValueCurrent: {
    fontFamily: Typography.fontFamilies.bold,
    fontWeight: Typography.weights.bold,
    color: Palette.gradientStart,
  },
  comparisonCheck: {
    flex: 1,
    alignItems: 'center',
  },
  comparisonX: {
    fontSize: Typography.sizes.md,
    fontFamily: Typography.fontFamily,
    color: Colors.text.tertiary,
  },
  footer: {
    marginTop: Spacing.xl,
    marginHorizontal: Spacing.lg,
    alignItems: 'center',
    gap: Spacing.xs,
  },
  footerText: {
    fontSize: Typography.sizes.xs,
    fontFamily: Typography.fontFamily,
    color: Colors.text.tertiary,
    textAlign: 'center',
  },
});
