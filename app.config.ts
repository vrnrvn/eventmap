import type { ConfigContext, ExpoConfig } from 'expo/config';
import { existsSync } from 'node:fs';

export default ({ config }: ConfigContext): ExpoConfig => {
  const hosted = process.env.EXPO_PUBLIC_BACKEND_MODE === 'hosted';
  const oauth = process.env.EXPO_PUBLIC_ENABLE_OAUTH === 'true';
  return {
    ...config,
    name: config.name ?? 'eventmap',
    slug: config.slug ?? 'eventmap',
    owner: hosted ? config.owner : undefined,
    extra: { ...config.extra, eas: hosted ? config.extra?.eas : undefined },
    updates: hosted ? config.updates : { enabled: false },
    android: {
      ...config.android,
      googleServicesFile: existsSync('./google-services.json') ? './google-services.json' : undefined,
    },
    plugins: config.plugins?.filter((plugin) => oauth ||
      (Array.isArray(plugin) ? plugin[0] : plugin) !== '@react-native-google-signin/google-signin'),
  };
};
