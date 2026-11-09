import { Platform } from 'react-native';
import Constants from 'expo-constants';
import { supabase } from './supabase';
import { pushEnabled } from './runtime';

const isExpoGo = Constants.appOwnership === 'expo';

function getNotifications(): typeof import('expo-notifications') | null {
  if (!pushEnabled) return null;
  if (Platform.OS === 'web') return null;
  if (isExpoGo) return null;
  try {
    return require('expo-notifications');
  } catch {
    return null;
  }
}

let configured = false;

export function configureNotificationHandler() {
  if (configured) return;

  const Notifications = getNotifications();
  if (!Notifications) return;

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

/**
 * Android notification channels. The server picks one per notification type
 * (push_channel_for_type: chat_message/chat_mention -> chat; moderation,
 * report_update, chat_block(ed) -> moderation; everything else -> events;
 * 'default' when the type is empty). A push aimed at a channel the device
 * hasn't created may not be shown on Android 8+, so every id the server can
 * send must exist here. Users can mute each one separately in system settings.
 */
export const ANDROID_CHANNELS = [
  { id: 'events', name: 'Events and reminders', description: 'Reminders, RSVPs, updates to events you follow or host' },
  { id: 'chat', name: 'Event chat', description: 'New messages and mentions in event chats' },
  { id: 'moderation', name: 'Account and moderation', description: 'Reports you made, moderation notices' },
  { id: 'default', name: 'Other', description: 'Anything else from EventMap' },
] as const;

export async function registerPushToken(): Promise<string | null> {
  const Notifications = getNotifications();
  if (!Notifications) return null;

  configureNotificationHandler();

  if (Platform.OS === 'android') {
    for (const channel of ANDROID_CHANNELS) {
      await Notifications.setNotificationChannelAsync(channel.id, {
        name: channel.name,
        description: channel.description,
        importance: Notifications.AndroidImportance.MAX,
        vibrationPattern: [0, 250, 250, 250],
        lightColor: '#FF231F7C',
      });
    }
  }


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

  const appOwnership = (Constants as any).appOwnership ?? 'standalone';

  await (supabase as any).rpc('upsert_push_token', {
    p_token: token,
    p_platform: Platform.OS,
    p_device_id: `${(Constants as any).deviceName ?? 'device'}-${Platform.OS}`,
    p_app_ownership: appOwnership,
  });

  return token;
}

export async function deactivatePushToken(token: string): Promise<void> {
  if (!token) return;
  await (supabase as any).rpc('deactivate_push_token', {
    p_token: token,
  });
}

export type NotificationResponseHandler = (data: Record<string, unknown> | null | undefined) => void;

export function setupNotificationResponseHandlers(
  onResponse: NotificationResponseHandler
): (() => void) | null {
  const Notifications = getNotifications();
  if (!Notifications) return null;

  configureNotificationHandler();

  Notifications.getLastNotificationResponseAsync().then((response) => {
    if (response?.notification.request.content.data) {
      onResponse(response.notification.request.content.data as Record<string, unknown>);
    }
  });

  const subscription = Notifications.addNotificationResponseReceivedListener(
    (response) => {
      const data = response.notification.request.content.data as Record<string, unknown> | undefined;
      onResponse(data);
    }
  );

  return () => subscription.remove();
}
