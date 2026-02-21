# EventMap: AI Coding Agent Instructions

## Architecture Overview

**EventMap** is a dual-app platform combining a React Native mobile app (Expo) with a Next.js admin CRM.

- **Mobile App** (`/`): Expo-based React Native app with Expo Router for map-first event discovery
- **Admin Panel** (`/admin`): Next.js web app for business/user management and analytics
- **Shared Backend**: Supabase PostgreSQL with RLS policies and serverless functions

### Data Flow
User interactions (events, RSVPs, saves, follows) flow through TypeScript-typed Supabase services → React Context/Query (mobile) or server-side Next.js → database functions enforce business logic (event limits, premium tiers).

## Key Structural Decisions

### Monorepo Pattern
- **Root**: Mobile app with Expo Router and services
- **`/admin`**: Separate `package.json`, Next.js config, TypeScript environment
- **Shared Types**: `types/database.ts` and `types/app.ts` are source of truth; keep in sync across apps
- **Services Layer**: Mobile app's `/services` directly call Supabase via `@supabase/supabase-js`; admin uses server-side Next.js API or direct Supabase client

### Context Hierarchy (Mobile)
```
_layout.tsx (root)
├── AuthProvider (session, user profile, ban status)
├── QueryClientProvider (React Query for data fetching)
├── AppProvider (business mode, business profile, ownership checks)
├── SearchProvider (filters, search state)
├── PremiumProvider (subscription tier, feature flags)
└── GestureHandlerRootView + BottomSheetModalProvider (UI libraries)
```
**Guideline**: When accessing user/session state in mobile screens, use `useContext(AuthContext)`. For business context, use `useContext(AppContext)`. Keep contexts lean; use React Query for async data.

## File Organization & Patterns

### Mobile App Structure
- **`app/`**: Expo Router pages; `(auth)`, `(onboarding)`, `(tabs)` are route groups; `business/`, `event/`, `user/` are dynamic routes
- **`services/`**: 🔑 Core business logic. Each service exports a singleton object (e.g., `eventsService`, `profilesService`). Always use RPC functions when possible for server-side validation
- **`contexts/`**: Global state providers; consume via `useContext()`
- **`components/`**: Reusable UI; prefer compound components (ref-forwarding with `useImperativeHandle` for modals/maps)
- **`constants/theme.ts`**: Single source of truth for Colors, Spacing, Typography, BorderRadius (no hardcoded values)
- **`types/database.ts`**: Auto-generated Supabase TypeScript definitions; regenerate after schema changes
- **`hooks/`**: Custom hooks like `useFrameworkReady` (checks if fonts/app initialized)

### Services Pattern (Critical)
Each service method is async and throws on error; callers handle try-catch. Example from `eventsService`:
```typescript
async getRankedEvents(userLat, userLng, filters) {
  const { data, error } = await supabase.rpc('get_ranked_events', {...});
  if (error) throw error;
  return data || [];
}
```
**Key**: Use Supabase RPC functions (stored procedures) for complex operations like event creation with limit checking, not client-side logic.

### Admin Panel
- **`/admin/app/(dashboard)`**: Protected dashboard routes (require `is_admin` flag in profiles table)
- **`/admin/app/api/auth`**: OAuth/session endpoints
- **`/admin/app/login`**: Auth flow using Supabase client SDK
- **No separate services layer**: Calls Supabase client directly from components or API routes
- **Middleware**: `middleware.ts` enforces admin access; redirects unauthenticated users to `/login`

## Common Development Workflows

### Adding a New Feature (Mobile)
1. Define types in `types/database.ts` (or extend existing types)
2. Create service method in appropriate `/services` file (e.g., `eventsService.getFilteredEvents()`)
3. Create/update screen in `app/` using React Query's `useQuery()`; handle loading/error states
4. If global state needed, add to relevant Context
5. Style using `constants/theme.ts`; never use hardcoded colors/spacing

