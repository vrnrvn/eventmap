import { useState, useRef, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  ActivityIndicator,
  Alert,
  Image,
  TextInput,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { useAuth } from '@/contexts/AuthContext';
import { GoogleIcon } from '@/components/icons/BrandIcons';
import { Colors, Typography, BorderRadius } from '@/constants/theme';
import { ArrowLeft, Eye, EyeOff, Mail, Lock } from 'lucide-react-native';

export default function LoginScreen() {
  const insets = useSafeAreaInsets();
  const { email: emailParam } = useLocalSearchParams<{ email?: string }>();
  const { signIn, signInWithOAuth } = useAuth();
  const scrollRef = useRef<ScrollView>(null);

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [oauthLoading, setOauthLoading] = useState(false);
  const [errors, setErrors] = useState<{ email?: string; password?: string }>({});

  useEffect(() => {
    const value = Array.isArray(emailParam) ? emailParam[0] : emailParam;
    if (value) setEmail(value);
  }, [emailParam]);

  const validateForm = () => {
    const newErrors: { email?: string; password?: string } = {};
    if (!email.trim()) newErrors.email = 'Email is required';
    else if (!/\S+@\S+\.\S+/.test(email)) newErrors.email = 'Email is invalid';
    if (!password) newErrors.password = 'Password is required';
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSignIn = async () => {
    if (!validateForm()) return;
    setLoading(true);
    try {
      await signIn(email, password);
      router.replace('/');
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      Alert.alert('Sign In Failed', msg || 'Please try again');
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
      const msg = error instanceof Error ? error.message : String(error);
      Alert.alert('Google Sign In', msg.includes('cancelled') ? 'Sign in was cancelled.' : msg);
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
            paddingHorizontal: 22,
          }}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          <TouchableOpacity style={styles.backBtn} onPress={() => router.back()} activeOpacity={0.75}>
            <ArrowLeft size={20} color={Colors.text.primary} />
          </TouchableOpacity>

          <View style={styles.hero}>
            <View style={styles.logoTile}>
              <Image source={require('@/assets/images/EMlogo.png')} style={[styles.logo, styles.logoTint]} resizeMode="contain" />
            </View>
            <Text style={styles.heroTitle}>Welcome Back</Text>
            <Text style={styles.heroSub}>Sign in to explore your city's pulse</Text>
          </View>

          <View style={styles.card}>
            <Text style={styles.fieldLabel}>Email Address</Text>
            <View style={styles.inputShell}>
              <Mail size={20} color={Colors.text.tertiary} />
              <TextInput
                value={email}
                onChangeText={setEmail}
                placeholder="name@example.com"
                placeholderTextColor={Colors.text.tertiary}
                keyboardType="email-address"
                autoCapitalize="none"
                style={styles.input}
              />
            </View>
            {errors.email ? <Text style={styles.errorText}>{errors.email}</Text> : null}

            <View style={styles.passwordRow}>
              <Text style={styles.fieldLabel}>Password</Text>
              <TouchableOpacity onPress={() => router.push('/(auth)/forgot-password')}>
                <Text style={styles.forgotText}>Forgot Password?</Text>
              </TouchableOpacity>
            </View>
            <View style={styles.inputShell}>
              <Lock size={20} color={Colors.text.tertiary} />
              <TextInput
                value={password}
                onChangeText={setPassword}
                placeholder="••••••••"
                placeholderTextColor={Colors.text.tertiary}
                secureTextEntry={!showPassword}
                style={styles.input}
              />
              <TouchableOpacity onPress={() => setShowPassword((v) => !v)}>
                {showPassword ? (
                  <EyeOff size={21} color={Colors.text.tertiary} />
                ) : (
                  <Eye size={21} color={Colors.text.tertiary} />
                )}
              </TouchableOpacity>
            </View>
            {errors.password ? <Text style={styles.errorText}>{errors.password}</Text> : null}

            <TouchableOpacity style={styles.ctaWrap} onPress={handleSignIn} disabled={loading} activeOpacity={0.9}>
              <LinearGradient colors={[Colors.primary, Colors.secondary]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={styles.cta}>
                {loading ? <ActivityIndicator color="#fff" /> : <Text style={styles.ctaText}>Login</Text>}
              </LinearGradient>
            </TouchableOpacity>

            <View style={styles.divider}>
              <View style={styles.dividerLine} />
              <Text style={styles.dividerText}>OR CONTINUE WITH</Text>
              <View style={styles.dividerLine} />
            </View>

            <TouchableOpacity style={styles.googleBtn} onPress={handleGoogle} activeOpacity={0.85} disabled={oauthLoading}>
              <GoogleIcon size={20} />
              <Text style={styles.googleText}>{oauthLoading ? 'Signing in...' : 'Continue with Google'}</Text>
            </TouchableOpacity>
          </View>

          <View style={styles.footer}>
            <Text style={styles.footerText}>Don't have an account?</Text>
            <TouchableOpacity onPress={() => router.push('/(auth)/signup')}>
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
    width: 42,
    height: 42,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#FFFFFF',
  },
  hero: { alignItems: 'center', marginTop: 18, marginBottom: 18 },
  logoTile: {
    width: 106,
    height: 106,
    borderRadius: 30,
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 18,
  },
  logo: { width: 52, height: 52 },
  logoTint: { tintColor: Colors.primary },
  heroTitle: {
    fontSize: 54,
    lineHeight: 60,
    color: Colors.text.primary,
    fontFamily: Typography.displayFontFamilies.extrabold,
    fontWeight: '800',
    letterSpacing: -0.8,
  },
  heroSub: {
    marginTop: 6,
    fontSize: 18,
    lineHeight: 30,
    color: Colors.text.secondary,
    fontFamily: Typography.fontFamilies.medium,
  },
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 40,
    padding: 22,
    borderWidth: 1,
    borderColor: 'rgba(0,0,0,0.04)',
  },
  fieldLabel: {
    marginBottom: 10,
    color: Colors.text.secondary,
    fontSize: 12,
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
    fontSize: 16,
    fontFamily: Typography.fontFamilies.medium,
  },
  passwordRow: {
    marginTop: 16,
    marginBottom: 10,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  forgotText: {
    color: Colors.primary,
    fontSize: 12,
    letterSpacing: 1.6,
    textTransform: 'uppercase',
    fontFamily: Typography.labelFontFamilies.semibold,
  },
  errorText: {
    marginTop: 6,
    marginLeft: 4,
    color: Colors.error,
    fontSize: 12,
    fontFamily: Typography.fontFamilies.medium,
  },
  ctaWrap: { marginTop: 24, borderRadius: BorderRadius.round, overflow: 'hidden' },
  cta: {
    height: 64,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ctaText: {
    color: '#FFFFFF',
    fontSize: 20,
    fontFamily: Typography.displayFontFamilies.bold,
    fontWeight: Typography.weights.bold,
  },
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
    fontSize: 11,
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
    backgroundColor: '#FFFFFF',
  },
  googleText: {
    color: Colors.text.primary,
    fontSize: 16,
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
  footerText: { color: Colors.text.secondary, fontSize: 16, fontFamily: Typography.fontFamilies.medium },
  footerLink: { color: Colors.primary, fontSize: 16, fontFamily: Typography.fontFamilies.bold, fontWeight: Typography.weights.bold },
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
