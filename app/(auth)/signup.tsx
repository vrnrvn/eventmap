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
  Image,
  TextInput,
  Alert,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { useAuth } from '@/contexts/AuthContext';
import { Colors, Typography, BorderRadius } from '@/constants/theme';
import { ArrowLeft, Eye, EyeOff, ArrowRight } from 'lucide-react-native';
import { GoogleIcon } from '@/components/icons/BrandIcons';
import { oauthEnabled } from '@/services/runtime';

export default function SignupScreen() {
  const insets = useSafeAreaInsets();
  const { signUp, signInWithOAuth } = useAuth();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [oauthLoading, setOauthLoading] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const validate = () => {
    const next: Record<string, string> = {};
    if (!name.trim()) next.name = 'Full name is required';
    if (!email.trim()) next.email = 'Email is required';
    else if (!/\S+@\S+\.\S+/.test(email)) next.email = 'Email is invalid';
    if (!password) next.password = 'Password is required';
    else if (password.length < 6) next.password = 'Minimum 6 characters';
    if (confirmPassword !== password) next.confirm = 'Passwords do not match';
    setErrors(next);
    return Object.keys(next).length === 0;
  };

  const handleSignUp = async () => {
    if (!validate()) return;
    setLoading(true);
    try {
      await signUp(email, password, name);
      Alert.alert(
        'Check Your Email',
        'Please verify your email, then sign in to continue.',
        [{ text: 'OK', onPress: () => router.replace('/(auth)/login') }]
      );
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      Alert.alert('Sign Up Failed', msg || 'Please try again');
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
      Alert.alert('Google Sign Up', msg.includes('cancelled') ? 'Sign up was cancelled.' : msg);
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
            paddingHorizontal: 22,
          }}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <TouchableOpacity style={styles.backBtn} onPress={() => router.back()} activeOpacity={0.75}>
            <ArrowLeft size={20} color={Colors.text.primary} />
          </TouchableOpacity>

          <View style={styles.hero}>
            <View style={styles.logoTile}>
              <Image source={require('@/assets/images/EMlogo.png')} style={[styles.logo, styles.logoTint]} resizeMode="contain" />
            </View>
            <Text style={styles.heroTitle}>Create an Account</Text>
            <Text style={styles.heroSub}>Join our community and explore your city.</Text>
          </View>

          <View style={styles.card}>
            <Field label="Full Name" value={name} onChangeText={setName} placeholder="Enter your full name" />
            {errors.name ? <Text style={styles.errorText}>{errors.name}</Text> : null}

            <Field label="Email Address" value={email} onChangeText={setEmail} placeholder="name@example.com" keyboardType="email-address" autoCapitalize="none" />
            {errors.email ? <Text style={styles.errorText}>{errors.email}</Text> : null}

            <View style={styles.fieldBlock}>
              <Text style={styles.fieldLabel}>Password</Text>
              <View style={styles.inputShell}>
                <TextInput
                  value={password}
                  onChangeText={setPassword}
                  placeholder="••••••••"
                  placeholderTextColor={Colors.text.tertiary}
                  secureTextEntry={!showPassword}
                  style={styles.input}
                />
                <TouchableOpacity onPress={() => setShowPassword((v) => !v)}>
                  {showPassword ? <EyeOff size={21} color={Colors.text.tertiary} /> : <Eye size={21} color={Colors.text.tertiary} />}
                </TouchableOpacity>
              </View>
            </View>
            {errors.password ? <Text style={styles.errorText}>{errors.password}</Text> : null}

            <Field label="Confirm Password" value={confirmPassword} onChangeText={setConfirmPassword} placeholder="••••••••" secureTextEntry />
            {errors.confirm ? <Text style={styles.errorText}>{errors.confirm}</Text> : null}

            <TouchableOpacity style={styles.ctaWrap} onPress={handleSignUp} disabled={loading} activeOpacity={0.9}>
              <LinearGradient colors={[Colors.primary, Colors.secondary]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={styles.cta}>
                {loading ? (
                  <ActivityIndicator color="#fff" />
                ) : (
                  <>
                    <Text style={styles.ctaText}>Sign Up</Text>
                    <ArrowRight size={22} color="#FFFFFF" />
                  </>
                )}
              </LinearGradient>
            </TouchableOpacity>

            {oauthEnabled && <><View style={styles.divider}>
              <View style={styles.dividerLine} />
              <Text style={styles.dividerText}>OR CONTINUE WITH</Text>
              <View style={styles.dividerLine} />
            </View>

            <TouchableOpacity style={styles.googleBtn} onPress={handleGoogle} activeOpacity={0.85} disabled={oauthLoading}>
              <GoogleIcon size={20} />
              <Text style={styles.googleText}>{oauthLoading ? 'Signing up...' : 'Sign up with Google'}</Text>
            </TouchableOpacity>
            </>}
          </View>

          <View style={styles.footer}>
            <Text style={styles.footerText}>Already have an account?</Text>
            <TouchableOpacity onPress={() => router.push('/(auth)/login')}>
              <Text style={styles.footerLink}>Log In</Text>
            </TouchableOpacity>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

function Field({
  label,
  value,
  onChangeText,
  placeholder,
  secureTextEntry,
  keyboardType,
  autoCapitalize,
}: {
  label: string;
  value: string;
  onChangeText: (value: string) => void;
  placeholder: string;
  secureTextEntry?: boolean;
  keyboardType?: 'email-address' | 'default';
  autoCapitalize?: 'none' | 'sentences' | 'words' | 'characters';
}) {
  return (
    <View style={styles.fieldBlock}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <View style={styles.inputShell}>
        <TextInput
          value={value}
          onChangeText={onChangeText}
          placeholder={placeholder}
          placeholderTextColor={Colors.text.tertiary}
          secureTextEntry={secureTextEntry}
          keyboardType={keyboardType}
          autoCapitalize={autoCapitalize}
          style={styles.input}
        />
      </View>
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
    fontSize: 50,
    lineHeight: 56,
    color: Colors.text.primary,
    fontFamily: Typography.displayFontFamilies.extrabold,
    fontWeight: '800',
    letterSpacing: -0.8,
    textAlign: 'center',
  },
  heroSub: {
    marginTop: 6,
    fontSize: 18,
    lineHeight: 30,
    color: Colors.text.secondary,
    fontFamily: Typography.fontFamilies.medium,
    textAlign: 'center',
  },
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 40,
    padding: 22,
    borderWidth: 1,
    borderColor: 'rgba(0,0,0,0.04)',
  },
  fieldBlock: { marginBottom: 14 },
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
  errorText: {
    marginTop: -8,
    marginBottom: 10,
    marginLeft: 4,
    color: Colors.error,
    fontSize: 12,
    fontFamily: Typography.fontFamilies.medium,
  },
  ctaWrap: { marginTop: 8, borderRadius: BorderRadius.round, overflow: 'hidden' },
  cta: {
    height: 64,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: 8,
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
