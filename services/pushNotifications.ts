import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import Constants from 'expo-constants';
import { supabase } from './supabase';

let configured = false;

export function configureNotificationHandler() {
  if (configured) return;

  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowAlert: true,
      shouldPlaySound: true,
      shouldSetBadge: true,
      shouldShowBanner: true,
      shouldShowList: true,
    }),
  });

  configured = true;
}

function getProjectId(): string | null {
  const fromExpoConfig = (Constants.expoConfig as any)?.extra?.eas?.projectId;
  const fromEasConfig = (Constants as any).easConfig?.projectId;
  return fromExpoConfig ?? fromEasConfig ?? null;
}

export async function registerPushToken(): Promise<string | null> {
  configureNotificationHandler();

  const existing = await Notifications.getPermissionsAsync();
  let finalStatus = existing.status;

  if (finalStatus !== 'granted') {
    const requested = await Notifications.requestPermissionsAsync();
    finalStatus = requested.status;
  }

  if (finalStatus !== 'granted') {
    return null;
  }

  const projectId = getProjectId();
  if (!projectId) {
    throw new Error(
      'Missing EAS project ID for push notifications. Check app.json expo.extra.eas.projectId.'
    );
  }

  let tokenResponse;
  try {
    tokenResponse = await Notifications.getExpoPushTokenAsync({ projectId });
  } catch {
    // Common on simulators/emulators without a real push service.
    return null;
  }
  const token = tokenResponse.data;

  await (supabase as any).rpc('upsert_push_token', {
    p_token: token,
    p_platform: Platform.OS,
    p_device_id: `${(Constants as any).deviceName ?? 'device'}-${Platform.OS}`,
  });

  return token;
}

export async function deactivatePushToken(token: string): Promise<void> {
  if (!token) return;
  await (supabase as any).rpc('deactivate_push_token', {
    p_token: token,
  });
}
