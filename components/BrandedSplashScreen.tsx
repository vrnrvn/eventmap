import { useEffect } from 'react';
import { Image, StyleSheet, Text, View } from 'react-native';
import Animated, {
  Easing,
  FadeOut,
  interpolate,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withSequence,
  withTiming,
} from 'react-native-reanimated';
import { LinearGradient } from 'expo-linear-gradient';

import { Colors, Shadows, Typography } from '@/constants/theme';

type BrandedSplashScreenProps = {
  visible: boolean;
};

const AnimatedImage = Animated.createAnimatedComponent(Image);

export function BrandedSplashScreen({ visible }: BrandedSplashScreenProps) {
  const progress = useSharedValue(0);
  const pulse = useSharedValue(0);

  useEffect(() => {
    if (!visible) {
      return;
    }

    progress.value = withTiming(1, {
      duration: 900,
      easing: Easing.out(Easing.cubic),
    });

    pulse.value = withDelay(
      120,
      withSequence(
        withTiming(1, { duration: 600, easing: Easing.out(Easing.quad) }),
        withTiming(0.2, { duration: 900, easing: Easing.inOut(Easing.quad) }),
      ),
    );
  }, [progress, pulse, visible]);

  const logoStyle = useAnimatedStyle(() => ({
    opacity: interpolate(progress.value, [0, 1], [0, 1]),
    transform: [
      { scale: interpolate(progress.value, [0, 0.7, 1], [0.78, 1.03, 1]) },
      { translateY: interpolate(progress.value, [0, 1], [18, 0]) },
    ],
  }));

  const haloStyle = useAnimatedStyle(() => ({
    opacity: interpolate(pulse.value, [0, 1], [0.2, 0.5]),
    transform: [{ scale: interpolate(pulse.value, [0, 1], [1, 1.18]) }],
  }));

  const wordmarkStyle = useAnimatedStyle(() => ({
    opacity: interpolate(progress.value, [0.25, 1], [0, 1]),
    transform: [{ translateY: interpolate(progress.value, [0.25, 1], [10, 0]) }],
  }));

  if (!visible) {
    return null;
  }

  return (
    <Animated.View exiting={FadeOut.duration(420)} style={StyleSheet.absoluteFill}>
      <LinearGradient
        colors={[Colors.primaryDark, Colors.primary, Colors.secondary]}
        start={{ x: 0.1, y: 0 }}
        end={{ x: 0.95, y: 1 }}
        style={styles.container}
      >
        <View style={styles.glowTop} />
        <View style={styles.glowBottom} />

        <Animated.View style={[styles.halo, haloStyle]} />

        <Animated.View style={[styles.logoShell, logoStyle]}>
          <LinearGradient
            colors={['rgba(255,255,255,0.22)', 'rgba(255,255,255,0.08)']}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={styles.logoFrame}
          >
            <View style={styles.logoCore}>
              <AnimatedImage
                source={require('@/assets/images/EMlogo.png')}
                style={[styles.logo, styles.logoTint]}
                resizeMode="contain"
              />
            </View>
          </LinearGradient>
        </Animated.View>

        <Animated.View style={[styles.wordmarkWrap, wordmarkStyle]}>
          <Text style={styles.title}>Event Maps</Text>
          <Text style={styles.subtitle}>Find the signal in your city.</Text>
        </Animated.View>
      </LinearGradient>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.secondaryDark,
  },
  glowTop: {
    position: 'absolute',
    top: -140,
    right: -80,
    width: 280,
    height: 280,
    borderRadius: 999,
    backgroundColor: 'rgba(232, 168, 56, 0.16)',
  },
  glowBottom: {
    position: 'absolute',
    bottom: -120,
    left: -50,
    width: 240,
    height: 240,
    borderRadius: 999,
    backgroundColor: 'rgba(196, 92, 62, 0.2)',
  },
  halo: {
    position: 'absolute',
    width: 184,
    height: 184,
    borderRadius: 999,
    backgroundColor: 'rgba(250, 248, 245, 0.12)',
  },
  logoShell: {
    ...Shadows.lg,
  },
  logoFrame: {
    padding: 14,
    borderRadius: 40,
  },
  logoCore: {
    width: 132,
    height: 132,
    borderRadius: 30,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(250, 248, 245, 0.98)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.24)',
  },
  logo: {
    width: 98,
    height: 98,
  },
  logoTint: {
    tintColor: Colors.primary,
  },
  wordmarkWrap: {
    marginTop: 28,
    alignItems: 'center',
    gap: 6,
  },
  title: {
    color: Colors.text.inverse,
    fontSize: 34,
    fontFamily: Typography.displayFont,
    letterSpacing: 0.4,
  },
  subtitle: {
    color: 'rgba(250, 248, 245, 0.74)',
    fontSize: 15,
    fontFamily: Typography.fontFamily,
    letterSpacing: 0.2,
  },
});
