import { useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Alert,
  ActivityIndicator,
  Platform,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { router } from 'expo-router';
import {
  ArrowLeft,
  Crown,
  Calendar,
  CreditCard,
  AlertCircle,
  Check,
  X,
  RefreshCw,
} from 'lucide-react-native';
import { usePremium } from '@/contexts/PremiumContext';
import { premiumService } from '@/services/premium';
import { Colors, Spacing, Typography, BorderRadius, Shadows } from '@/constants/theme';

const Palette = {
  gradientStart: Colors.primary,
  gradientEnd: Colors.accent,
  cardBg: Colors.background.primary,
  surfaceMuted: Colors.background.primary,
  accentSoft: 'rgba(196, 92, 62, 0.12)',
  separator: Colors.border.light,
  premiumGold: Colors.accent,
  success: Colors.success,
  successSoft: 'rgba(45, 138, 110, 0.12)',
  error: Colors.error,
  errorSoft: 'rgba(196, 92, 62, 0.12)',
  warn: Colors.warning,
  warnSoft: 'rgba(212, 160, 23, 0.12)',
};

export default function ManageSubscriptionScreen() {
  const insets = useSafeAreaInsets();
  const {
    subscription,
    currentPlan,
    isPremium,
    refreshSubscription,
  } = usePremium();
  const [canceling, setCanceling] = useState(false);
  const [reactivating, setReactivating] = useState(false);

  const formatDate = (dateString: string | null) => {
    if (!dateString) return 'N/A';
    return new Date(dateString).toLocaleDateString('en-US', {
      month: 'long',
      day: 'numeric',
      year: 'numeric',
    });
  };

  const formatPrice = (cents: number) => {
    if (cents === 0) return 'Free';
    const dollars = cents / 100;
    return `$${dollars.toFixed(2)}`;
  };

  const handleCancel = useCallback(() => {
    if (!subscription) return;

    Alert.alert(
      'Cancel Subscription',
      subscription.cancel_at_period_end
        ? 'Your subscription is already set to cancel. Would you like to reactivate it instead?'
        : 'Are you sure you want to cancel your subscription? You\'ll continue to have access until the end of your billing period.',
      [
        { text: 'Keep Subscription', style: 'cancel' },
        {
          text: 'Cancel Subscription',
          style: 'destructive',
          onPress: async () => {
            setCanceling(true);
            try {
              await premiumService.cancelSubscription('current-business-id');
              await refreshSubscription();
            } catch (err) {
              console.error('Failed to cancel:', err);
              Alert.alert('Error', 'Failed to cancel subscription. Please try again.');
            } finally {
              setCanceling(false);
            }
          },
        },
      ]
    );
  }, [subscription, refreshSubscription]);

  const handleReactivate = useCallback(async () => {
    if (!subscription) return;
    setReactivating(true);
    try {
      // In real implementation, this would call an API to reactivate
      // For now, we'll just refresh and the mock service will handle it
      await refreshSubscription();
      Alert.alert('Success', 'Your subscription has been reactivated!');
    } catch (err) {
      console.error('Failed to reactivate:', err);
      Alert.alert('Error', 'Failed to reactivate subscription. Please try again.');
    } finally {
      setReactivating(false);
    }
  }, [subscription, refreshSubscription]);

  const handleUpgrade = useCallback(() => {
    router.push('/premium/plans' as never);
  });

  if (!isPremium && !subscription) {
    return (
      <View style={[styles.container, { paddingTop: insets.top }]}>
        <View style={styles.header}>
          <TouchableOpacity
            style={styles.backButton}
            onPress={() => router.back()}
            activeOpacity={0.7}
          >
            <ArrowLeft size={24} color={Colors.text.primary} />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Subscription</Text>
        </View>
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.emptyState}>
            <View style={styles.emptyIconWrap}>
              <Crown size={48} color={Palette.premiumGold} />
            </View>
            <Text style={styles.emptyTitle}>No Active Subscription</Text>
            <Text style={styles.emptySubtitle}>
              You're currently on the free plan. Upgrade to unlock premium features!
            </Text>
            <TouchableOpacity
              style={styles.upgradeButton}
              onPress={handleUpgrade}
              activeOpacity={0.85}
            >
              <LinearGradient
                colors={[Palette.gradientStart, Palette.gradientEnd]}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 0 }}
                style={styles.upgradeButtonGradient}
              >
                <Text style={styles.upgradeButtonText}>View Plans</Text>
              </LinearGradient>
            </TouchableOpacity>
          </View>
        </ScrollView>
      </View>
    );
  }

  const isCanceling = subscription?.cancel_at_period_end ?? false;
  const statusColor =
    subscription?.status === 'active'
      ? Palette.success
      : subscription?.status === 'past_due'
        ? Palette.error
        : Palette.warn;

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <TouchableOpacity
          style={styles.backButton}
          onPress={() => router.back()}
          activeOpacity={0.7}
        >
          <ArrowLeft size={24} color={Colors.text.primary} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Manage Subscription</Text>
      </View>

      <ScrollView
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {/* Current plan card */}
        <View style={styles.planCard}>
          <View style={styles.planCardHeader}>
            <View style={styles.planIconWrap}>
              <Crown size={24} color={Palette.premiumGold} />
            </View>
            <View style={styles.planInfo}>
              <Text style={styles.planName}>{currentPlan?.name ?? 'Free'}</Text>
              <Text style={styles.planDescription}>
                {currentPlan?.description ?? 'Basic plan'}
              </Text>
            </View>
            <View
              style={[
                styles.statusBadge,
                { backgroundColor: statusColor + '20' },
              ]}
            >
              <Text style={[styles.statusText, { color: statusColor }]}>
                {subscription?.status === 'active'
                  ? 'Active'
                  : subscription?.status === 'past_due'
                    ? 'Past Due'
                    : subscription?.status === 'trialing'
                      ? 'Trial'
                      : 'Inactive'}
              </Text>
            </View>
          </View>

          {isCanceling && (
            <View style={styles.cancelWarning}>
              <AlertCircle size={16} color={Palette.warn} />
              <Text style={styles.cancelWarningText}>
                Your subscription will cancel on{' '}
                {formatDate(subscription?.current_period_end ?? null)}
              </Text>
            </View>
          )}

          <View style={styles.planDetails}>
            <View style={styles.detailRow}>
              <Text style={styles.detailLabel}>Billing Amount</Text>
              <Text style={styles.detailValue}>
                {formatPrice(currentPlan?.price_monthly ?? 0)}/month
              </Text>
            </View>
            <View style={styles.detailRow}>
              <Text style={styles.detailLabel}>Current Period</Text>
              <Text style={styles.detailValue}>
                {formatDate(subscription?.current_period_start ?? null)} -{' '}
                {formatDate(subscription?.current_period_end ?? null)}
              </Text>
            </View>
            {subscription?.current_period_end && (
              <View style={styles.detailRow}>
                <Text style={styles.detailLabel}>
                  {isCanceling ? 'Cancels On' : 'Renews On'}
                </Text>
                <Text style={styles.detailValue}>
                  {formatDate(subscription.current_period_end)}
                </Text>
              </View>
            )}
          </View>
        </View>

        {/* Features */}
        {currentPlan && currentPlan.features.length > 0 && (
          <View style={styles.featuresCard}>
            <Text style={styles.sectionTitle}>Your Plan Includes</Text>
            <View style={styles.featuresList}>
              {currentPlan.features.map((feature, idx) => (
                <View key={idx} style={styles.featureRow}>
                  <Check size={16} color={Palette.success} />
                  <Text style={styles.featureText}>{feature}</Text>
                </View>
              ))}
            </View>
          </View>
        )}

        {/* Actions */}
        <View style={styles.actionsCard}>
          {isCanceling ? (
            <TouchableOpacity
              style={styles.reactivateButton}
              onPress={handleReactivate}
              disabled={reactivating}
              activeOpacity={0.85}
            >
              <LinearGradient
                colors={[Palette.gradientStart, Palette.gradientEnd]}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 0 }}
                style={styles.reactivateButtonGradient}
              >
                {reactivating ? (
                  <ActivityIndicator size="small" color="#FFFFFF" />
                ) : (
                  <>
                    <RefreshCw size={18} color="#FFFFFF" />
                    <Text style={styles.reactivateButtonText}>Reactivate Subscription</Text>
                  </>
                )}
              </LinearGradient>
            </TouchableOpacity>
          ) : (
            <TouchableOpacity
              style={styles.cancelButton}
              onPress={handleCancel}
              disabled={canceling}
              activeOpacity={0.85}
            >
              {canceling ? (
                <ActivityIndicator size="small" color={Palette.error} />
              ) : (
                <>
                  <X size={18} color={Palette.error} />
                  <Text style={styles.cancelButtonText}>Cancel Subscription</Text>
                </>
              )}
            </TouchableOpacity>
          )}

          <TouchableOpacity
            style={styles.changePlanButton}
            onPress={handleUpgrade}
            activeOpacity={0.85}
          >
            <Text style={styles.changePlanButtonText}>Change Plan</Text>
          </TouchableOpacity>
        </View>

        {/* Payment method */}
        <View style={styles.paymentCard}>
          <View style={styles.paymentHeader}>
            <CreditCard size={20} color={Colors.text.primary} />
            <Text style={styles.sectionTitle}>Payment Method</Text>
          </View>
          <Text style={styles.paymentNote}>
            Payment methods are managed through Stripe. You'll be redirected to Stripe
            to update your payment information.
          </Text>
          <TouchableOpacity
            style={styles.updatePaymentButton}
            onPress={() => {
              Alert.alert(
                'Update Payment',
                'This will redirect you to Stripe to manage your payment method. Coming soon!'
              );
            }}
            activeOpacity={0.7}
          >
            <Text style={styles.updatePaymentText}>Update Payment Method</Text>
          </TouchableOpacity>
        </View>

        {/* Footer */}
        <View style={styles.footer}>
          <Text style={styles.footerText}>
            Need help? Contact support@eventmap.com
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
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Palette.cardBg,
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.md,
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
    marginRight: Spacing.md,
  },
  headerTitle: {
    fontSize: Typography.sizes.xl,
    fontFamily: Typography.fontFamilies.bold,
    fontWeight: Typography.weights.bold,
    color: Colors.text.primary,
  },
  scrollContent: {
    paddingBottom: Spacing.xxl,
  },
  emptyState: {
    alignItems: 'center',
    paddingHorizontal: Spacing.xl,
    paddingTop: Spacing.xxl,
  },
  emptyIconWrap: {
    width: 96,
    height: 96,
    borderRadius: 24,
    backgroundColor: Palette.warnSoft,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: Spacing.lg,
  },
  emptyTitle: {
    fontSize: Typography.sizes.xl,
    fontFamily: Typography.fontFamilies.bold,
    fontWeight: Typography.weights.bold,
    color: Colors.text.primary,
    marginBottom: Spacing.sm,
  },
  emptySubtitle: {
    fontSize: Typography.sizes.md,
    fontFamily: Typography.fontFamily,
    color: Colors.text.secondary,
    textAlign: 'center',
    marginBottom: Spacing.xl,
  },
  upgradeButton: {
    borderRadius: BorderRadius.lg,
    overflow: 'hidden',
    width: '100%',
  },
  upgradeButtonGradient: {
    paddingVertical: Spacing.md,
    alignItems: 'center',
  },
  upgradeButtonText: {
    fontSize: Typography.sizes.md,
    fontFamily: Typography.fontFamilies.bold,
    fontWeight: Typography.weights.bold,
    color: '#FFFFFF',
  },
  planCard: {
    backgroundColor: Palette.cardBg,
    marginHorizontal: Spacing.lg,
    marginTop: Spacing.lg,
    borderRadius: BorderRadius.xl,
    padding: Spacing.lg,
    ...Shadows.md,
  },
  planCardHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginBottom: Spacing.md,
  },
  planIconWrap: {
    width: 48,
    height: 48,
    borderRadius: 16,
    backgroundColor: Palette.warnSoft,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: Spacing.md,
  },
  planInfo: {
    flex: 1,
  },
  planName: {
    fontSize: Typography.sizes.xl,
    fontFamily: Typography.fontFamilies.bold,
    fontWeight: Typography.weights.bold,
    color: Colors.text.primary,
    marginBottom: 4,
  },
  planDescription: {
    fontSize: Typography.sizes.sm,
    fontFamily: Typography.fontFamily,
    color: Colors.text.secondary,
  },
  statusBadge: {
    paddingHorizontal: Spacing.sm,
    paddingVertical: 4,
    borderRadius: BorderRadius.sm,
  },
  statusText: {
    fontSize: Typography.sizes.xs,
    fontFamily: Typography.fontFamilies.semibold,
    fontWeight: Typography.weights.semibold,
  },
  cancelWarning: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    backgroundColor: Palette.warnSoft,
    padding: Spacing.md,
    borderRadius: BorderRadius.md,
    marginBottom: Spacing.md,
  },
  cancelWarningText: {
    flex: 1,
    fontSize: Typography.sizes.sm,
    fontFamily: Typography.fontFamily,
    color: Colors.text.primary,
  },
  planDetails: {
    gap: Spacing.sm,
  },
  detailRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: Spacing.xs,
  },
  detailLabel: {
    fontSize: Typography.sizes.sm,
    fontFamily: Typography.fontFamily,
    color: Colors.text.secondary,
  },
  detailValue: {
    fontSize: Typography.sizes.sm,
    fontFamily: Typography.fontFamilies.semibold,
    fontWeight: Typography.weights.semibold,
    color: Colors.text.primary,
  },
  featuresCard: {
    backgroundColor: Palette.cardBg,
    marginHorizontal: Spacing.lg,
    marginTop: Spacing.lg,
    borderRadius: BorderRadius.xl,
    padding: Spacing.lg,
    ...Shadows.md,
  },
  sectionTitle: {
    fontSize: Typography.sizes.md,
    fontFamily: Typography.fontFamilies.bold,
    fontWeight: Typography.weights.bold,
    color: Colors.text.primary,
    marginBottom: Spacing.md,
  },
  featuresList: {
    gap: Spacing.sm,
  },
  featureRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
  },
  featureText: {
    flex: 1,
    fontSize: Typography.sizes.sm,
    fontFamily: Typography.fontFamily,
    color: Colors.text.secondary,
  },
  actionsCard: {
    backgroundColor: Palette.cardBg,
    marginHorizontal: Spacing.lg,
    marginTop: Spacing.lg,
    borderRadius: BorderRadius.xl,
    padding: Spacing.lg,
    gap: Spacing.md,
    ...Shadows.md,
  },
  cancelButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.sm,
    paddingVertical: Spacing.md,
    borderRadius: BorderRadius.md,
    backgroundColor: Palette.errorSoft,
    borderWidth: 1,
    borderColor: Palette.error,
  },
  cancelButtonText: {
    fontSize: Typography.sizes.md,
    fontFamily: Typography.fontFamilies.semibold,
    fontWeight: Typography.weights.semibold,
    color: Palette.error,
  },
  reactivateButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.sm,
    paddingVertical: Spacing.md,
    borderRadius: BorderRadius.md,
    overflow: 'hidden',
  },
  reactivateButtonGradient: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.sm,
    paddingVertical: Spacing.md,
  },
  reactivateButtonText: {
    fontSize: Typography.sizes.md,
    fontFamily: Typography.fontFamilies.semibold,
    fontWeight: Typography.weights.semibold,
    color: '#FFFFFF',
  },
  changePlanButton: {
    paddingVertical: Spacing.md,
    borderRadius: BorderRadius.md,
    backgroundColor: Palette.accentSoft,
    alignItems: 'center',
  },
  changePlanButtonText: {
    fontSize: Typography.sizes.md,
    fontFamily: Typography.fontFamilies.semibold,
    fontWeight: Typography.weights.semibold,
    color: Palette.gradientStart,
  },
  paymentCard: {
    backgroundColor: Palette.cardBg,
    marginHorizontal: Spacing.lg,
    marginTop: Spacing.lg,
    borderRadius: BorderRadius.xl,
    padding: Spacing.lg,
    ...Shadows.md,
  },
  paymentHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    marginBottom: Spacing.md,
  },
  paymentNote: {
    fontSize: Typography.sizes.sm,
    fontFamily: Typography.fontFamily,
    color: Colors.text.secondary,
    marginBottom: Spacing.md,
    lineHeight: 20,
  },
  updatePaymentButton: {
    paddingVertical: Spacing.sm,
    alignItems: 'center',
  },
  updatePaymentText: {
    fontSize: Typography.sizes.sm,
    fontFamily: Typography.fontFamilies.semibold,
    fontWeight: Typography.weights.semibold,
    color: Palette.gradientStart,
  },
  footer: {
    marginTop: Spacing.xl,
    marginHorizontal: Spacing.lg,
    alignItems: 'center',
  },
  footerText: {
    fontSize: Typography.sizes.xs,
    fontFamily: Typography.fontFamily,
    color: Colors.text.tertiary,
    textAlign: 'center',
  },
});
