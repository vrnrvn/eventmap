import { useState, useRef, useEffect } from 'react';
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
import { useAuth } from '@/contexts/AuthContext';
import { GoogleIcon } from '@/components/icons/BrandIcons';
import { Button } from '@/components/ui/Button';
import { TextField } from '@/components/ui/TextField';
import { oauthEnabled } from '@/services/runtime';
import { notify } from '@/utils/notify';
import { authErrorMessage } from '@/utils/authErrors';
import { Colors, Typography, BorderRadius, Spacing, alpha } from '@/constants/theme';
import { ArrowLeft, Mail, Lock } from 'lucide-react-native';

export default function LoginScreen() {
  const insets = useSafeAreaInsets();
  const { email: emailParam, redirect: redirectParam } = useLocalSearchParams<{
    email?: string;
    redirect?: string;
  }>();
  const { signIn, signInWithOAuth } = useAuth();
  const scrollRef = useRef<ScrollView>(null);
  const passwordRef = useRef<TextInput>(null);

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [oauthLoading, setOauthLoading] = useState(false);
  const [errors, setErrors] = useState<{ email?: string; password?: string }>({});

  useEffect(() => {
    const value = Array.isArray(emailParam) ? emailParam[0] : emailParam;
    if (value) setEmail(value);
  }, [emailParam]);

  // Optional return path after login (internal paths only), e.g. back to an event.
  const redirectTo = (() => {
    const value = Array.isArray(redirectParam) ? redirectParam[0] : redirectParam;
    return value && value.startsWith('/') && !value.startsWith('//') ? value : '/';
  })();

  const validateForm = () => {
    const newErrors: { email?: string; password?: string } = {};
    if (!email.trim()) newErrors.email = 'Email is required';
    else if (!/\S+@\S+\.\S+/.test(email.trim())) newErrors.email = 'Email is invalid';
    if (!password) newErrors.password = 'Password is required';
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSignIn = async () => {
    if (!validateForm()) return;
    setLoading(true);
    try {
      // Trim to match signup (which stores the trimmed address): GoTrue does
      // not strip whitespace, so a pasted/autofilled trailing space would
      // otherwise fail as "Invalid login credentials".
      await signIn(email.trim(), password);
      router.replace(redirectTo as never);
    } catch (error: unknown) {
      notify.error(authErrorMessage(error, 'Sign in failed. Please try again.'));
    } finally {
      setLoading(false);
    }
  };

  const handleGoogle = async () => {
    setOauthLoading(true);
    try {
      await signInWithOAuth('google');
      router.replace(redirectTo as never);
    } catch (error: unknown) {
      notify.error(authErrorMessage(error, 'Google sign-in failed. Please try again.'));
    } finally {
      setOauthLoading(false);
    }
  };

  return (
    <View style={styles.root}>
      <View style={styles.bgGlowTop} />
      <View style={styles.bgGlowBottom} />
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        <ScrollView
          ref={scrollRef}
          contentContainerStyle={{
            paddingTop: insets.top + 10,
            paddingBottom: insets.bottom + 24,
            paddingHorizontal: Spacing.lg,
          }}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
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
            <Text style={styles.heroTitle}>Welcome Back</Text>
            <Text style={styles.heroSub}>Sign in to explore your city&apos;s pulse</Text>
          </View>

          <View style={styles.card}>
            <TextField
              label="Email Address"
              value={email}
              onChangeText={setEmail}
              placeholder="name@example.com"
              error={errors.email}
              leadingIcon={<Mail size={20} color={Colors.text.tertiary} />}
              keyboardType="email-address"
              autoCapitalize="none"
              autoCorrect={false}
              autoComplete="email"
              textContentType="emailAddress"
              returnKeyType="next"
              submitBehavior="submit"
              onSubmitEditing={() => passwordRef.current?.focus()}
            />

            <TextField
              ref={passwordRef}
              label="Password"
              labelAccessory={
                <TouchableOpacity
                  onPress={() => router.push('/(auth)/forgot-password')}
                  hitSlop={{ top: 16, bottom: 16, left: 16, right: 16 }}
                  accessibilityRole="button"
                  accessibilityLabel="Forgot password"
                >
                  <Text style={styles.forgotText}>Forgot Password?</Text>
                </TouchableOpacity>
              }
              containerStyle={styles.fieldSpacing}
              value={password}
              onChangeText={setPassword}
              placeholder="••••••••"
              error={errors.password}
              leadingIcon={<Lock size={20} color={Colors.text.tertiary} />}
              secureTextEntry
              autoCapitalize="none"
              autoCorrect={false}
              autoComplete="current-password"
              textContentType="password"
              returnKeyType="go"
              onSubmitEditing={handleSignIn}
            />

            <Button
              label="Login"
              onPress={handleSignIn}
              loading={loading}
              disabled={oauthLoading}
              size="lg"
              fullWidth
              gradient
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
              accessibilityLabel="Continue with Google"
              accessibilityState={{ disabled: oauthLoading || loading, busy: oauthLoading }}
            >
              <GoogleIcon size={20} />
              <Text style={styles.googleText}>{oauthLoading ? 'Signing in...' : 'Continue with Google'}</Text>
            </TouchableOpacity>
            </>}
          </View>

          <View style={styles.footer}>
            <Text style={styles.footerText}>Don&apos;t have an account?</Text>
            <TouchableOpacity
              onPress={() => router.push('/(auth)/signup')}
              hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
              accessibilityRole="button"
              accessibilityLabel="Go to sign up"
            >
              <Text style={styles.footerLink}>Sign Up</Text>
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
  },
  heroSub: {
    marginTop: 6,
    fontSize: Typography.sizes.lg,
    lineHeight: 30,
    color: Colors.text.secondary,
    fontFamily: Typography.fontFamilies.medium,
  },
  card: {
    backgroundColor: Colors.surface,
    borderRadius: 40,
    padding: 22,
    borderWidth: 1,
    borderColor: alpha('#000000', 0.04),
  },
  fieldSpacing: { marginTop: Spacing.md },
  forgotText: {
    color: Colors.primary,
    fontSize: Typography.sizes.xs,
    letterSpacing: 1.6,
    textTransform: 'uppercase',
    fontFamily: Typography.labelFontFamilies.semibold,
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
