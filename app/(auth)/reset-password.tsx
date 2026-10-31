import { useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  ActivityIndicator,
  TextInput,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { authService } from '@/services/auth';
import { notify } from '@/utils/notify';
import { authErrorMessage } from '@/utils/authErrors';
import { Button } from '@/components/ui/Button';
import { Colors, Typography, BorderRadius, Spacing } from '@/constants/theme';
import { ArrowLeft, Eye, EyeOff, Lock, KeyRound, LogIn } from 'lucide-react-native';

const EYE_HIT_SLOP = { top: 10, bottom: 10, left: 10, right: 10 };

export default function ResetPasswordScreen() {
  const insets = useSafeAreaInsets();
  const { mode } = useLocalSearchParams<{ mode?: string }>();
  const isChangeMode = (Array.isArray(mode) ? mode[0] : mode) === 'change';

  const [currentPassword, setCurrentPassword] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showCurrent, setShowCurrent] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [loading, setLoading] = useState(false);
  const [checkingSession, setCheckingSession] = useState(true);
  const [hasSession, setHasSession] = useState(false);
  // Change mode only: false for OAuth-only accounts setting a first password.
  const [needsCurrentPassword, setNeedsCurrentPassword] = useState(true);
  const [errors, setErrors] = useState<{
    current?: string;
    password?: string;
    confirm?: string;
  }>({});
  const passwordRef = useRef<TextInput>(null);
  const confirmRef = useRef<TextInput>(null);

  useEffect(() => {
    let cancelled = false;
    authService
      .getSession()
      .then(async (session) => {
        if (cancelled) return;
        setHasSession(!!session);
        // An OAuth-only account has no existing password to re-verify; asking
        // for one would lock them out of setting their first.
        if (session && isChangeMode) {
          try {
            const hasPassword = await authService.hasPasswordIdentity();
            if (!cancelled) setNeedsCurrentPassword(hasPassword);
          } catch {
            // Can't tell — keep the stricter path rather than skipping it.
            if (!cancelled) setNeedsCurrentPassword(true);
          }
        }
      })
      .catch(() => {
        if (!cancelled) setHasSession(false);
      })
      .finally(() => {
        if (!cancelled) setCheckingSession(false);
      });
    return () => {
      cancelled = true;
    };
  }, [isChangeMode]);

  // Recovery mode proves possession of the emailed link, so there is nothing to
  // re-verify. Change mode has no such proof — unless the account has no
  // password yet (OAuth-only), in which case there is none to ask for.
  const requiresCurrentPassword = isChangeMode && needsCurrentPassword;

  const validate = () => {
    const next: { current?: string; password?: string; confirm?: string } = {};
    if (requiresCurrentPassword && !currentPassword) {
      next.current = 'Current password is required';
    }
    if (!password) next.password = 'Password is required';
    else if (password.length < 8) next.password = 'Minimum 8 characters';
    else if (requiresCurrentPassword && password === currentPassword) {
      next.password = 'New password must be different from the current one';
    }
    if (confirmPassword !== password) next.confirm = 'Passwords do not match';
    setErrors(next);
    return Object.keys(next).length === 0;
  };

  const handleSubmit = async () => {
    if (!validate()) return;
    setLoading(true);
    try {
      // Supabase's updateUser does not require the existing password, so for an
      // already-signed-in user this re-verification is the only thing standing
      // between someone holding an unlocked phone and an account takeover.
      if (requiresCurrentPassword) {
        const verified = await authService.verifyCurrentPassword(currentPassword);
        if (!verified) {
          setErrors({ current: 'That password is incorrect' });
          return;
        }
      }
      await authService.updatePassword(password);
      notify.success(isChangeMode ? 'Password changed.' : 'Password updated. You are signed in.');
      if (isChangeMode) router.back();
      else router.replace('/');
    } catch (error: unknown) {
      notify.error(authErrorMessage(error, 'Could not update password. Please try again.'));
    } finally {
      setLoading(false);
    }
  };

  if (checkingSession) {
    return (
      <View style={[styles.root, styles.center]}>
        <ActivityIndicator color={Colors.primary} />
      </View>
    );
  }

  /* Link expired / invalid — no authenticated session to update. */
  if (!hasSession) {
    return (
      <View style={[styles.root, styles.center, { paddingHorizontal: Spacing.lg }]}>
        <View style={styles.heroIconTile}>
          <KeyRound size={28} color={Colors.primary} />
        </View>
        <Text style={styles.expiredTitle}>Link expired</Text>
        <Text style={styles.expiredText}>
          This password reset link is invalid or has expired. Request a new one from the sign-in
          screen.
        </Text>
        <Button
          label="Back to Login"
          onPress={() => router.replace('/(auth)/login')}
          size="lg"
          fullWidth
          gradient
          icon={<LogIn size={18} color="#FFFFFF" />}
          style={styles.ctaWrap}
        />
      </View>
    );
  }

  return (
    <View style={styles.root}>
      <View style={styles.bgGlowTop} />
      <View style={styles.bgGlowBottom} />
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        <ScrollView
          contentContainerStyle={{
            paddingTop: insets.top + 10,
            paddingBottom: insets.bottom + 24,
            paddingHorizontal: Spacing.lg,
          }}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {isChangeMode ? (
            <TouchableOpacity
              style={styles.backBtn}
              onPress={() => router.back()}
              activeOpacity={0.75}
              accessibilityRole="button"
              accessibilityLabel="Go back"
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              <ArrowLeft size={20} color={Colors.text.primary} />
            </TouchableOpacity>
          ) : null}

          <View style={styles.hero}>
            <View style={styles.heroIconTile}>
              <KeyRound size={32} color={Colors.primary} />
            </View>
            <Text style={styles.heroTitle}>
              {isChangeMode ? 'Change Password' : 'Set New Password'}
            </Text>
            <Text style={styles.heroSub}>
              {isChangeMode
                ? 'Choose a new password for your account'
                : 'Choose a new password to finish resetting your account'}
            </Text>
          </View>

          <View style={styles.card}>
            {requiresCurrentPassword ? (
              <>
                <Text style={styles.fieldLabel}>Current Password</Text>
                <View style={styles.inputShell}>
                  <Lock size={20} color={Colors.text.tertiary} />
                  <TextInput
                    value={currentPassword}
                    onChangeText={setCurrentPassword}
                    placeholder="••••••••"
                    placeholderTextColor={Colors.text.tertiary}
                    secureTextEntry={!showCurrent}
                    autoCapitalize="none"
                    autoCorrect={false}
                    autoComplete="current-password"
                    textContentType="password"
                    returnKeyType="next"
                    submitBehavior="submit"
                    onSubmitEditing={() => passwordRef.current?.focus()}
                    style={styles.input}
                  />
                  <TouchableOpacity
                    onPress={() => setShowCurrent((v) => !v)}
                    hitSlop={EYE_HIT_SLOP}
                    accessibilityRole="button"
                    accessibilityLabel={showCurrent ? 'Hide password' : 'Show password'}
                  >
                    {showCurrent ? (
                      <EyeOff size={21} color={Colors.text.tertiary} />
                    ) : (
                      <Eye size={21} color={Colors.text.tertiary} />
                    )}
                  </TouchableOpacity>
                </View>
                {errors.current ? <Text style={styles.errorText}>{errors.current}</Text> : null}
              </>
            ) : null}

            <Text style={[styles.fieldLabel, requiresCurrentPassword && { marginTop: 16 }]}>
              New Password
            </Text>
            <View style={styles.inputShell}>
              <Lock size={20} color={Colors.text.tertiary} />
              <TextInput
                ref={passwordRef}
                value={password}
                onChangeText={setPassword}
                placeholder="••••••••"
                placeholderTextColor={Colors.text.tertiary}
                secureTextEntry={!showPassword}
                autoCapitalize="none"
                autoCorrect={false}
                autoComplete="new-password"
                textContentType="newPassword"
                returnKeyType="next"
                submitBehavior="submit"
                onSubmitEditing={() => confirmRef.current?.focus()}
                style={styles.input}
              />
              <TouchableOpacity
                onPress={() => setShowPassword((v) => !v)}
                hitSlop={EYE_HIT_SLOP}
                accessibilityRole="button"
                accessibilityLabel={showPassword ? 'Hide password' : 'Show password'}
              >
                {showPassword ? (
                  <EyeOff size={21} color={Colors.text.tertiary} />
                ) : (
                  <Eye size={21} color={Colors.text.tertiary} />
                )}
              </TouchableOpacity>
            </View>
            {errors.password ? <Text style={styles.errorText}>{errors.password}</Text> : null}

            <Text style={[styles.fieldLabel, { marginTop: 16 }]}>Confirm Password</Text>
            <View style={styles.inputShell}>
              <Lock size={20} color={Colors.text.tertiary} />
              <TextInput
                ref={confirmRef}
                value={confirmPassword}
                onChangeText={setConfirmPassword}
                placeholder="••••••••"
                placeholderTextColor={Colors.text.tertiary}
                secureTextEntry={!showConfirm}
                autoCapitalize="none"
                autoCorrect={false}
                autoComplete="new-password"
                textContentType="newPassword"
                returnKeyType="go"
                onSubmitEditing={handleSubmit}
                style={styles.input}
              />
              <TouchableOpacity
                onPress={() => setShowConfirm((v) => !v)}
                hitSlop={EYE_HIT_SLOP}
                accessibilityRole="button"
                accessibilityLabel={showConfirm ? 'Hide password' : 'Show password'}
              >
                {showConfirm ? (
                  <EyeOff size={21} color={Colors.text.tertiary} />
                ) : (
                  <Eye size={21} color={Colors.text.tertiary} />
                )}
              </TouchableOpacity>
            </View>
            {errors.confirm ? <Text style={styles.errorText}>{errors.confirm}</Text> : null}

            <Button
              label={isChangeMode ? 'Change Password' : 'Set Password'}
              onPress={handleSubmit}
              loading={loading}
              size="lg"
              fullWidth
              gradient
              style={styles.ctaWrap}
            />
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: Colors.background.primary },
  flex: { flex: 1 },
  center: { alignItems: 'center', justifyContent: 'center' },
  backBtn: {
    width: 42,
    height: 42,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.surface,
  },
  hero: { alignItems: 'center', marginTop: 18, marginBottom: 18 },
  heroIconTile: {
    width: 86,
    height: 86,
    borderRadius: 26,
    backgroundColor: Colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 18,
  },
  heroTitle: {
    fontSize: Typography.sizes.xxl,
    lineHeight: 38,
    color: Colors.text.primary,
    fontFamily: Typography.displayFontFamilies.extrabold,
    fontWeight: '800',
    letterSpacing: -0.6,
    textAlign: 'center',
  },
  heroSub: {
    marginTop: 6,
    fontSize: Typography.sizes.md,
    lineHeight: 24,
    color: Colors.text.secondary,
    fontFamily: Typography.fontFamilies.medium,
    textAlign: 'center',
  },
  card: {
    backgroundColor: Colors.surface,
    borderRadius: 40,
    padding: 22,
    borderWidth: 1,
    borderColor: Colors.border.light,
  },
  fieldLabel: {
    marginBottom: 10,
    color: Colors.text.secondary,
    fontSize: Typography.sizes.xs,
    letterSpacing: 1.8,
    textTransform: 'uppercase',
    fontFamily: Typography.labelFontFamilies.semibold,
  },
  inputShell: {
    height: 60,
    borderRadius: BorderRadius.round,
    backgroundColor: Colors.background.secondary,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 18,
    gap: 10,
  },
  input: {
    flex: 1,
    color: Colors.text.primary,
    fontSize: Typography.sizes.md,
    fontFamily: Typography.fontFamilies.medium,
  },
  errorText: {
    marginTop: 6,
    marginLeft: 4,
    color: Colors.error,
    fontSize: Typography.sizes.xs,
    fontFamily: Typography.fontFamilies.medium,
  },
  ctaWrap: { marginTop: Spacing.lg, alignSelf: 'stretch' },
  expiredTitle: {
    fontSize: 28,
    color: Colors.text.primary,
    fontFamily: Typography.displayFontFamilies.bold,
    fontWeight: Typography.weights.bold,
    marginBottom: 8,
    textAlign: 'center',
  },
  expiredText: {
    fontSize: Typography.sizes.md,
    color: Colors.text.secondary,
    fontFamily: Typography.fontFamilies.medium,
    textAlign: 'center',
    lineHeight: 24,
  },
  bgGlowTop: {
    position: 'absolute',
    width: 280,
    height: 280,
    borderRadius: 140,
    backgroundColor: Colors.primarySoft,
    top: -80,
    left: -80,
  },
  bgGlowBottom: {
    position: 'absolute',
    width: 320,
    height: 320,
    borderRadius: 160,
    backgroundColor: Colors.primarySoft,
    bottom: -120,
    right: -90,
  },
});
