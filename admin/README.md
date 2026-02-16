# EventMap Admin CRM

Admin-only web dashboard for managing EventMap.

## Setup

1. Copy `.env.local` and ensure `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` match the main app.
2. Grant admin access: run in Supabase SQL editor:
   ```sql
   UPDATE profiles SET is_admin = true WHERE id = 'YOUR_USER_UUID';
   ```
3. Run `npm run dev` and sign in with your admin account.

## Features

- **Users**: List, search, view, ban/unban
- **Events**: List, search, view, delete
- **Businesses**: List, search, toggle premium, reset event limit
- **Subscriptions**: Overview by tier
- **Complaints**: List, filter, resolve/dismiss
- **Banners/Ads**: CRUD for app headers and banners
- **Refunds**: Placeholder (Stripe integration coming)
