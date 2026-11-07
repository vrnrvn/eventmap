import { useEffect, useRef, useState } from 'react';
import { Text, AppState } from 'react-native';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import * as SplashScreen from 'expo-splash-screen';
import { useFonts } from 'expo-font';
// Per-weight entry points: the package index require()s every weight and
// italic, which shipped 30+ unused font files in every bundle.
import { PlusJakartaSans_600SemiBold } from '@expo-google-fonts/plus-jakarta-sans/600SemiBold';
import { PlusJakartaSans_700Bold } from '@expo-google-fonts/plus-jakarta-sans/700Bold';
import { PlusJakartaSans_800ExtraBold } from '@expo-google-fonts/plus-jakarta-sans/800ExtraBold';
import { DMSans_400Regular } from '@expo-google-fonts/dm-sans/400Regular';
import { DMSans_500Medium } from '@expo-google-fonts/dm-sans/500Medium';
import { DMSans_600SemiBold } from '@expo-google-fonts/dm-sans/600SemiBold';
import { DMSans_700Bold } from '@expo-google-fonts/dm-sans/700Bold';
import { useFrameworkReady } from '@/hooks/useFrameworkReady';
import { AuthProvider, useAuth } from '@/contexts/AuthContext';
import { AuthRedirectHandler } from '@/components/AuthRedirectHandler';
import { AppProvider } from '@/contexts/AppContext';
import { SearchProvider } from '@/contexts/SearchContext';
import { PremiumProvider } from '@/contexts/PremiumContext';
import { QueryClient, QueryClientProvider, focusManager } from '@tanstack/react-query';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { BottomSheetModalProvider } from '@gorhom/bottom-sheet';
import { Typography } from '@/constants/theme';
import { setupNotificationResponseHandlers } from '@/services/pushNotifications';
import { runOrQueue } from '@/services/pendingWrites';
import { router } from 'expo-router';
import * as Linking from 'expo-linking';
import { BrandedSplashScreen } from '@/components/BrandedSplashScreen';
import { AppToast } from '@/components/AppToast';
import { OfflineBanner } from '@/components/OfflineBanner';
import { QueryCachePersistence } from '@/components/QueryCachePersistence';
import { PendingWritesSync } from '@/components/PendingWritesSync';
import { startConnectivityMonitoring } from '@/services/connectivity';
import { shouldRetryQuery } from '@/utils/queryRetry';
import { PERSISTED_QUERY } from '@/utils/queryPersistence';
import { queryKeys } from '@/hooks/queryKeys';

function resolveNotificationPath(data: Record<string, unknown> | null | undefined): string {
  if (!data || typeof data !== 'object') {
    return '/(tabs)/notifications';
  }
  const eventId = data.eventId;
  const businessId = data.businessId;
  const linkUrl = data.linkUrl;

  if (typeof eventId === 'string' && eventId.length > 0) {
    const isChat = data.kind === 'chat' || data.type === 'chat_message' || data.type === 'chat_mention';
    const messageId = typeof data.messageId === 'string' ? data.messageId : null;
    const chatPath = messageId ? `/event-chat/${eventId}?messageId=${messageId}` : `/event-chat/${eventId}`;
    return isChat ? chatPath : `/event/${eventId}`;
  }
  if (typeof businessId === 'string' && businessId.length > 0) {
    return `/business/${businessId}`;
  }
  if (typeof linkUrl === 'string' && linkUrl.startsWith('myapp://')) {
    const parsed = Linking.parse(linkUrl);
    return parsed.path ? `/${parsed.path}` : '/(tabs)/notifications';
  }
  return '/(tabs)/notifications';
}

/**
 * Push-notification navigation, gated on auth. Taps that arrive before the
 * session is known, or while the profile can't load (e.g. opened offline),
 * are queued and flushed once the user can navigate. Taps for a known
 * signed-out / un-onboarded user are dropped (the tabs guard would bounce
 * them anyway — dropping avoids a redirect flash).
 */
function PushNavigationGate() {
  const { session, loading, profileError, hasCompletedOnboarding } = useAuth();
  const pendingRef = useRef<string | null>(null);
  const canNavigate = !loading && !!session && !profileError && hasCompletedOnboarding;
  const canNavigateRef = useRef(canNavigate);
  canNavigateRef.current = canNavigate;
  const authKnown = !loading;
  // Still worth holding a tap for: auth resolving, or a signed-in user whose
  // profile failed to load and is being retried.
  const mayNavigateSoon = !authKnown || (!!session && profileError);
  const mayNavigateSoonRef = useRef(mayNavigateSoon);
  mayNavigateSoonRef.current = mayNavigateSoon;

  useEffect(() => {
    const cleanup = setupNotificationResponseHandlers((data) => {
      const path = resolveNotificationPath(data);
      // dispatch_push_for_notification (20260228110000) ships the row id;
      // tapping the push is a read, so clear it rather than leaving the tab
      // badge stale until the user opens the notification centre.
      const notificationId = data && typeof data.notificationId === 'string' ? data.notificationId : null;
      if (notificationId) {
        void runOrQueue({ kind: 'notificationRead', targetId: notificationId }).catch(() => {});
      }
      if (canNavigateRef.current) {
        router.push(path as never);
      } else if (mayNavigateSoonRef.current) {
        pendingRef.current = path; // can't navigate yet: queue the latest tap
      }
      // Known signed-out / un-onboarded: drop the navigation.
    });
    return () => cleanup?.();
  }, []);

  useEffect(() => {
    if (mayNavigateSoon || !pendingRef.current) return;
    const path = pendingRef.current;
    pendingRef.current = null;
    if (canNavigate) {
      router.push(path as never);
    }
  }, [mayNavigateSoon, canNavigate]);

  return null;
}

