import { useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, Animated, Platform, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { CloudAlert, CloudOff, Wifi } from '@/components/icons.generated';
import { Colors, Typography, Spacing, BorderRadius, Shadows } from '@/constants/theme';
import { useConnectivity } from '@/services/connectivity';
import type { ConnectivityStatus } from '@/utils/connectivity';

/** How long "Back online" stays up after the connection recovers. */
const RECOVERED_MS = 2000;

type BannerKind = 'offline' | 'degraded' | 'recovered';

const COPY: Record<BannerKind, string> = {
  offline: "You're offline · Showing what's already loaded",
  degraded: 'Weak connection · Some things may not load',
  recovered: 'Back online',
};

/** Height the toast stack leaves free while the banner is up (AppToast). */
export const OFFLINE_BANNER_OFFSET = 44;

/**
 * One calm, app-wide connection indicator (docs/OFFLINE_PLAN.md §3.9),
 * mounted once in app/_layout.tsx. A compact pill under the status bar that
 * ignores touches, so the header beneath stays usable. While it is up,
 * background "Couldn't refresh" toasts are suppressed (utils/notify).
 */
export function OfflineBanner() {
  const insets = useSafeAreaInsets();
  const status = useConnectivity();
  const kind = useBannerKind(status);
  const opacity = useRef(new Animated.Value(0)).current;
  // Keep the last kind rendered during the fade-out.
  const [shown, setShown] = useState<BannerKind | null>(kind);

  useEffect(() => {
    if (kind) {
      setShown(kind);
      // Android's live region (below) and web's role="alert" already speak
      // the change; announcing there too would read the banner twice.
      if (Platform.OS === 'ios') AccessibilityInfo.announceForAccessibility(COPY[kind]);
    }
    const anim = Animated.timing(opacity, {
      toValue: kind ? 1 : 0,
      duration: kind ? 180 : 220,
      useNativeDriver: Platform.OS !== 'web',
    });
    anim.start(({ finished }) => {
      if (finished && !kind) setShown(null);
    });
    return () => anim.stop();
  }, [kind, opacity]);

  if (!shown) return null;
  const Icon = shown === 'offline' ? CloudOff : shown === 'degraded' ? CloudAlert : Wifi;
  const recovered = shown === 'recovered';

  return (
    <View
      pointerEvents="none"
      style={[styles.wrap, { top: insets.top + (Platform.OS === 'web' ? 12 : 6) }]}
    >
      <Animated.View
        style={[styles.pill, recovered && styles.pillRecovered, { opacity }]}
        accessibilityRole="alert"
        accessibilityLiveRegion="polite"
        testID="offline-banner"
      >
        <Icon size={15} color={Colors.white} />
        <Text style={styles.text} numberOfLines={1}>
          {COPY[shown]}
        </Text>
      </Animated.View>
    </View>
  );
}

/**
 * offline / degraded while impaired; "recovered" for RECOVERED_MS after it
 * clears; null otherwise. Exported so the toast host can make room for it.
 */
export function useBannerKind(status: ConnectivityStatus): BannerKind | null {
  const [recovered, setRecovered] = useState(false);
  const previous = useRef(status);

  useEffect(() => {
    const was = previous.current;
    previous.current = status;
    if (status !== 'online') {
      setRecovered(false);
      return;
    }
    if (was === 'online') return;
    setRecovered(true);
    const timer = setTimeout(() => setRecovered(false), RECOVERED_MS);
    return () => clearTimeout(timer);
  }, [status]);

  if (status === 'offline') return 'offline';
  if (status === 'degraded') return 'degraded';
  return recovered ? 'recovered' : null;
}

const styles = StyleSheet.create({
  wrap: {
    position: 'absolute',
    left: 0,
    right: 0,
    alignItems: 'center',
    paddingHorizontal: Spacing.lg,
    zIndex: 10000,
    ...(Platform.OS === 'android' ? { elevation: 25 } : null),
  },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs + 2,
    maxWidth: 440,
    backgroundColor: Colors.text.primary,
    borderRadius: BorderRadius.round,
    paddingVertical: Spacing.xs + 3,
    paddingHorizontal: Spacing.md - 2,
    ...Shadows.md,
  },
  pillRecovered: {
    backgroundColor: Colors.successText,
  },
  text: {
    flexShrink: 1,
    color: Colors.white,
    fontSize: Typography.sizes.xs,
    fontFamily: Typography.fontFamilies.semibold,
    fontWeight: Typography.weights.semibold,
  },
});
