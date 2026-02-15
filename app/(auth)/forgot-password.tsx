import { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  ActivityIndicator,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { authService } from '@/services/auth';
import { Input } from '@/components/Input';
import { Colors, Spacing, Typography, BorderRadius } from '@/constants/theme';
import {
  ArrowLeft,
  Mail,
  Send,
  CheckCircle,
  LogIn,
  KeyRound,
} from 'lucide-react-native';

const Palette = {
  gradientStart: '#6366F1',
  gradientEnd: '#8B5CF6',
  cardBg: '#FFFFFF',
  surfaceMuted: '#F8F9FC',
  accentSoft: 'rgba(99,102,241,0.08)',
  accentMedium: 'rgba(99,102,241,0.14)',
  textOnGradient: '#FFFFFF',
  textOnGradientMuted: 'rgba(255,255,255,0.75)',
  separator: '#F0F0F5',
  badge: '#6366F1',
  successSoft: 'rgba(34,197,94,0.10)',
  successColor: '#22C55E',
};

export default function ForgotPasswordScreen() {
  const insets = useSafeAreaInsets();
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const validateEmail = () => {
    if (!email) {
      setError('Email is required');
      return false;
    }
    if (!/\S+@\S+\.\S+/.test(email)) {
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
      await authService.resetPassword(email);
      setSent(true);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Please try again';
      setError(message);
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
          {/* Back */}
          <TouchableOpacity
            style={styles.backBtn}
            onPress={() => router.back()}
            activeOpacity={0.7}
          >
            <ArrowLeft size={22} color={Colors.text.primary} />
          </TouchableOpacity>

          <View style={styles.successCenter}>
            {/* Success icon */}
            <View style={styles.successIconWrap}>
              <CheckCircle size={40} color={Palette.successColor} />
            </View>

            <Text style={styles.successTitle}>Check Your Email</Text>
            <Text style={styles.successSubtitle}>
              We've sent a password reset link to
            </Text>

            {/* Email badge */}
            <View style={styles.emailBadge}>
              <Mail size={14} color={Palette.gradientStart} />
              <Text style={styles.emailBadgeText}>{email}</Text>
            </View>

            <Text style={styles.successHint}>
              Click the link in the email to set a new password. Check your spam
              folder if you don't see it.
            </Text>

            {/* Back to sign in */}
            <TouchableOpacity
              style={styles.successBtnWrap}
              onPress={() => router.replace('/(auth)/login')}
              activeOpacity={0.85}
            >
              <LinearGradient
                colors={[Palette.gradientStart, Palette.gradientEnd]}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 0 }}
                style={styles.successBtnGradient}
              >
                <LogIn size={18} color="#FFFFFF" />
                <Text style={styles.successBtnText}>Back to Sign In</Text>
              </LinearGradient>
            </TouchableOpacity>

            {/* Resend */}
            <TouchableOpacity
              style={styles.resendBtn}
              onPress={() => {
                setSent(false);
                setError(null);
              }}
              activeOpacity={0.7}
            >
              <Text style={styles.resendBtnText}>
                Didn't receive it? Try again
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
          >
            <ArrowLeft size={22} color={Colors.text.primary} />
          </TouchableOpacity>

          {/* Hero */}
          <View style={styles.heroSection}>
            <View style={styles.heroIconWrap}>
              <LinearGradient
                colors={[Palette.gradientStart, Palette.gradientEnd]}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={styles.heroIconGradient}
              >
                <KeyRound size={28} color="#FFFFFF" />
              </LinearGradient>
            </View>
            <Text style={styles.heroTitle}>Forgot Password?</Text>
            <Text style={styles.heroSubtitle}>
              No worries — enter your email and we'll{'\n'}send you a reset link
            </Text>
          </View>

          {/* Form card */}
          <View style={styles.formCard}>
            <View style={styles.fieldRow}>
              <View style={styles.fieldIcon}>
                <Mail size={16} color={Palette.gradientStart} />
              </View>
              <View style={styles.fieldContent}>
                <Input
                  label="Email Address"
                  value={email}
                  onChangeText={(text) => {
                    setEmail(text);
                    setError(null);
                  }}
                  placeholder="your@email.com"
                  keyboardType="email-address"
                  autoCapitalize="none"
                  error={error ?? undefined}
                />
              </View>
            </View>
          </View>

          {/* Submit */}
          <TouchableOpacity
            style={styles.submitWrap}
            onPress={handleResetPassword}
            disabled={loading}
            activeOpacity={0.85}
          >
            <LinearGradient
              colors={
                loading
                  ? ['#A5B4FC', '#C4B5FD']
                  : [Palette.gradientStart, Palette.gradientEnd]
              }
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 0 }}
              style={styles.submitGradient}
            >
              {loading ? (
                <ActivityIndicator color="#FFFFFF" />
              ) : (
                <>
                  <Send size={18} color="#FFFFFF" />
                  <Text style={styles.submitText}>Send Reset Link</Text>
                </>
              )}
            </LinearGradient>
          </TouchableOpacity>

          {/* Back to sign in link */}
          <TouchableOpacity
            style={styles.backLinkBtn}
            onPress={() => router.back()}
            disabled={loading}
            activeOpacity={0.7}
          >
            <LogIn size={16} color={Palette.gradientStart} />
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
    backgroundColor: Palette.surfaceMuted,
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
    backgroundColor: Palette.cardBg,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 12,
    ...Platform.select({
      ios: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.06,
        shadowRadius: 8,
      },
      android: { elevation: 3 },
    }),
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
        shadowColor: Palette.gradientStart,
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
    fontSize: 28,
    fontFamily: Typography.fontFamilies.bold,
    fontWeight: Typography.weights.bold,
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
    backgroundColor: Palette.cardBg,
    borderRadius: 22,
    overflow: 'hidden',
    ...Platform.select({
      ios: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 3 },
        shadowOpacity: 0.07,
        shadowRadius: 12,
      },
      android: { elevation: 4 },
    }),
  },
  fieldRow: {
    flexDirection: 'row',
    paddingHorizontal: 18,
    paddingVertical: 18,
    gap: 14,
  },
  fieldIcon: {
    width: 38,
    height: 38,
    borderRadius: 11,
    backgroundColor: Palette.accentSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  fieldContent: {
    flex: 1,
  },

  /* ── Submit ── */
  submitWrap: {
    marginTop: 24,
    borderRadius: 16,
    overflow: 'hidden',
    ...Platform.select({
      ios: {
        shadowColor: Palette.gradientStart,
        shadowOffset: { width: 0, height: 6 },
        shadowOpacity: 0.3,
        shadowRadius: 14,
      },
      android: { elevation: 8 },
    }),
  },
  submitGradient: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    paddingVertical: 17,
  },
  submitText: {
    fontSize: Typography.sizes.lg,
    fontFamily: Typography.fontFamilies.bold,
    fontWeight: Typography.weights.bold,
    color: '#FFFFFF',
    letterSpacing: 0.3,
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
    color: Palette.gradientStart,
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
    backgroundColor: Palette.successSoft,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 24,
  },
  successTitle: {
    fontSize: 26,
    fontFamily: Typography.fontFamilies.bold,
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
    backgroundColor: Palette.accentSoft,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 12,
    marginBottom: 16,
  },
  emailBadgeText: {
    fontSize: Typography.sizes.sm,
    fontFamily: Typography.fontFamilies.semibold,
    fontWeight: Typography.weights.semibold,
    color: Palette.gradientStart,
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
  successBtnWrap: {
    width: '100%',
    borderRadius: 16,
    overflow: 'hidden',
    ...Platform.select({
      ios: {
        shadowColor: Palette.gradientStart,
        shadowOffset: { width: 0, height: 6 },
        shadowOpacity: 0.3,
        shadowRadius: 14,
      },
      android: { elevation: 8 },
    }),
  },
  successBtnGradient: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    paddingVertical: 17,
  },
  successBtnText: {
    fontSize: Typography.sizes.lg,
    fontFamily: Typography.fontFamilies.bold,
    fontWeight: Typography.weights.bold,
    color: '#FFFFFF',
    letterSpacing: 0.3,
  },
  resendBtn: {
    marginTop: 18,
    paddingVertical: 8,
  },
  resendBtnText: {
    fontSize: Typography.sizes.sm,
    fontFamily: Typography.fontFamilies.medium,
    fontWeight: Typography.weights.medium,
    color: Palette.gradientStart,
  },
});