SplashScreen.preventAutoHideAsync();

startConnectivityMonitoring();

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Lists stay fresh via focus refetch; a short staleTime avoids a
      // duplicate request when two screens mount the same query back to back.
      staleTime: 30_000,
      // Connection failures and 5xx only, never while offline (see
      // utils/queryRetry for why).
      retry: shouldRetryQuery,
      // Always try the request (offline detection can lag, and a failed
      // attempt keeps cached data on screen) instead of parking queries as
      // "paused", which would leave a first load on a spinner indefinitely.
      networkMode: 'offlineFirst',
      refetchOnWindowFocus: true,
    },
  },
});

// Event pages mirror what they show into these entries (EventDetail), so
// recently opened events are kept on the device and open offline.
queryClient.setQueryDefaults(queryKeys.eventDetailsPrefix(), PERSISTED_QUERY);
// Same for the notifications tab's first page (notifications.tsx).
queryClient.setQueryDefaults(queryKeys.notificationsPrefix(), PERSISTED_QUERY);
// And My Events' first page per tab (MyEvents.tsx).
queryClient.setQueryDefaults(['events', 'mine'], PERSISTED_QUERY);
// And the most recent chat rooms (event-chat/[id].tsx).
queryClient.setQueryDefaults(queryKeys.chatRoomPrefix(), PERSISTED_QUERY);
// And Discover's last area (discover.tsx).
queryClient.setQueryDefaults(queryKeys.discoverLastArea(), PERSISTED_QUERY);

/**
 * React Query's "window focus" has no meaning in React Native; feed it the
 * AppState so queries refetch when the app returns to the foreground.
 */
function useReactQueryAppStateFocus() {
  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      focusManager.setFocused(state === 'active');
    });
    return () => sub.remove();
  }, []);
}

/** Shortest time the branded splash shows, so it never flashes. */
const SPLASH_MIN_MS = 450;
/** Never hold the app behind the splash longer than this. */
const SPLASH_MAX_MS = 1150;

/**
 * The branded splash is an overlay; the app mounts and loads underneath it.
 * It used to stay a fixed 1150 ms after fonts loaded regardless of readiness;
 * now it lifts as soon as the session restore (and profile/snapshot) settles,
 * after a short minimum, and still caps at the old duration.
 */
function StartupSplash() {
  const { loading } = useAuth();
  const [minElapsed, setMinElapsed] = useState(false);
  const [maxElapsed, setMaxElapsed] = useState(false);
  useEffect(() => {
    const min = setTimeout(() => setMinElapsed(true), SPLASH_MIN_MS);
    const max = setTimeout(() => setMaxElapsed(true), SPLASH_MAX_MS);
    return () => {
      clearTimeout(min);
      clearTimeout(max);
    };
  }, []);
  const [dismissed, setDismissed] = useState(false);
  useEffect(() => {
    if (!dismissed && (maxElapsed || (minElapsed && !loading))) setDismissed(true);
  }, [dismissed, maxElapsed, minElapsed, loading]);
  return <BrandedSplashScreen visible={!dismissed} />;
}

export default function RootLayout() {
  useFrameworkReady();
  useReactQueryAppStateFocus();

  const [fontsLoaded, fontError] = useFonts({
    PlusJakartaSans_600SemiBold,
    PlusJakartaSans_700Bold,
    PlusJakartaSans_800ExtraBold,
    DMSans_400Regular,
    DMSans_500Medium,
    DMSans_600SemiBold,
    DMSans_700Bold,
  });

  useEffect(() => {
    if (fontsLoaded || fontError) {
      SplashScreen.hideAsync();
    }
  }, [fontsLoaded, fontError]);


  useEffect(() => {
    if (fontsLoaded) {
      (Text as any).defaultProps = (Text as any).defaultProps || {};
      (Text as any).defaultProps.style = { fontFamily: Typography.fontFamily };
    }
  }, [fontsLoaded]);

  // Providers mount right away so session restore, the device-cache
  // restore and the business load run WHILE fonts load (the whole tree used
  // to wait for all font files first). Only things that draw text or
  // navigate wait for fonts; the native splash covers the screen until then.
  const uiReady = fontsLoaded || !!fontError;

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <QueryClientProvider client={queryClient}>
        <AuthProvider>
          {uiReady ? (
            <>
              <AuthRedirectHandler />
              <PushNavigationGate />
            </>
          ) : null}
          <QueryCachePersistence>
          <PendingWritesSync />
          <AppProvider>
            <PremiumProvider>
              <SearchProvider>
              <BottomSheetModalProvider>
              {uiReady ? (
                <>
                  <Stack screenOptions={{ headerShown: false }}>
                    <Stack.Screen name="(auth)" options={{ headerShown: false }} />
                    <Stack.Screen name="(onboarding)" options={{ headerShown: false }} />
                    <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
                    <Stack.Screen name="premium" options={{ headerShown: false }} />
                    <Stack.Screen name="+not-found" />
                  </Stack>
                  <StartupSplash />
                  <OfflineBanner />
                  <AppToast />
                </>
              ) : null}
              </BottomSheetModalProvider>
              </SearchProvider>
              {uiReady ? <StatusBar style="auto" /> : null}
            </PremiumProvider>
          </AppProvider>
          </QueryCachePersistence>
        </AuthProvider>
      </QueryClientProvider>
    </GestureHandlerRootView>
  );
}
