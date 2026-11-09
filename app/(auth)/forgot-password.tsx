import { useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { goBackOr } from '@/utils/navigation';
import { authService } from '@/services/auth';
import { TextField } from '@/components/ui/TextField';
import { Button } from '@/components/ui/Button';
import { authErrorMessage } from '@/utils/authErrors';
import { Colors, Spacing, Typography, alpha } from '@/constants/theme';
import {
  ArrowLeft,
  Mail,
  Send,
  CheckCircle,
  LogIn,
  KeyRound,
} from '@/components/icons.generated';
import { a11yState } from '@/utils/accessibility';

export default function ForgotPasswordScreen() {
  const insets = useSafeAreaInsets();
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Seconds left before the resend link re-enables after a send.
  const [resendCooldown, setResendCooldown] = useState(0);

  useEffect(() => {
    if (resendCooldown <= 0) return;
    const timer = setInterval(() => {
      setResendCooldown((s) => (s > 1 ? s - 1 : 0));
    }, 1000);
    return () => clearInterval(timer);
  }, [resendCooldown]);

  const validateEmail = () => {
    if (!email.trim()) {
      setError('Email is required');
      return false;
    }
    if (!/\S+@\S+\.\S+/.test(email.trim())) {
      setError('Please enter a valid email address');
      return false;
    }
    setError(null);
    return true;
  };

  const handleResetPassword = async () => {
    if (!validateEmail()) return;

    setLoading(true);
    setError(null);
    try {
      await authService.resetPassword(email.trim());
      setSent(true);
      setResendCooldown(30);
    } catch (err: unknown) {
      setError(authErrorMessage(err, 'Could not send the reset link. Please try again.'));
    } finally {
      setLoading(false);
    }
  };

  /* ── Success state ── */
  if (sent) {
    return (
      <View style={[styles.root, { paddingTop: insets.top }]}>
        <ScrollView
          contentContainerStyle={[
            styles.scrollContent,
            styles.scrollContentCentered,
            { paddingBottom: insets.bottom + 32 },
          ]}
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.successCenter}>
            {/* Success icon */}
            <View style={styles.successIconWrap}>
              <CheckCircle size={40} color={Colors.successText} />
            </View>

            <Text style={styles.successTitle}>Check Your Email</Text>
            <Text style={styles.successSubtitle}>
              We&apos;ve sent a password reset link to
            </Text>

            {/* Email badge */}
            <View style={styles.emailBadge}>
              <Mail size={14} color={Colors.primary} />
              <Text style={styles.emailBadgeText} numberOfLines={1} ellipsizeMode="middle">
                {email}
              </Text>
            </View>

            <Text style={styles.successHint}>
              Click the link in the email to set a new password. Check your spam
              folder if you don&apos;t see it.
            </Text>

            {/* Back to sign in */}
            <Button
              label="Back to Sign In"
              // Came from sign-in: go back to it. `replace` left the original
              // sign-in (with whatever was typed) underneath a second copy.
              onPress={() => goBackOr(router, '/(auth)/login')}
              size="lg"
              fullWidth
              gradient
              icon={<LogIn size={18} color="#FFFFFF" />}
            />

            {/* Resend — disabled for 30s after each send */}
            <TouchableOpacity
              style={styles.resendBtn}
              onPress={() => {
                setSent(false);
                setError(null);
              }}
              disabled={resendCooldown > 0}
              activeOpacity={0.7}
              accessibilityRole="button"
              accessibilityLabel={
                resendCooldown > 0 ? `Resend available in ${resendCooldown} seconds` : 'Try again'
              }
              {...a11yState({ disabled: resendCooldown > 0 })}
              hitSlop={{ top: 8, bottom: 8, left: 12, right: 12 }}
            >
              <Text
                style={[styles.resendBtnText, resendCooldown > 0 && styles.resendBtnTextDisabled]}
              >
                {resendCooldown > 0
                  ? `Resend in ${resendCooldown}s`
                  : "Didn't receive it? Try again"}
              </Text>
            </TouchableOpacity>
          </View>
        </ScrollView>
      </View>
    );
  }

  /* ── Form state ── */
  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        <ScrollView
          contentContainerStyle={[
            styles.scrollContent,
            { paddingBottom: insets.bottom + 32 },
          ]}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {/* Back */}
          <TouchableOpacity
            style={styles.backBtn}
            onPress={() => router.back()}
            activeOpacity={0.7}
            accessibilityRole="button"
            accessibilityLabel="Go back"
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <ArrowLeft size={22} color={Colors.text.primary} />
          </TouchableOpacity>

          {/* Hero */}
          <View style={styles.heroSection}>
            <View style={styles.heroIconWrap}>
              <LinearGradient
                colors={[Colors.primary, Colors.secondary]}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={styles.heroIconGradient}
              >
                <KeyRound size={28} color="#FFFFFF" />
              </LinearGradient>
            </View>
            <Text style={styles.heroTitle} accessibilityRole="header">Forgot Password?</Text>
            <Text style={styles.heroSubtitle}>
              No worries — enter your email and we&apos;ll{'\n'}send you a reset link
            </Text>
          </View>

          {/* Form card */}
          <View style={styles.formCard}>
            <TextField
              label="Email Address"
              value={email}
              onChangeText={(text) => {
                setEmail(text);
                setError(null);
              }}
              placeholder="your@email.com"
              error={error ?? undefined}
              leadingIcon={<Mail size={20} color={Colors.text.tertiary} />}
              keyboardType="email-address"
              autoCapitalize="none"
              autoCorrect={false}
              autoComplete="email"
              textContentType="emailAddress"
              returnKeyType="send"
              onSubmitEditing={handleResetPassword}
            />
          </View>

          {/* Submit */}
          <Button
            label="Send Reset Link"
            onPress={handleResetPassword}
            loading={loading}
            size="lg"
            fullWidth
            gradient
            icon={<Send size={18} color="#FFFFFF" />}
            style={styles.submitWrap}
          />

          {/* Back to sign in link */}
          <TouchableOpacity
            style={styles.backLinkBtn}
            onPress={() => router.back()}
            disabled={loading}
            activeOpacity={0.7}
            accessibilityRole="button"
            accessibilityLabel="Back to sign in"
            hitSlop={{ top: 8, bottom: 8, left: 12, right: 12 }}
          >
            <LogIn size={16} color={Colors.primary} />
            <Text style={styles.backLinkText}>Back to Sign In</Text>
          </TouchableOpacity>
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

/* ────────────────────────── STYLES ────────────────────────── */

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: Colors.background.primary,
  },
  flex: {
    flex: 1,
  },
  scrollContent: {
    flexGrow: 1,
    paddingHorizontal: 24,
  },
  scrollContentCentered: {
    justifyContent: 'center',
  },

  /* ── Back button ── */
  backBtn: {
    width: 44,
    height: 44,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.surface,
    marginTop: 12,
  },

  /* ── Hero ── */
  heroSection: {
    alignItems: 'center',
    marginTop: 36,
    marginBottom: 36,
  },
  heroIconWrap: {
    marginBottom: 20,
    ...Platform.select({
      ios: {
        shadowColor: Colors.primary,
        shadowOffset: { width: 0, height: 6 },
        shadowOpacity: 0.25,
        shadowRadius: 16,
      },
      android: { elevation: 8 },
    }),
  },
  heroIconGradient: {
    width: 72,
    height: 72,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
  },
  heroTitle: {
    fontSize: Typography.sizes.xxl,
    fontFamily: Typography.displayFontFamilies.extrabold,
    fontWeight: Typography.weights.extrabold,
    color: Colors.text.primary,
    marginBottom: 8,
  },
  heroSubtitle: {
    fontSize: Typography.sizes.md,
    fontFamily: Typography.fontFamily,
    color: Colors.text.tertiary,
    textAlign: 'center',
    lineHeight: 22,
  },

  /* ── Form card ── */
  formCard: {
    backgroundColor: Colors.surface,
    borderRadius: 40,
    padding: 22,
    borderWidth: 1,
    borderColor: alpha('#000000', 0.04),
  },

  /* ── Submit ── */
  submitWrap: {
    marginTop: Spacing.lg,
    ...Platform.select({
      ios: {
        shadowColor: Colors.primary,
        shadowOffset: { width: 0, height: 6 },
        shadowOpacity: 0.3,
        shadowRadius: 14,
      },
      android: { elevation: 8 },
    }),
  },

  /* ── Back link ── */
  backLinkBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    marginTop: 24,
    paddingVertical: 12,
  },
  backLinkText: {
    fontSize: Typography.sizes.md,
    fontFamily: Typography.fontFamilies.semibold,
    fontWeight: Typography.weights.semibold,
    color: Colors.primary,
  },

  /* ── Success state ── */
  successCenter: {
    alignItems: 'center',
    paddingHorizontal: 16,
  },
  successIconWrap: {
    width: 88,
    height: 88,
    borderRadius: 28,
    backgroundColor: Colors.successSoft,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 24,
  },
  successTitle: {
    fontSize: Typography.sizes.xl,
    fontFamily: Typography.displayFontFamilies.bold,
    fontWeight: Typography.weights.bold,
    color: Colors.text.primary,
    marginBottom: 8,
  },
  successSubtitle: {
    fontSize: Typography.sizes.md,
    fontFamily: Typography.fontFamily,
    color: Colors.text.secondary,
    textAlign: 'center',
    marginBottom: 12,
  },
  emailBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: Colors.primarySoft,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 12,
    marginBottom: 16,
  },
  emailBadgeText: {
    flexShrink: 1,
    fontSize: Typography.sizes.sm,
    fontFamily: Typography.fontFamilies.semibold,
    fontWeight: Typography.weights.semibold,
    color: Colors.primary,
  },
  successHint: {
    fontSize: Typography.sizes.sm,
    fontFamily: Typography.fontFamily,
    color: Colors.text.tertiary,
    textAlign: 'center',
    lineHeight: 20,
    marginBottom: 28,
    paddingHorizontal: 8,
  },
  resendBtn: {
    marginTop: 18,
    paddingVertical: 8,
  },
  resendBtnText: {
    fontSize: Typography.sizes.sm,
    fontFamily: Typography.fontFamilies.medium,
    fontWeight: Typography.weights.medium,
    color: Colors.primary,
  },
  resendBtnTextDisabled: {
    color: Colors.text.tertiary,
  },
});