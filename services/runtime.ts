export const isLocalBackend = process.env.EXPO_PUBLIC_BACKEND_MODE !== 'hosted';
export const oauthEnabled = process.env.EXPO_PUBLIC_ENABLE_OAUTH === 'true';
export const pushEnabled = process.env.EXPO_PUBLIC_ENABLE_PUSH === 'true';
export const usesGoogleMaps = process.env.EXPO_PUBLIC_MAP_PROVIDER === 'google';
