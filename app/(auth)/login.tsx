import { useState, useRef } from 'react';
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
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { useAuth } from '@/contexts/AuthContext';
import { Input } from '@/components/Input';
import { Colors, Spacing, Typography, BorderRadius, Shadows } from '@/constants/theme';
import {
  ArrowLeft,
  Mail,
  Lock,
  LogIn,
  Eye,
  EyeOff,
} from 'lucide-react-native';

const Palette = {
  gradientStart: Colors.primary,
  gradientEnd: Colors.accent,
  cardBg: Colors.background.primary,
  surfaceMuted: Colors.background.primary,
  accentSoft: 'rgba(196, 92, 62, 0.12)',
  separator: Colors.border.light,
};

export default function LoginScreen() {
  const insets = useSafeAreaInsets();
  const { signIn } = useAuth();
  const scrollRef = useRef<ScrollView>(null);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [errors, setErrors] = useState<{ email?: string; password?: string }>(
    {}
  );

  const validateForm = () => {
    const newErrors: { email?: string; password?: string } = {};

    if (!email) {
      newErrors.email = 'Email is required';
    } else if (!/\S+@\S+\.\S+/.test(email)) {
      newErrors.email = 'Email is invalid';
    }

    if (!password) {
      newErrors.password = 'Password is required';
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSignIn = async () => {
    if (!validateForm()) return;

    setLoading(true);
    try {
      await signIn(email, password);
      router.replace('/');
    } catch (error: any) {
      Alert.alert('Sign In Failed', error.message || 'Please try again');
    } finally {
      setLoading(false);
    }
  };

  const scrollToForm = () => {
    scrollRef.current?.scrollTo({ y: 180, animated: true });
  };

  return (
    <View style={styles.root}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 0 : 20}
      >
        <ScrollView
          ref={scrollRef}
          contentContainerStyle={[
            styles.scrollContent,
            { paddingTop: insets.top, paddingBottom: insets.bottom + 32 },
          ]}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {/* ── Back button ── */}
          <TouchableOpacity
            style={styles.backBtn}
            onPress={() => router.back()}
            activeOpacity={0.7}
          >
            <ArrowLeft size={22} color={Colors.text.primary} />
          </TouchableOpacity>

          {/* ── Hero area ── */}
          <View style={styles.heroSection}>
            <View style={styles.logoWrap}>
              <View style={styles.logoOuter}>
                <View style={styles.logoInner}>
                  <Image
                    source={require('@/assets/images/EMlogo.png')}
                    style={styles.heroLogo}
                    resizeMode="contain"
                  />
                </View>
              </View>
            </View>
            <Text style={styles.heroTitle}>Welcome Back</Text>
            <Text style={styles.heroSubtitle}>
              Sign in to discover events near you
            </Text>
          </View>

          {/* ── Form card ── */}
          <View style={styles.formCard}>
            {/* Email field */}
            <View style={styles.fieldRow}>
              <View style={styles.fieldIcon}>
                <Mail size={16} color={Colors.primary} />
              </View>
              <View style={styles.fieldContent}>
                <Input
                  label="Email"
                  value={email}
                  onChangeText={setEmail}
                  placeholder="your@email.com"
                  keyboardType="email-address"
                  autoCapitalize="none"
                  error={errors.email}
                />
              </View>
            </View>

            <View style={styles.fieldSeparator} />

            {/* Password field */}
            <View style={styles.fieldRow}>
              <View style={styles.fieldIcon}>
                <Lock size={16} color={Colors.primary} />
              </View>
              <View style={styles.fieldContent}>
                <Input
                  label="Password"
                  value={password}
                  onChangeText={setPassword}
                  placeholder="Enter your password"
                  secureTextEntry={!showPassword}
                  onFocus={scrollToForm}
                  error={errors.password}
                  rightAdornment={
                    <TouchableOpacity
                      onPress={() => setShowPassword((p) => !p)}
                      hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
                      activeOpacity={0.7}
                    >
                      {showPassword ? (
                        <EyeOff size={20} color={Colors.text.tertiary} />
                      ) : (
                        <Eye size={20} color={Colors.text.tertiary} />
                      )}
                    </TouchableOpacity>
                  }
                />
              </View>
            </View>
          </View>

          {/* ── Forgot password ── */}
          <TouchableOpacity
            style={styles.forgotRow}
            onPress={() => router.push('/(auth)/forgot-password')}
            activeOpacity={0.7}
          >
            <Text style={styles.forgotText}>Forgot password?</Text>
          </TouchableOpacity>

          {/* ── Sign in button ── */}
          <TouchableOpacity
            style={styles.submitWrap}
            onPress={handleSignIn}
            disabled={loading}
            activeOpacity={0.85}
          >
            <LinearGradient
              colors={
                loading
                  ? [Colors.primaryLight, Colors.accentLight]
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
                  <LogIn size={18} color="#FFFFFF" />
                  <Text style={styles.submitText}>Sign In</Text>
                </>
              )}
            </LinearGradient>
          </TouchableOpacity>

          {/* ── Divider ── */}
          <View style={styles.dividerRow}>
            <View style={styles.dividerLine} />
            <Text style={styles.dividerText}>or</Text>
            <View style={styles.dividerLine} />
          </View>

          {/* ── Footer ── */}
          <View style={styles.footer}>
            <Text style={styles.footerText}>Don't have an account?</Text>
            <TouchableOpacity
              style={styles.signUpBtn}
              onPress={() => router.push('/(auth)/signup')}
              activeOpacity={0.7}
            >
              <Text style={styles.signUpBtnText}>Create Account</Text>
            </TouchableOpacity>
          </View>
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

  /* ── Back button ── */
  backBtn: {
    width: 44,
    height: 44,
    borderRadius: 14,
    backgroundColor: Palette.cardBg,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 8,
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
    marginTop: 16,
    marginBottom: 20,
  },
  logoWrap: {
    marginBottom: 12,
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
  logoOuter: {
    width: 72,
    height: 72,
    borderRadius: 22,
    backgroundColor: Palette.accentSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  logoInner: {
    width: 60,
    height: 60,
    borderRadius: 18,
    backgroundColor: Palette.cardBg,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  heroLogo: {
    width: 44,
    height: 44,
  },
  heroTitle: {
    fontSize: 24,
    fontFamily: Typography.displayFontFamilies.bold,
    fontWeight: Typography.weights.bold,
    color: Colors.text.primary,
    marginBottom: 4,
  },
  heroSubtitle: {
    fontSize: Typography.sizes.md,
    fontFamily: Typography.fontFamily,
    color: Colors.text.tertiary,
    textAlign: 'center',
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
    paddingVertical: 12,
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
  fieldSeparator: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: Palette.separator,
    marginLeft: 70,
  },

  /* ── Forgot password ── */
  forgotRow: {
    alignSelf: 'flex-end',
    marginTop: 8,
    marginBottom: 4,
    paddingVertical: 4,
    paddingHorizontal: 4,
  },
  forgotText: {
    fontSize: Typography.sizes.sm,
    fontFamily: Typography.fontFamilies.semibold,
    fontWeight: Typography.weights.semibold,
    color: Colors.primary,
  },

  /* ── Submit ── */
  submitWrap: {
    marginTop: 12,
    borderRadius: 16,
    overflow: 'hidden',
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
  submitGradient: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    paddingVertical: 14,
  },
  submitText: {
    fontSize: Typography.sizes.lg,
    fontFamily: Typography.fontFamilies.bold,
    fontWeight: Typography.weights.bold,
    color: '#FFFFFF',
    letterSpacing: 0.3,
  },

  /* ── Divider ── */
  dividerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 18,
    marginBottom: 14,
    gap: 14,
  },
  dividerLine: {
    flex: 1,
    height: StyleSheet.hairlineWidth,
    backgroundColor: Palette.separator,
  },
  dividerText: {
    fontSize: Typography.sizes.sm,
    fontFamily: Typography.fontFamilies.medium,
    fontWeight: Typography.weights.medium,
    color: Colors.text.tertiary,
    textTransform: 'lowercase',
  },

  /* ── Footer ── */
  footer: {
    alignItems: 'center',
    gap: 8,
  },
  footerText: {
    fontSize: Typography.sizes.md,
    fontFamily: Typography.fontFamily,
    color: Colors.text.secondary,
  },
  signUpBtn: {
    paddingVertical: 10,
    paddingHorizontal: 28,
    borderRadius: 14,
    borderWidth: 1.5,
    borderColor: Colors.primary,
    backgroundColor: Palette.accentSoft,
  },
  signUpBtnText: {
    fontSize: Typography.sizes.md,
    fontFamily: Typography.fontFamilies.semibold,
    fontWeight: Typography.weights.semibold,
    color: Colors.primary,
  },
});