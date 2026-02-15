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
  Alert,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { useAuth } from '@/contexts/AuthContext';
import { Input } from '@/components/Input';
import { AddressSearchInput } from '@/components/AddressSearchInput';
import { profilesService } from '@/services/profiles';
import { Colors, Spacing, Typography, BorderRadius, Shadows } from '@/constants/theme';
import {
  ArrowLeft,
  User,
  Mail,
  Lock,
  MapPin,
  UserPlus,
  Sparkles,
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
};

export default function SignupScreen() {
  const insets = useSafeAreaInsets();
  const { signUp, refreshProfile } = useAuth();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [city, setCity] = useState('');
  const [cityLat, setCityLat] = useState<number | null>(null);
  const [cityLng, setCityLng] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [errors, setErrors] = useState<{
    name?: string;
    email?: string;
    password?: string;
  }>({});

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
      const data = await signUp(email, password, name);
      if (data?.user && city.trim() && cityLat != null && cityLng != null) {
        await profilesService.updateProfile(data.user.id, {
          city,
          lat: cityLat,
          lng: cityLng,
        });
        await refreshProfile();
      }
      router.replace('/(tabs)/discover');
    } catch (error: any) {
      Alert.alert('Sign Up Failed', error.message || 'Please try again');
    } finally {
      setLoading(false);
    }
  };

  return (
    <View style={styles.root}>
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
            onPress={() => router.back()}
            activeOpacity={0.7}
          >
            <ArrowLeft size={22} color={Colors.text.primary} />
          </TouchableOpacity>

          {/* ── Hero area ── */}
          <View style={styles.heroSection}>
            <View style={styles.logoWrap}>
              <LinearGradient
                colors={[Palette.gradientStart, Palette.gradientEnd]}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={styles.logoGradient}
              >
                <Sparkles size={28} color="#FFFFFF" />
              </LinearGradient>
            </View>
            <Text style={styles.heroTitle}>Create Account</Text>
            <Text style={styles.heroSubtitle}>
              Join to discover and share local events
            </Text>
          </View>

          {/* ── Form card ── */}
          <View style={styles.formCard}>
            {/* Name */}
            <View style={styles.fieldRow}>
              <View style={styles.fieldIcon}>
                <User size={16} color={Palette.gradientStart} />
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
                <Mail size={16} color={Palette.gradientStart} />
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
                <Lock size={16} color={Palette.gradientStart} />
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

            <View style={styles.fieldSeparator} />

            {/* Location */}
            <View style={styles.fieldRow}>
              <View style={styles.fieldIcon}>
                <MapPin size={16} color={Palette.gradientStart} />
              </View>
              <View style={styles.fieldContent}>
                <AddressSearchInput
                  label="City or area (optional)"
                  value={city}
                  onChangeText={(text) => {
                    setCity(text);
                    if (!text.trim()) {
                      setCityLat(null);
                      setCityLng(null);
                    }
                  }}
                  onSelect={(result) => {
                    setCity(result.formattedAddress);
                    setCityLat(result.lat);
                    setCityLng(result.lng);
                  }}
                  placeholder="e.g. San Francisco, Bay Area"
                  approximate
                />
                <Text style={styles.locationHint}>
                  Helps us show events near you
                </Text>
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
        shadowColor: Palette.gradientStart,
        shadowOffset: { width: 0, height: 6 },
        shadowOpacity: 0.25,
        shadowRadius: 16,
      },
      android: { elevation: 8 },
    }),
  },
  logoGradient: {
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
  locationHint: {
    fontSize: Typography.sizes.xs,
    fontFamily: Typography.fontFamily,
    color: Colors.text.tertiary,
    marginTop: 4,
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
    color: Palette.gradientStart,
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
    borderColor: Palette.gradientStart,
    backgroundColor: Palette.accentSoft,
  },
  signInBtnText: {
    fontSize: Typography.sizes.md,
    fontFamily: Typography.fontFamilies.semibold,
    fontWeight: Typography.weights.semibold,
    color: Palette.gradientStart,
  },
});