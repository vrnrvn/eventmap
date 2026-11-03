import { useEffect, useRef, useState } from 'react';
import { Text, AppState } from 'react-native';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import * as SplashScreen from 'expo-splash-screen';
import {
  useFonts,
  PlusJakartaSans_400Regular,
  PlusJakartaSans_500Medium,
  PlusJakartaSans_600SemiBold,
  PlusJakartaSans_700Bold,
  PlusJakartaSans_800ExtraBold,
} from '@expo-google-fonts/plus-jakarta-sans';
import {
  DMSans_400Regular,
  DMSans_500Medium,
  DMSans_600SemiBold,
  DMSans_700Bold,
} from '@expo-google-fonts/dm-sans';
import {
  Inter_400Regular,
  Inter_500Medium,
  Inter_600SemiBold,
} from '@expo-google-fonts/inter';
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
import { markNotificationAsRead } from '@/services/notifications';
import { router } from 'expo-router';
import * as Linking from 'expo-linking';
import { BrandedSplashScreen } from '@/components/BrandedSplashScreen';
import { AppToast } from '@/components/AppToast';

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
 * session is known are queued; once auth resolves they're flushed if the user
 * is signed in and onboarded, and dropped otherwise (the tabs guard would
 * bounce them anyway — dropping avoids a redirect flash).
 */
function PushNavigationGate() {
  const { session, loading, profileError, hasCompletedOnboarding } = useAuth();
  const pendingRef = useRef<string | null>(null);
  const canNavigate = !loading && !!session && !profileError && hasCompletedOnboarding;
  const canNavigateRef = useRef(canNavigate);
  canNavigateRef.current = canNavigate;
  const authKnown = !loading;
  const authKnownRef = useRef(authKnown);
  authKnownRef.current = authKnown;

  useEffect(() => {
    const cleanup = setupNotificationResponseHandlers((data) => {
      const path = resolveNotificationPath(data);
      // dispatch_push_for_notification (20260228110000) ships the row id;
      // tapping the push is a read, so clear it rather than leaving the tab
      // badge stale until the user opens the notification centre.
      const notificationId = data && typeof data.notificationId === 'string' ? data.notificationId : null;
      if (notificationId) {
        void markNotificationAsRead(notificationId).catch(() => {});
      }
      if (canNavigateRef.current) {
        router.push(path as never);
      } else if (!authKnownRef.current) {
        pendingRef.current = path; // auth still resolving: queue the latest tap
      }
      // Known signed-out / un-onboarded: drop the navigation.
    });
    return () => cleanup?.();
  }, []);

  useEffect(() => {
    if (!authKnown || !pendingRef.current) return;
    const path = pendingRef.current;
    pendingRef.current = null;
    if (canNavigate) {
      router.push(path as never);
    }
  }, [authKnown, canNavigate]);

  return null;
}

SplashScreen.preventAutoHideAsync();

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Lists stay fresh via focus refetch; a short staleTime avoids a
      // duplicate request when two screens mount the same query back to back.
      staleTime: 30_000,
      retry: 1,
      refetchOnWindowFocus: true,
    },
  },
});

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

export default function RootLayout() {
  useFrameworkReady();
  useReactQueryAppStateFocus();
  const [showBrandedSplash, setShowBrandedSplash] = useState(true);

  const [fontsLoaded, fontError] = useFonts({
    PlusJakartaSans_400Regular,
    PlusJakartaSans_500Medium,
    PlusJakartaSans_600SemiBold,
    PlusJakartaSans_700Bold,
    PlusJakartaSans_800ExtraBold,
    DMSans_400Regular,
    DMSans_500Medium,
    DMSans_600SemiBold,
    DMSans_700Bold,
    Inter_400Regular,
    Inter_500Medium,
    Inter_600SemiBold,
  });

  useEffect(() => {
    if (fontsLoaded || fontError) {
      SplashScreen.hideAsync();
    }
  }, [fontsLoaded, fontError]);

  useEffect(() => {
    if (!fontsLoaded && !fontError) {
      return;
    }

    const timeout = setTimeout(() => {
      setShowBrandedSplash(false);
    }, 1150);

    return () => clearTimeout(timeout);
  }, [fontError, fontsLoaded]);

  useEffect(() => {
    if (fontsLoaded) {
      (Text as any).defaultProps = (Text as any).defaultProps || {};
      (Text as any).defaultProps.style = { fontFamily: Typography.fontFamily };
    }
  }, [fontsLoaded]);

  if (!fontsLoaded && !fontError) {
    return null;
  }

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <QueryClientProvider client={queryClient}>
        <AuthProvider>
          <AuthRedirectHandler />
          <PushNavigationGate />
          <AppProvider>
            <PremiumProvider>
              <SearchProvider>
              <BottomSheetModalProvider>
                <Stack screenOptions={{ headerShown: false }}>
                <Stack.Screen name="(auth)" options={{ headerShown: false }} />
                <Stack.Screen name="(onboarding)" options={{ headerShown: false }} />
                <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
                <Stack.Screen name="premium" options={{ headerShown: false }} />
                <Stack.Screen name="+not-found" />
              </Stack>
              <BrandedSplashScreen visible={showBrandedSplash} />
              <AppToast />
              </BottomSheetModalProvider>
              </SearchProvider>
              <StatusBar style="auto" />
            </PremiumProvider>
          </AppProvider>
        </AuthProvider>
      </QueryClientProvider>
    </GestureHandlerRootView>
  );
}
