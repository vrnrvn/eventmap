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
import { TextField } from '@/components/ui/TextField';
import { Colors, Typography, Spacing } from '@/constants/theme';
import { ArrowLeft, Lock, KeyRound, LogIn } from '@/components/icons.generated';

export default function ResetPasswordScreen() {
  const insets = useSafeAreaInsets();
  const { mode } = useLocalSearchParams<{ mode?: string }>();
  const isChangeMode = (Array.isArray(mode) ? mode[0] : mode) === 'change';

  const [currentPassword, setCurrentPassword] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
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
  const [cancelling, setCancelling] = useState(false);

  // Recovery mode otherwise has no way out: sign out of the recovery session
  // and route back to login, same as the expired-link state does.
  const handleCancelRecovery = async () => {
    setCancelling(true);
    try {
      await authService.signOut();
    } catch {
      // Even if sign-out fails, send the user back to the sign-in screen.
    } finally {
      setCancelling(false);
    }
    router.replace('/(auth)/login');
  };

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
        <ActivityIndicator color={Colors.primary} accessibilityLabel="Loading" />
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
              <TextField
                label="Current Password"
                value={currentPassword}
                onChangeText={setCurrentPassword}
                placeholder="••••••••"
                error={errors.current}
                leadingIcon={<Lock size={20} color={Colors.text.tertiary} />}
                secureTextEntry
                autoCapitalize="none"
                autoCorrect={false}
                autoComplete="current-password"
                textContentType="password"
                returnKeyType="next"
                submitBehavior="submit"
                onSubmitEditing={() => passwordRef.current?.focus()}
              />
            ) : null}

            <TextField
              ref={passwordRef}
              label="New Password"
              containerStyle={requiresCurrentPassword ? styles.fieldSpacing : undefined}
              value={password}
              onChangeText={setPassword}
              placeholder="••••••••"
              error={errors.password}
              leadingIcon={<Lock size={20} color={Colors.text.tertiary} />}
              secureTextEntry
              autoCapitalize="none"
              autoCorrect={false}
              autoComplete="new-password"
              textContentType="newPassword"
              returnKeyType="next"
              submitBehavior="submit"
              onSubmitEditing={() => confirmRef.current?.focus()}
            />

            <TextField
              ref={confirmRef}
              label="Confirm Password"
              containerStyle={styles.fieldSpacing}
              value={confirmPassword}
              onChangeText={setConfirmPassword}
              placeholder="••••••••"
              error={errors.confirm}
              leadingIcon={<Lock size={20} color={Colors.text.tertiary} />}
              secureTextEntry
              autoCapitalize="none"
              autoCorrect={false}
              autoComplete="new-password"
              textContentType="newPassword"
              returnKeyType="go"
              onSubmitEditing={handleSubmit}
            />

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

          {!isChangeMode ? (
            <TouchableOpacity
              style={styles.cancelLink}
              onPress={handleCancelRecovery}
              disabled={loading || cancelling}
              activeOpacity={0.7}
              accessibilityRole="button"
              accessibilityLabel="Cancel and go back to sign in"
              hitSlop={{ top: 8, bottom: 8, left: 12, right: 12 }}
            >
              <Text style={styles.cancelLinkText}>
                {cancelling ? 'Signing out…' : 'Cancel and back to sign in'}
              </Text>
            </TouchableOpacity>
          ) : null}
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
    width: 44,
    height: 44,
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
    fontWeight: Typography.weights.extrabold,
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
  fieldSpacing: { marginTop: Spacing.md },
  ctaWrap: { marginTop: Spacing.lg, alignSelf: 'stretch' },
  cancelLink: {
    alignSelf: 'center',
    marginTop: Spacing.lg,
    paddingVertical: Spacing.sm,
  },
  cancelLinkText: {
    fontSize: Typography.sizes.sm,
    fontFamily: Typography.fontFamilies.semibold,
    fontWeight: Typography.weights.semibold,
    color: Colors.text.secondary,
  },
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