### Handling Authentication
- Session managed by `AuthContext`; accessed via `useContext(AuthContext)`
- `isBanned` check done on profile load; redirect banned users in `_layout.tsx`
- Sign up creates both `profiles` and `businesses` table entries (business created in `AuthContext.signUp`)

### Image Uploads
- Mobile: Use `expo-file-system` + `expo-image-picker` to capture/select; convert to base64 via `base64-arraybuffer`; upload to Supabase Storage (`event-images` bucket)
- Admin: Use Next.js form data handling; same bucket, authenticated via service role key (server-side)

### Event Limits & Premium Tiers
- **Free**: 2 events per month (checked by `create_event_with_limit_check()` RPC)
- **Premium**: 30 events per month (subscription tier stored in `businesses.subscription_tier`)
- Business owns one subscription; renewal/refunds handled in admin panel (Stripe integration incomplete)

## Coding Conventions

- **File Naming**: Kebab-case for files/folders (`AddressMapPicker.tsx`, `event-detail.tsx`)
- **Component Exports**: Default export for screens; named exports for reusable components
- **Error Handling**: Services throw errors; screens use try-catch or React Query's `error` state; show user-friendly toast/alert messages
- **Types**: Strict TypeScript (`tsconfig.json` has `"strict": true`); use `@/` path aliases (configured in `tsconfig.json`)
- **Styling**: React Native StyleSheet for mobile; Tailwind CSS for Next.js admin (`globals.css`)
- **Env Vars**: Mobile uses `EXPO_PUBLIC_*` prefix; Next.js uses standard `NEXT_PUBLIC_*`; load Supabase URL/keys in `services/supabase.ts` (mobile) or `.env.local` (admin)

## Supabase-Specific Patterns

- **RLS Policies**: All tables have `enable_rls = true`; anonymous users can read events, but only owners can write
- **Database Functions**: Written in PL/pgSQL; used for complex operations (event creation, limit checking, ranking)
- **Storage**: `event-images` bucket accessible to authenticated users; 5MB file limit
- **Realtime**: Not currently used; consider for live event updates if needed
- **Relationships**: Use foreign keys; types reflect via `Database['public']['Tables'][table]['Row']`

## Testing & Debugging

- **Linting**: `npm run lint` (Expo lint) in root; ESLint in `/admin`
- **Type Checking**: `npm run typecheck` (runs `tsc --noEmit` in root)
- **Development Server**: `npm run dev` (Expo) in root; `npm run dev` in `/admin` for Next.js
- **Database Debugging**: Use Supabase Studio SQL editor to inspect tables, run RPC functions, check RLS policies
- **Mobile Testing**: `npm run ios` or `npm run android` to build native apps; use Expo Go app for quick testing

## Integration Points & External Dependencies

- **Supabase**: Database, auth, storage, RPC functions
- **Google Maps API**: Location-based features (geocoding, map display) via `@teovilla/react-native-web-maps`
- **Google/Facebook OAuth**: OAuth providers for sign-in (configured in Supabase Auth)
- **Bottom Sheet Modal**: `@gorhom/bottom-sheet` for mobile modals (AddressMapPicker, AttendeesBottomSheet)
- **React Query**: Data fetching/caching; no Redux needed due to context + query combo
- **Expo Modules**: Camera, image picker, location, notifications, fonts, push notifications

## Important Files to Reference

- [types/database.ts](types/database.ts) — Supabase schema types; regenerate after migrations
- [services/supabase.ts](services/supabase.ts) — Supabase client initialization
- [services/events.ts](services/events.ts) — Event CRUD, filtering, search
- [constants/theme.ts](constants/theme.ts) — Design system (colors, spacing, typography)
- [contexts/AuthContext.tsx](contexts/AuthContext.tsx) — Authentication flow
- [README.md](README.md) — Feature checklist and database schema overview
- [admin/README.md](admin/README.md) — Admin CRM features and setup
