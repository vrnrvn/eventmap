# EventMap - Map-First Local Events Platform

A React Native mobile app built with Expo that allows users to discover local events on an interactive map and enables businesses to create and promote their events.

## What's Been Built

### ✅ Database Foundation

**Complete Supabase Schema:**
- `profiles` - User profiles with name and avatar
- `businesses` - Business profiles with location, subscription tier, and event limits
- `categories` - Event categories (DJ nights, fitness, food & drink, etc.)
- `events` - Event listings with location, dates, and descriptions
- `event_links` - Multiple links per event (tickets, social media, etc.)
- `event_photos` - Photo galleries for events
- `rsvps` - User RSVPs with going/interested status
- `saves` - Saved events bookmarks
- `follows` - Business following relationships

**Row Level Security (RLS):**
- All tables have RLS enabled with proper security policies
- Public read access for event discovery
- Owner-based write permissions for businesses and events
- User-scoped access for RSVPs, saves, and follows

**Database Functions:**
- `create_event_with_limit_check()` - Enforces free tier (2 events/month) and premium tier (30 events/month) limits
- `get_ranked_events()` - Returns events ranked by premium status, distance, date, and popularity
- `get_event_details()` - Fetches complete event data including links, photos, and user interactions
- `get_user_business()` - Gets the current user's business profile
- `calculate_distance()` - Haversine formula for distance calculations
- `reset_monthly_event_counter()` - Resets event counts at month boundaries

**Storage:**
- `event-images` bucket configured for event photos with 5MB limit
- Proper storage policies for authenticated uploads and public reads

### ✅ TypeScript Types

Complete type definitions for:
- All database tables and relationships
- API request/response types
- Application state types (user mode, filters, form data)
- Subscription plans and tiers

### ✅ Service Layer

**Authentication Service:**
- Sign up with email/password
- Sign in with email/password
- Sign out
- Password reset
- Session management

**Events Service:**
- Get ranked events with filters (location, categories, date range, search)
- Get event details with full data
- Create events with limit checking
- Update and delete events
- Manage event links and photos
- Upload event images to storage

**Businesses Service:**
- Get user's business
- Create business profile
- Update business information
- Check event creation limits
- Get follower counts

**Social Service:**
- Create/update/delete RSVPs
- Save/unsave events
- Follow/unfollow businesses
- Get user's social interactions

**Categories Service:**
- Fetch all categories
- Get category by ID or slug

**Profiles Service:**
- Get and update user profiles
- Upload avatar images

### ✅ State Management

**Auth Context:**
- Session management
- User authentication state
- Profile data
- Sign in/up/out methods

**App Context:**
- User mode (user vs business)
- Current business profile
- Business ownership checks
- Mode switching logic

**React Query Setup:**
- Configured for data fetching and caching

### ✅ Authentication Screens

- **Welcome Screen** - App introduction with feature highlights
- **Login Screen** - Email/password sign in with validation
- **Signup Screen** - Account creation with name, email, password

### ✅ Tab Navigation

5-tab bottom navigation structure:
- **Map** - Full-screen map view (placeholder)
- **Discover** - Event list view (placeholder)
- **Create** - Event creation (placeholder with business check)
- **Notifications** - Activity feed (placeholder)
- **Profile** - User profile with mode switching and settings

### ✅ Profile Screen

- User avatar and name display
- User/Business mode toggle
- Create business profile CTA
- Saved events, following, and settings menu
- Sign out functionality

### ✅ UI Components

- **Input** - Reusable text input with label and error handling

### ✅ Design System

**Theme Constants:**
- Color palette (primary, secondary, accent, semantic colors)
- Spacing scale (4px base)
- Typography scale and weights
- Border radius values
- Shadow definitions

**Subscription Plans:**
- Free tier (2 events/month)
- Premium Monthly ($6.99/month, 30 events/month)
- Premium Yearly ($69.99/year, 30 events/month, save 17%)

## What Needs To Be Built

### 🔨 Map Screen (Priority: High)
- Integrate react-native-maps
- Display event pins with category-based colors
- Implement pin clustering for dense areas
- Bottom sheet with swipeable event preview cards
- Tap pin to show event preview
- Search bar and filters
- "Search this area" button
- User location tracking

### 🔨 Event Details Screen (Priority: High)
- Full event information display
- Photo carousel with event images
- Business info card with navigation
- RSVP buttons (going/interested)
- Save/bookmark toggle
- Attendee count display
- Links section (tickets, social media)
- Share functionality
- Map preview with directions

### 🔨 Discover Screen (Priority: High)
- Scrollable event list
- Same filters as map (categories, date, distance)
- Sort options
- Event cards with key info
- Infinite scroll with pagination
- Pull to refresh
- Empty states

### 🔨 Business Onboarding (Priority: High)
- Multi-step business creation flow
- Business name and description
- Category selection
- Location picker with map
- Logo upload
- Business profile creation

### 🔨 Event Creation Flow (Priority: High)
- Multi-step event creation wizard
- Title and category selection
- Date/time pickers (start and end)
- Location selection with map picker
- Rich text description input
- Links management (add/remove multiple)
- Multi-photo upload with cover selection
- Photo reordering
- Business association display
- Validation and preview
- Event limit checking with upgrade prompts

