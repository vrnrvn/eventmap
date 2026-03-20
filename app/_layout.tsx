import { useEffect, useState } from 'react';
import { Text } from 'react-native';
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
import { AuthProvider } from '@/contexts/AuthContext';
import { AuthRedirectHandler } from '@/components/AuthRedirectHandler';
import { AppProvider } from '@/contexts/AppContext';
import { SearchProvider } from '@/contexts/SearchContext';
import { PremiumProvider } from '@/contexts/PremiumContext';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { BottomSheetModalProvider } from '@gorhom/bottom-sheet';
import { Typography } from '@/constants/theme';
import { setupNotificationResponseHandlers } from '@/services/pushNotifications';
import { router } from 'expo-router';
import * as Linking from 'expo-linking';
import { BrandedSplashScreen } from '@/components/BrandedSplashScreen';

function handleNotificationData(data: Record<string, unknown> | null | undefined) {
  if (!data || typeof data !== 'object') {
    router.push('/(tabs)/notifications' as never);
    return;
  }
  const eventId = data.eventId;
  const businessId = data.businessId;
  const linkUrl = data.linkUrl;

  if (typeof eventId === 'string' && eventId.length > 0) {
    router.push(`/event/${eventId}` as never);
    return;
  }
  if (typeof businessId === 'string' && businessId.length > 0) {
    router.push(`/business/${businessId}` as never);
    return;
  }
  if (typeof linkUrl === 'string' && linkUrl.startsWith('myapp://')) {
    const parsed = Linking.parse(linkUrl);
    const path = parsed.path ? `/${parsed.path}` : '/(tabs)/notifications';
    router.push(path as never);
    return;
  }
  router.push('/(tabs)/notifications' as never);
}

SplashScreen.preventAutoHideAsync();

const queryClient = new QueryClient();

export default function RootLayout() {
  useFrameworkReady();
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

  useEffect(() => {
    const cleanup = setupNotificationResponseHandlers(handleNotificationData);
    return () => cleanup?.();
  }, []);

  if (!fontsLoaded && !fontError) {
    return null;
  }

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <QueryClientProvider client={queryClient}>
        <AuthProvider>
          <AuthRedirectHandler />
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
