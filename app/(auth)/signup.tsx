import { useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  Image,
  TextInput,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { isHostIntentParam, markPendingHostIntent } from '@/utils/hostIntent';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/Button';
import { TextField } from '@/components/ui/TextField';
import { Colors, Typography, BorderRadius, Spacing, alpha } from '@/constants/theme';
import { ArrowLeft, ArrowRight, Mail, Lock } from '@/components/icons.generated';
import { GoogleIcon } from '@/components/icons/BrandIcons';
import { oauthEnabled } from '@/services/runtime';
import { notify } from '@/utils/notify';
import { authErrorMessage } from '@/utils/authErrors';
import { a11yState } from '@/utils/accessibility';

export default function SignupScreen() {
  const insets = useSafeAreaInsets();
  const { intent } = useLocalSearchParams<{ intent?: string }>();
  const hostIntent = isHostIntentParam(intent);
  useEffect(() => {
    if (hostIntent) markPendingHostIntent();
  }, [hostIntent]);
  const { signUp, signInWithOAuth } = useAuth();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [oauthLoading, setOauthLoading] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const emailRef = useRef<TextInput>(null);
  const passwordRef = useRef<TextInput>(null);
  const confirmRef = useRef<TextInput>(null);

  const validate = () => {
    const next: Record<string, string> = {};
    if (!name.trim()) next.name = 'Full name is required';
    if (!email.trim()) next.email = 'Email is required';
    else if (!/\S+@\S+\.\S+/.test(email.trim())) next.email = 'Email is invalid';
    if (!password) next.password = 'Password is required';
    else if (password.length < 8) next.password = 'Minimum 8 characters';
    if (confirmPassword !== password) next.confirm = 'Passwords do not match';
    setErrors(next);
    return Object.keys(next).length === 0;
  };

  const handleSignUp = async () => {
    if (!validate()) return;
    setLoading(true);
    const trimmedEmail = email.trim();
    try {
      const result = await signUp(trimmedEmail, password, name.trim());
      if (result?.session) {
        // Email confirmation disabled (or auto-confirmed): user is signed in.
        notify.success('Account created. Welcome to EventMap!');
        router.replace('/');
      } else {
        notify.success('Check your email to verify your account, then sign in.');
        router.replace({ pathname: '/(auth)/login', params: { email: trimmedEmail } });
      }
    } catch (error: unknown) {
      notify.error(authErrorMessage(error, 'Sign up failed. Please try again.'));
    } finally {
      setLoading(false);
    }
  };

  const handleGoogle = async () => {
    setOauthLoading(true);
    try {
      await signInWithOAuth('google');
      router.replace('/');
    } catch (error: unknown) {
      notify.error(authErrorMessage(error, 'Google sign-up failed. Please try again.'));
    } finally {
      setOauthLoading(false);
    }
  };

  return (
    <View style={styles.root}>
      <View style={styles.bgGlowTop} />
      <View style={styles.bgGlowBottom} />
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <ScrollView
          contentContainerStyle={{
            paddingTop: insets.top + 10,
            paddingBottom: insets.bottom + 24,
            paddingHorizontal: Spacing.lg,
          }}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
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

          <View style={styles.hero}>
            <View style={styles.logoTile}>
              <Image source={require('@/assets/images/EMlogo.png')} style={[styles.logo, styles.logoTint]} resizeMode="contain" />
            </View>
            <Text style={styles.heroTitle} accessibilityRole="header">Create an Account</Text>
            <Text style={styles.heroSub}>Join our community and explore your city.</Text>
          </View>

          <View style={styles.card}>
            <TextField
              label="Full Name"
              value={name}
              onChangeText={setName}
              placeholder="Enter your full name"
              error={errors.name}
              containerStyle={styles.fieldBlock}
              autoComplete="name"
              textContentType="name"
              autoCapitalize="words"
              returnKeyType="next"
              submitBehavior="submit"
              onSubmitEditing={() => emailRef.current?.focus()}
            />

            <TextField
              ref={emailRef}
              label="Email Address"
              value={email}
              onChangeText={setEmail}
              placeholder="name@example.com"
              error={errors.email}
              leadingIcon={<Mail size={20} color={Colors.text.tertiary} />}
              containerStyle={styles.fieldBlock}
              keyboardType="email-address"
              autoCapitalize="none"
              autoCorrect={false}
              autoComplete="email"
              textContentType="emailAddress"
              returnKeyType="next"
              submitBehavior="submit"
              onSubmitEditing={() => passwordRef.current?.focus()}
            />

            <View style={styles.fieldBlock}>
              <TextField
                ref={passwordRef}
                label="Password"
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
              {!errors.password && (
                <Text style={styles.passwordHint}>At least 8 characters</Text>
              )}
            </View>

            <TextField
              ref={confirmRef}
              label="Confirm Password"
              value={confirmPassword}
              onChangeText={setConfirmPassword}
              placeholder="••••••••"
              error={errors.confirm}
              leadingIcon={<Lock size={20} color={Colors.text.tertiary} />}
              containerStyle={styles.fieldBlock}
              secureTextEntry
              autoCapitalize="none"
              autoCorrect={false}
              autoComplete="new-password"
              textContentType="newPassword"
              returnKeyType="go"
              onSubmitEditing={handleSignUp}
            />

            <Button
              label="Sign Up"
              onPress={handleSignUp}
              loading={loading}
              disabled={oauthLoading}
              size="lg"
              fullWidth
              gradient
              icon={<ArrowRight size={22} color="#FFFFFF" />}
              style={styles.ctaWrap}
            />

            {oauthEnabled && <><View style={styles.divider}>
              <View style={styles.dividerLine} />
              <Text style={styles.dividerText}>OR CONTINUE WITH</Text>
              <View style={styles.dividerLine} />
            </View>

            <TouchableOpacity
              style={[styles.googleBtn, (oauthLoading || loading) && styles.googleBtnDisabled]}
              onPress={handleGoogle}
              activeOpacity={0.85}
              disabled={oauthLoading || loading}
              accessibilityRole="button"
              accessibilityLabel="Sign up with Google"
              {...a11yState({ disabled: oauthLoading || loading, busy: oauthLoading })}
            >
              <GoogleIcon size={20} />
              <Text style={styles.googleText}>{oauthLoading ? 'Signing up...' : 'Sign up with Google'}</Text>
            </TouchableOpacity>
            </>}
          </View>

          <View style={styles.footer}>
            <Text style={styles.footerText}>Already have an account?</Text>
            <TouchableOpacity
              onPress={() => router.replace('/(auth)/login')}
              hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
              accessibilityRole="button"
              accessibilityLabel="Go to log in"
            >
              <Text style={styles.footerLink}>Log In</Text>
            </TouchableOpacity>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: Colors.background.primary },
  flex: { flex: 1 },
  backBtn: {
    width: 44,
    height: 44,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.surface,
  },
  hero: { alignItems: 'center', marginTop: 18, marginBottom: 18 },
  logoTile: {
    width: 106,
    height: 106,
    borderRadius: 30,
    backgroundColor: Colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 18,
  },
  logo: { width: 52, height: 52 },
  logoTint: { tintColor: Colors.primary },
  heroTitle: {
    fontSize: Typography.sizes.xxl,
    lineHeight: 38,
    color: Colors.text.primary,
    fontFamily: Typography.displayFontFamilies.extrabold,
    fontWeight: Typography.weights.extrabold,
    letterSpacing: -0.8,
    textAlign: 'center',
  },
  heroSub: {
    marginTop: 6,
    fontSize: Typography.sizes.lg,
    lineHeight: 30,
    color: Colors.text.secondary,
    fontFamily: Typography.fontFamilies.medium,
    textAlign: 'center',
  },
  card: {
    backgroundColor: Colors.surface,
    borderRadius: 40,
    padding: 22,
    borderWidth: 1,
    borderColor: alpha('#000000', 0.04),
  },
  fieldBlock: { marginBottom: Spacing.md },
  passwordHint: {
    marginTop: Spacing.xs,
    marginLeft: Spacing.xs,
    fontSize: Typography.sizes.xs,
    fontFamily: Typography.fontFamilies.regular,
    color: Colors.text.tertiary,
  },
  ctaWrap: { marginTop: Spacing.lg },
  divider: {
    marginTop: 24,
    marginBottom: 18,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  dividerLine: { flex: 1, height: 1, backgroundColor: Colors.border.light },
  dividerText: {
    color: Colors.text.tertiary,
    fontSize: Typography.sizes.xs,
    letterSpacing: 2,
    fontFamily: Typography.labelFontFamilies.semibold,
  },
  googleBtn: {
    height: 58,
    borderRadius: BorderRadius.round,
    borderWidth: 1,
    borderColor: Colors.border.light,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: 10,
    backgroundColor: Colors.surface,
  },
  googleBtnDisabled: { opacity: 0.5 },
  googleText: {
    color: Colors.text.primary,
    fontSize: Typography.sizes.md,
    fontFamily: Typography.fontFamilies.semibold,
    fontWeight: Typography.weights.semibold,
  },
  footer: {
    marginTop: 22,
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 8,
  },
  footerText: { color: Colors.text.secondary, fontSize: Typography.sizes.md, fontFamily: Typography.fontFamilies.medium },
  footerLink: { color: Colors.primary, fontSize: Typography.sizes.md, fontFamily: Typography.fontFamilies.bold, fontWeight: Typography.weights.bold },
  bgGlowTop: {
    position: 'absolute',
    width: 280,
    height: 280,
    borderRadius: 140,
    backgroundColor: 'rgba(180,25,36,0.08)',
    top: -80,
    left: -80,
  },
  bgGlowBottom: {
    position: 'absolute',
    width: 320,
    height: 320,
    borderRadius: 160,
    backgroundColor: 'rgba(155,62,32,0.08)',
    bottom: -120,
    right: -90,
  },
});