### 🔨 Business Dashboard (Priority: Medium)
- My Events list (upcoming and past)
- Event analytics (views, RSVPs, saves)
- Edit event functionality
- Delete event with confirmation
- Duplicate event feature
- Event quota display
- Upgrade prompts for free tier

### 🔨 Subscription & Paywall (Priority: Medium)
- Paywall screen with tier comparison
- Monthly/yearly toggle
- Feature comparison list
- Stripe integration placeholder
- Subscription management
- Upgrade/downgrade flows
- Billing history placeholder
- Cancel subscription flow

### 🔨 Social Features Implementation (Priority: Medium)
- Connect RSVP buttons to backend
- Implement save/unsave functionality
- Follow/unfollow business actions
- Saved events list page
- Following list page
- My RSVPs page

### 🔨 Search & Filters (Priority: Medium)
- Global search for events and businesses
- Category multi-select filter
- Date range picker
- Distance radius slider
- Filter combination logic
- Clear filters action
- Search history

### 🔨 Settings & Profile Management (Priority: Low)
- Edit profile screen
- Change avatar
- Update name and email
- Change password
- Account settings
- Privacy settings
- Delete account flow

### 🔨 Polish & UX (Priority: Ongoing)
- Loading states and skeletons
- Error handling and retry logic
- Optimistic UI updates
- Toast notifications
- Offline detection
- Image caching
- Haptic feedback
- Deep linking for event sharing

## Setup Instructions

### Prerequisites
- Node.js 18+
- npm or yarn
- Expo CLI
- Supabase account

### Installation

1. Install dependencies:
```bash
npm install
```

2. Environment variables are already configured in `.env`:
```
EXPO_PUBLIC_SUPABASE_URL=https://giglyimjppdidqqaiybh.supabase.co
EXPO_PUBLIC_SUPABASE_ANON_KEY=[key already set]
```

3. Database is already set up with:
   - All tables and relationships
   - RLS policies
   - Database functions
   - Storage buckets
   - Seed categories

### Running the App

```bash
# Start development server
npm run dev

# Build for web
npm run build:web

# Type check
npm run typecheck

# Lint
npm run lint
```

## Project Structure

```
.
├── app/                    # Expo Router screens
│   ├── (auth)/            # Authentication screens
│   │   ├── welcome.tsx
│   │   ├── login.tsx
│   │   └── signup.tsx
│   ├── (tabs)/            # Main app tabs
│   │   ├── map.tsx
│   │   ├── discover.tsx
│   │   ├── create.tsx
│   │   ├── notifications.tsx
│   │   └── profile.tsx
│   ├── _layout.tsx        # Root layout with providers
│   └── index.tsx          # Initial route logic
├── components/            # Reusable UI components
│   └── Input.tsx
├── contexts/              # React contexts
│   ├── AuthContext.tsx    # Authentication state
│   └── AppContext.tsx     # App-wide state
├── services/              # API service layer
│   ├── supabase.ts        # Supabase client
│   ├── auth.ts            # Auth operations
│   ├── events.ts          # Event operations
│   ├── businesses.ts      # Business operations
│   ├── social.ts          # RSVP, save, follow
│   ├── categories.ts      # Category operations
│   └── profiles.ts        # Profile operations
├── types/                 # TypeScript types
│   ├── database.ts        # Database types
│   └── app.ts             # App types
├── constants/             # App constants
│   ├── theme.ts           # Design tokens
│   └── subscriptions.ts   # Subscription plans
└── hooks/                 # Custom hooks
```

## Database Schema

### Key Tables
- **profiles**: User accounts
- **businesses**: Business profiles with subscription tiers
- **events**: Event listings
- **categories**: Event categories
- **rsvps**: Event RSVPs
- **saves**: Bookmarked events
- **follows**: Business follows

### Subscription System
- Free tier: 2 events per calendar month
- Premium tier: 30 events per month
- Enforced at database level via RPC functions
- Monthly counters reset automatically

### Security
- All tables have RLS enabled
- Public read for discovery
- Owner-based write permissions
- User-scoped social features

## Next Steps

1. **Implement Map Screen** - Core feature for event discovery
2. **Build Event Details** - Complete event viewing experience
3. **Create Business Onboarding** - Enable business profile creation
4. **Implement Event Creation** - Allow businesses to post events
5. **Add Social Features** - Connect RSVP, save, follow functionality
6. **Build Discover Tab** - Alternative list view for events
7. **Create Subscription Flows** - Enable premium upgrades

## Tech Stack

- **Framework**: React Native with Expo SDK 54
- **Navigation**: Expo Router 6
- **Database**: Supabase (PostgreSQL)
- **State Management**: React Context + React Query
- **UI Components**: React Native core + Lucide icons
- **Maps**: react-native-maps (to be integrated)
- **Bottom Sheet**: @gorhom/bottom-sheet (to be integrated)
- **Type Safety**: TypeScript

## Notes

- The app is configured for web platform as default
- Native-only APIs require platform-specific checks
- Storage bucket size limit: 5MB per image
- Event limit enforcement happens at database level
- Premium ranking boost is built into event query function
