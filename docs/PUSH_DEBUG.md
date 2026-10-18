# Push Notification Debugging

Device push is disabled in the default local setup. This guide only applies
when explicitly enabled with your own newly configured push project; the old
Firebase configuration is no longer used.

If push notifications aren't appearing on your Android device, follow these steps.

## 1. Verify FCM Credentials (Required for Android)

Android push **requires** Firebase Cloud Messaging (FCM) credentials in your EAS project.

1. Go to [Firebase Console](https://console.firebase.google.com/) → your project
2. Project Settings → Service accounts → Generate new private key (download JSON)
3. Run: `eas credentials` → Android → Push Notifications → Upload the FCM V1 key
4. Ensure `google-services.json` is in your project (EAS Build usually handles this)

Without FCM credentials, **no push notifications will work** on Android.

## 2. Test with Expo Push Tool

1. Get your push token:
   - Run the app, log in, and check Metro/terminal for `[Push] Token registered: ExponentPushToken[...]`
   - Or query Supabase: `SELECT token FROM user_push_tokens WHERE user_id = 'YOUR_USER_ID' AND app_ownership = 'standalone'`
2. Go to [expo.dev/notifications](https://expo.dev/notifications)
3. Paste your token and send a test notification

- **If the test works**: The issue is in our backend (Supabase trigger, pg_net, or migration).
- **If the test fails**: FCM credentials or app setup is the problem.

## 3. Verify Migration Applied

Run in Supabase SQL Editor:

```sql
-- Check if dispatch function has channelId
SELECT prosrc FROM pg_proc WHERE proname = 'dispatch_push_for_notification';
-- Should contain 'channelId' and 'default'
```

## 4. Check Notification Permissions

On device: Settings → Apps → EventMap → Notifications → Ensure enabled.

## 5. Test with App in Background

Push notifications often show only when the app is in the background. Trigger a notification (e.g. RSVP) then **put the app in background** (home button) before the notification is sent.
