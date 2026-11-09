import { useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import {
  Crown,
  CreditCard,
  Check,
} from '@/components/icons.generated';
import { usePremium } from '@/contexts/PremiumContext';
import { notify, notifyConfirm } from '@/utils/notify';
import { Button } from '@/components/ui/Button';
import { ScreenHeader } from '@/components/ui/ScreenHeader';
import { useApp } from '@/contexts/AppContext';
import { premiumService } from '@/services/premium';
import { Colors, Spacing, Typography, BorderRadius, Shadows } from '@/constants/theme';
import * as WebBrowser from 'expo-web-browser';
import { a11yState } from '@/utils/accessibility';

const STRIPE_PORTAL_URL = process.env.EXPO_PUBLIC_STRIPE_CUSTOMER_PORTAL_URL?.trim();

const Palette = {
  gradientStart: Colors.primary,
  cardBg: Colors.surface,
  surfaceMuted: Colors.background.secondary,
  accentSoft: Colors.primarySoft,
  separator: Colors.border.light,
  premium: Colors.premium,
  premiumSoft: Colors.premiumSoft,
  success: Colors.success,
  successSoft: Colors.successSoft,
  error: Colors.error,
  errorSoft: Colors.errorSoft,
};

export default function ManageSubscriptionScreen() {
  const insets = useSafeAreaInsets();
  const { userBusiness, refreshBusiness } = useApp();
  const {
    subscription,
    currentPlan,
    isPremium,
  } = usePremium();
  const [canceling, setCanceling] = useState(false);

  const formatDate = (dateString: string | null) => {
    if (!dateString) return 'N/A';
    return new Date(dateString).toLocaleDateString(undefined, {
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
    if (!subscription || !userBusiness) return;

    notifyConfirm({
      title: 'Cancel Subscription',
      message:
        'Are you sure you want to cancel? Since this is a simulated subscription with no payment, Pro features are removed immediately and your business goes back to the Free plan.',
      cancelLabel: 'Keep Subscription',
      confirmLabel: 'Cancel Subscription',
      destructive: true,
      onConfirm: async () => {
        setCanceling(true);
        try {
          await premiumService.cancelSubscription(userBusiness.id);
          // refreshSubscription is the same business-row refresh; one call.
          await refreshBusiness();
        } catch (err) {
          console.error('Failed to cancel:', err);
          notify.error('Failed to cancel subscription. Please try again.');
        } finally {
          setCanceling(false);
        }
      },
    });
  }, [subscription, userBusiness, refreshBusiness]);

  const handleUpgrade = useCallback(() => {
    router.push('/premium/plans' as never);
  }, []);

  if (!isPremium && !subscription) {
    return (
      <View style={[styles.container, { paddingTop: insets.top }]}>
        <ScreenHeader
          title="Subscription"
          safeArea={false}
          backgroundColor={Palette.cardBg}
          style={styles.headerBorder}
        />
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.emptyState}>
            <View style={styles.emptyIconWrap}>
              <Crown size={48} color={Palette.premium} />
            </View>
            <Text style={styles.emptyTitle}>No Active Subscription</Text>
            <Text style={styles.emptySubtitle}>
              You&apos;re currently on the free plan. Upgrade to unlock premium features!
            </Text>
            <Button label="View Plans" onPress={handleUpgrade} fullWidth gradient />
          </View>
        </ScrollView>
      </View>
    );
  }

  const statusColor = Palette.success;

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <ScreenHeader
        title="Manage Subscription"
        safeArea={false}
        backgroundColor={Palette.cardBg}
        style={styles.headerBorder}
      />

      <ScrollView
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {/* Current plan card */}
        <View style={styles.planCard}>
          <View style={styles.planCardHeader}>
            <View style={styles.planIconWrap}>
              <Crown size={24} color={Palette.premium} />
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
              {/* successText (not the lighter success) keeps 12 px text ≥ 4.5:1 on the tint. */}
              <Text style={[styles.statusText, { color: Colors.successText }]}>
                Active
              </Text>
            </View>
          </View>

          <View style={styles.planDetails}>
            <View style={styles.detailRow}>
              <Text style={styles.detailLabel}>Plan Price</Text>
              <Text style={styles.detailValue}>
                {formatPrice(currentPlan?.price_monthly ?? 0)}/month
              </Text>
            </View>
            {subscription?.current_period_end && (
              <View style={styles.detailRow}>
                <Text style={styles.detailLabel}>Expires On</Text>
                <Text style={styles.detailValue}>
                  {formatDate(subscription.current_period_end)}
                </Text>
              </View>
            )}
            <View style={styles.detailRow}>
              <Text style={styles.detailLabel}>Renewal</Text>
              <Text style={styles.detailValue}>
                Does not auto-renew (simulated plan)
              </Text>
            </View>
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

        {/* Actions — Change Plan is the primary action; cancel is a quiet
            destructive outline below it. */}
        <View style={styles.actionsCard}>
          <Button
            label="Change Plan"
            onPress={handleUpgrade}
            variant="primary"
            fullWidth
          />

          <TouchableOpacity
            style={styles.cancelButton}
            onPress={handleCancel}
            disabled={canceling}
            activeOpacity={0.7}
            accessibilityRole="button"
            accessibilityLabel="Cancel Subscription"
            {...a11yState({ disabled: canceling, busy: canceling })}
          >
            {canceling ? (
              <ActivityIndicator color={Palette.error} />
            ) : (
              <Text style={styles.cancelButtonText}>Cancel Subscription</Text>
            )}
          </TouchableOpacity>
        </View>

        {/* Payment method */}
        <View style={styles.paymentCard}>
          <View style={styles.paymentHeader}>
            <CreditCard size={20} color={Colors.text.primary} />
            <Text style={styles.sectionTitle}>Payment Method</Text>
          </View>
          {STRIPE_PORTAL_URL ? (
            <>
              <Text style={styles.paymentNote}>
                Update your card on Stripe’s secure billing portal.
              </Text>
              <TouchableOpacity
                style={styles.updatePaymentButton}
                onPress={() => {
                  void WebBrowser.openBrowserAsync(STRIPE_PORTAL_URL);
                }}
                activeOpacity={0.7}
              >
                <Text style={styles.updatePaymentText}>Open Stripe billing</Text>
              </TouchableOpacity>
            </>
          ) : (
            <Text style={styles.paymentNote}>
              Self-serve card updates are not enabled for this build yet. Email
              support@eventmap.com and we’ll help you update billing, or set
              EXPO_PUBLIC_STRIPE_CUSTOMER_PORTAL_URL to your Stripe Customer Portal link.
            </Text>
          )}
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
  headerBorder: {
    borderBottomWidth: 1,
    borderBottomColor: Palette.separator,
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
    backgroundColor: Palette.premiumSoft,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: Spacing.lg,
  },
  emptyTitle: {
    fontSize: Typography.sizes.xl,
    fontFamily: Typography.displayFontFamilies.bold,
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
    backgroundColor: Palette.premiumSoft,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: Spacing.md,
  },
  planInfo: {
    flex: 1,
  },
  planName: {
    fontSize: Typography.sizes.xl,
    fontFamily: Typography.displayFontFamilies.bold,
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
    minHeight: 48,
    borderRadius: BorderRadius.round,
    borderWidth: 1.5,
    borderColor: Palette.error,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: Spacing.lg,
  },
  cancelButtonText: {
    fontSize: Typography.sizes.md,
    fontFamily: Typography.fontFamilies.bold,
    fontWeight: Typography.weights.bold,
    color: Palette.error,
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
