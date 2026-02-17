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
  Modal,
  Pressable,
  Image,
  Alert,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { useAuth } from '@/contexts/AuthContext';
import { Input } from '@/components/Input';
import { Colors, Spacing, Typography, BorderRadius, Shadows } from '@/constants/theme';
import {
  ArrowLeft,
  User,
  Mail,
  Lock,
  UserPlus,
} from 'lucide-react-native';
import { GoogleIcon, FacebookIcon } from '@/components/icons/BrandIcons';

const Palette = {
  gradientStart: Colors.primary,
  gradientEnd: Colors.accent,
  cardBg: Colors.background.primary,
  surfaceMuted: Colors.background.primary,
  accentSoft: 'rgba(196, 92, 62, 0.12)',
  separator: Colors.border.light,
};

export default function SignupScreen() {
  const insets = useSafeAreaInsets();
  const { signUp, signInWithOAuth } = useAuth();
  const [selectedMethod, setSelectedMethod] = useState<'select' | 'email'>('select');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [errors, setErrors] = useState<{
    name?: string;
    email?: string;
    password?: string;
  }>({});
  const [showEmailPopup, setShowEmailPopup] = useState(false);
  const [emailPopupVariant, setEmailPopupVariant] = useState<'new' | 'existing'>('new');
  const [oauthLoading, setOauthLoading] = useState<'google' | 'facebook' | null>(null);

  const validateForm = () => {
    const newErrors: { name?: string; email?: string; password?: string } = {};

    if (!name.trim()) {
      newErrors.name = 'Name is required';
    }

    if (!email) {
      newErrors.email = 'Email is required';
    } else if (!/\S+@\S+\.\S+/.test(email)) {
      newErrors.email = 'Email is invalid';
    }

    if (!password) {
      newErrors.password = 'Password is required';
    } else if (password.length < 6) {
      newErrors.password = 'Password must be at least 6 characters';
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSignUp = async () => {
    if (!validateForm()) return;

    setLoading(true);
    try {
      await signUp(email, password, name);
      setEmailPopupVariant('new');
      setShowEmailPopup(true);
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      const isExistingUser =
        /already registered|user already exists|email already|already been registered/i.test(msg);
      if (isExistingUser) {
        setEmailPopupVariant('existing');
        setShowEmailPopup(true);
      } else {
        setErrors({ email: msg || 'Please try again' });
      }
    } finally {
      setLoading(false);
    }
  };

  const handleEmailPopupDismiss = () => {
    setShowEmailPopup(false);
    router.replace('/');
  };

  const handleOAuthSignIn = async (provider: 'google' | 'facebook') => {
    setOauthLoading(provider);
    try {
      await signInWithOAuth(provider);
      router.replace('/');
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      Alert.alert(
        provider === 'google' ? 'Google Sign In' : 'Facebook Sign In',
        msg.includes('cancelled') ? 'Sign in was cancelled.' : msg
      );
    } finally {
      setOauthLoading(null);
    }
  };

  return (
    <View style={styles.root}>
      <Modal
        visible={showEmailPopup}
        transparent
        animationType="fade"
        onRequestClose={handleEmailPopupDismiss}
      >
        <Pressable style={styles.popupOverlay} onPress={handleEmailPopupDismiss}>
          <Pressable style={styles.popupCard} onPress={(e) => e.stopPropagation()}>
            <View style={styles.popupIconWrap}>
              <Image
                source={require('@/assets/images/EMlogo.png')}
                style={styles.popupLogo}
                resizeMode="contain"
              />
            </View>
            <Text style={styles.popupTitle}>
              {emailPopupVariant === 'existing' ? 'Email Already Registered' : 'Check Your Email'}
            </Text>
            <Text style={styles.popupMessage}>
              {emailPopupVariant === 'existing'
                ? 'This email is already registered. Please check your inbox to verify your account, then sign in to continue with onboarding.'
                : 'Please check your email to verify your account. Once verified, sign in to continue with onboarding.'}
            </Text>
            <TouchableOpacity
              style={styles.popupButton}
              onPress={handleEmailPopupDismiss}
              activeOpacity={0.85}
            >
              <LinearGradient
                colors={[Palette.gradientStart, Palette.gradientEnd]}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 0 }}
                style={styles.popupButtonGradient}
              >
                <Text style={styles.popupButtonText}>OK</Text>
              </LinearGradient>
            </TouchableOpacity>
          </Pressable>
        </Pressable>
      </Modal>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        <ScrollView
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
            onPress={() =>
              selectedMethod === 'email' ? setSelectedMethod('select') : router.back()
            }
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
            <Text style={styles.heroTitle}>Create Account</Text>
            <Text style={styles.heroSubtitle}>
              {selectedMethod === 'select'
                ? 'Choose how you want to sign up'
                : 'Join to discover and share local events'}
            </Text>
          </View>

          {selectedMethod === 'select' ? (
            /* ── Method selection cards ── */
            <View style={styles.methodCards}>
              <TouchableOpacity
                style={styles.methodCard}
                onPress={() => setSelectedMethod('email')}
                activeOpacity={0.85}
              >
                <View style={styles.methodIcon}>
                  <Mail size={24} color={Colors.primary} />
                </View>
                <View style={styles.methodText}>
                  <Text style={styles.methodLabel}>Email</Text>
                  <Text style={styles.methodHint}>Sign up with your email</Text>
                </View>
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.methodCard}
                onPress={() => handleOAuthSignIn('google')}
                disabled={oauthLoading !== null}
                activeOpacity={0.85}
              >
                <View style={[styles.methodIcon, styles.methodIconBrand]}>
                  <GoogleIcon size={24} />
                </View>
                <View style={styles.methodText}>
                  <Text style={styles.methodLabel}>Gmail</Text>
                  <Text style={styles.methodHint}>Sign up with Google</Text>
                </View>
                {oauthLoading === 'google' && (
                  <ActivityIndicator size="small" color={Colors.primary} style={styles.methodSpinner} />
                )}
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.methodCard}
                onPress={() => handleOAuthSignIn('facebook')}
                disabled={oauthLoading !== null}
                activeOpacity={0.85}
              >
                <View style={[styles.methodIcon, styles.methodIconBrand]}>
                  <FacebookIcon size={24} />
                </View>
                <View style={styles.methodText}>
                  <Text style={styles.methodLabel}>Facebook</Text>
                  <Text style={styles.methodHint}>Sign up with Facebook</Text>
                </View>
                {oauthLoading === 'facebook' && (
                  <ActivityIndicator size="small" color={Colors.primary} style={styles.methodSpinner} />
                )}
              </TouchableOpacity>
            </View>
          ) : null}

          {selectedMethod === 'select' ? (
            <View style={[styles.footer, { marginTop: 24 }]}>
              <Text style={styles.footerText}>Already have an account?</Text>
              <TouchableOpacity
                style={styles.signInBtn}
                onPress={() => router.push('/(auth)/login')}
                activeOpacity={0.7}
              >
                <Text style={styles.signInBtnText}>Sign In</Text>
              </TouchableOpacity>
            </View>
          ) : null}

          {selectedMethod === 'email' ? (
            <>
              {/* ── Form card ── */}
              <View style={styles.formCard}>
                {/* Name */}
                <View style={styles.fieldRow}>
                  <View style={styles.fieldIcon}>
                    <User size={16} color={Colors.primary} />
                  </View>
                  <View style={styles.fieldContent}>
                    <Input
                      label="Name"
                      value={name}
                      onChangeText={setName}
                      placeholder="Your name"
                      error={errors.name}
                    />
                  </View>
                </View>

                <View style={styles.fieldSeparator} />

                {/* Email */}
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

                {/* Password */}
                <View style={styles.fieldRow}>
                  <View style={styles.fieldIcon}>
                    <Lock size={16} color={Colors.primary} />
                  </View>
                  <View style={styles.fieldContent}>
                    <Input
                      label="Password"
                      value={password}
                      onChangeText={setPassword}
                      placeholder="At least 6 characters"
                      secureTextEntry
                      error={errors.password}
                    />
                  </View>
                </View>
              </View>

              {/* ── Create account button ── */}
              <TouchableOpacity
                style={styles.submitWrap}
                onPress={handleSignUp}
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
                      <UserPlus size={18} color="#FFFFFF" />
                      <Text style={styles.submitText}>Create Account</Text>
                    </>
                  )}
                </LinearGradient>
              </TouchableOpacity>

              {/* ── Terms hint ── */}
              <Text style={styles.termsText}>
                By creating an account, you agree to our{' '}
                <Text style={styles.termsLink}>Terms of Service</Text> and{' '}
                <Text style={styles.termsLink}>Privacy Policy</Text>
              </Text>

              {/* ── Divider ── */}
              <View style={styles.dividerRow}>
                <View style={styles.dividerLine} />
                <Text style={styles.dividerText}>or</Text>
                <View style={styles.dividerLine} />
              </View>

              {/* ── Footer ── */}
              <View style={styles.footer}>
                <Text style={styles.footerText}>Already have an account?</Text>
                <TouchableOpacity
                  style={styles.signInBtn}
                  onPress={() => router.push('/(auth)/login')}
                  activeOpacity={0.7}
                >
                  <Text style={styles.signInBtnText}>Sign In</Text>
                </TouchableOpacity>
              </View>
            </>
          ) : null}
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
    marginTop: 28,
    marginBottom: 32,
  },
  logoWrap: {
    marginBottom: 18,
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
    width: 88,
    height: 88,
    borderRadius: 28,
    backgroundColor: Palette.accentSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  logoInner: {
    width: 72,
    height: 72,
    borderRadius: 22,
    backgroundColor: Palette.cardBg,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  heroLogo: {
    width: 56,
    height: 56,
  },
  heroTitle: {
    fontSize: 28,
    fontFamily: Typography.displayFontFamilies.bold,
    fontWeight: Typography.weights.bold,
    color: Colors.text.primary,
    marginBottom: 6,
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
    paddingVertical: 16,
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

  /* ── Method selection ── */
  methodCards: {
    gap: 12,
    marginTop: 8,
  },
  methodCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Palette.cardBg,
    borderRadius: 16,
    padding: 18,
    gap: 16,
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
  methodIcon: {
    width: 48,
    height: 48,
    borderRadius: 14,
    backgroundColor: Palette.accentSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  methodIconBrand: {
    backgroundColor: 'rgba(0,0,0,0.04)',
  },
  methodSpinner: {
    marginLeft: 8,
  },
  methodText: {
    flex: 1,
  },
  methodLabel: {
    fontSize: Typography.sizes.md,
    fontFamily: Typography.fontFamilies.semibold,
    fontWeight: Typography.weights.semibold,
    color: Colors.text.primary,
  },
  methodLabelMuted: {
    color: Colors.text.tertiary,
  },
  methodHint: {
    fontSize: Typography.sizes.xs,
    fontFamily: Typography.fontFamily,
    color: Colors.text.tertiary,
    marginTop: 2,
  },

  /* ── Submit ── */
  submitWrap: {
    marginTop: 24,
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
    paddingVertical: 17,
  },
  submitText: {
    fontSize: Typography.sizes.lg,
    fontFamily: Typography.fontFamilies.bold,
    fontWeight: Typography.weights.bold,
    color: '#FFFFFF',
    letterSpacing: 0.3,
  },

  /* ── Terms ── */
  termsText: {
    fontSize: Typography.sizes.xs,
    fontFamily: Typography.fontFamily,
    color: Colors.text.tertiary,
    textAlign: 'center',
    lineHeight: 18,
    marginTop: 16,
    paddingHorizontal: 12,
  },
  termsLink: {
    fontFamily: Typography.fontFamilies.medium,
    fontWeight: Typography.weights.medium,
    color: Colors.primary,
  },

  /* ── Divider ── */
  dividerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 24,
    marginBottom: 20,
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
    gap: 12,
  },
  footerText: {
    fontSize: Typography.sizes.md,
    fontFamily: Typography.fontFamily,
    color: Colors.text.secondary,
  },
  signInBtn: {
    paddingVertical: 13,
    paddingHorizontal: 32,
    borderRadius: 14,
    borderWidth: 1.5,
    borderColor: Colors.primary,
    backgroundColor: Palette.accentSoft,
  },
  signInBtnText: {
    fontSize: Typography.sizes.md,
    fontFamily: Typography.fontFamilies.semibold,
    fontWeight: Typography.weights.semibold,
    color: Colors.primary,
  },

  /* ── Email popup ── */
  popupOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  popupCard: {
    width: '100%',
    maxWidth: 340,
    backgroundColor: Palette.cardBg,
    borderRadius: 24,
    padding: 28,
    alignItems: 'center',
    ...Platform.select({
      ios: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 8 },
        shadowOpacity: 0.2,
        shadowRadius: 24,
      },
      android: { elevation: 16 },
    }),
  },
  popupIconWrap: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: Palette.accentSoft,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 20,
    overflow: 'hidden',
  },
  popupLogo: {
    width: 44,
    height: 44,
  },
  popupTitle: {
    fontSize: 20,
    fontFamily: Typography.fontFamilies.bold,
    fontWeight: Typography.weights.bold,
    color: Colors.text.primary,
    marginBottom: 12,
    textAlign: 'center',
  },
  popupMessage: {
    fontSize: Typography.sizes.md,
    fontFamily: Typography.fontFamily,
    color: Colors.text.secondary,
    textAlign: 'center',
    lineHeight: 22,
    marginBottom: 24,
  },
  popupButton: {
    width: '100%',
    borderRadius: 14,
    overflow: 'hidden',
  },
  popupButtonGradient: {
    paddingVertical: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  popupButtonText: {
    fontSize: Typography.sizes.md,
    fontFamily: Typography.fontFamilies.semibold,
    fontWeight: Typography.weights.semibold,
    color: '#FFFFFF',
  },
});