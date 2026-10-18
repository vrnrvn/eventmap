# Push Notifications Setup (Dev & Prod)

This is an optional hosted-integration guide. The default local app disables
device push and does not use Firebase. The old project's Firebase configuration
has been removed. Only follow this guide if you deliberately re-enable Android
push with your own new Firebase project and credentials.

FCM credentials are shared across all build profiles (development, preview, production). One setup works for both.

## 1. Firebase Console

1. Go to [Firebase Console](https://console.firebase.google.com/) → your project
2. **Add Android app** (if not already):
   - Package name: `com.eventmap.app` (must match app.json)
   - Download `google-services.json` → save to project root: `./google-services.json`

## 2. FCM V1 Service Account Key

1. Firebase Console → Project settings → [Service accounts](https://console.firebase.google.com/project/_/settings/serviceaccounts/adminsdk)
2. Click **Generate New Private Key** → confirm → download the JSON file
3. **Do not commit** this file (it's in `.gitignore`)

## 3. Upload to EAS

```bash
eas credentials
```

- Select **Android**
- Select **production** (or the profile you use for builds)
- Choose **Google Service Account** → **Upload a new service account key**
- Select the downloaded JSON file

This config applies to all Android builds (dev, preview, prod).

## 4. Verify

- `app.config.ts` picks up your ignored `google-services.json` only when provided
- `google-services.json` exists in project root
- FCM key uploaded via `eas credentials`

## 5. Rebuild

After adding `google-services.json`, create a new build:

```bash
eas build --profile preview --platform android
```

Or for production:

```bash
eas build --profile production --platform android
```
