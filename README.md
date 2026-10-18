# EventMap

EventMap is a map-first event discovery app for attendees and local hosts. People
can browse nearby events, RSVP, follow venues, and chat with other attendees.
Hosts can create and edit events and view activity through a separate admin app.

Built with Expo SDK 54, React Native, Expo Router, TypeScript, and Supabase
(PostgreSQL, Auth, Storage, Realtime). The admin dashboard uses Next.js.

## Run locally without a hosted subscription

Prerequisites: Node.js 22.13 or later, npm, Git, and a running Docker-compatible
container runtime. Initial setup downloads several large container images.
Use a trusted development network: Supabase's local services are development
tools with local credentials, not a production deployment.

```sh
npm ci
npm run backend:start
npm run backend:env
npm run dev:web
```

Open the URL printed by Expo (normally http://localhost:8081). No hosted Supabase
account, Google key, or paid subscription is needed. The backend is real local
Supabase, so changes persist across reloads and chat works across browser sessions.
The first start applies migrations and seeds fictional data automatically.

`backend:env` creates ignored `.env.local`, `admin/.env.development.local`, and
`admin/.env.production.local` files
from local CLI status. It refuses to overwrite them unless you pass `-- --force`.
These override existing ignored hosted environment files; those files are left intact.

Demo accounts all use the password `LocalDemo123!`:

| Email | Purpose |
| --- | --- |
| `host@example.test` | Fictional venue owner and admin |
| `alex@example.test` | Attendee with joined events |
| `sam@example.test` | Second attendee for chat testing |

These credentials are for disposable local fixtures only. New email accounts
also work; email confirmation is disabled locally. Password-reset email appears
in [local Mailpit](http://127.0.0.1:54324).

The demo starts around San Francisco. Search for San Francisco or enter
`latitude, longitude`, or select a location on the map. The art evening has two
attendees and an active chat; the run club has one attendee and a locked chat.

## Functionality and optional services

- Local auth, profiles, businesses, event CRUD, filters, RSVPs, follows, reviews,
  image storage, in-app notifications, and attendee chat use the real database.
- Chat access requires going status and at least two current going attendees.
  If attendance drops below two, access locks again. Messages are retained.
- Leaflet is bundled. OpenStreetMap base tiles require internet and show attribution.
  Key-free address search supports a small demo location list and explicit
  coordinates. It is not a global street-address search service.
- Google Maps/Places remain optional: set `EXPO_PUBLIC_MAP_PROVIDER=google` and
  supply your own restricted key. Google address search on web may require a
  server proxy because of provider CORS restrictions.
- OAuth and device push are off by default. Enable their environment flags only
  after configuring the providers. Email auth and in-app notifications work
  without them. Local builds disable EAS Update downloads.
- Subscription purchases are an existing simulation; they do not charge money.
  Some premium analytics views also contain simulated data. This is not payment
  processing or a production-ready subscription system.
- Local development does not make an always-online public service. Hosted
  Supabase remains an optional deployment target.

## Native devices

Run `npm run dev`, then use a development build (`npm run ios` or
`npm run android` with the native toolchain). Expo Go support depends on the native
modules in use; a development build is the reliable path.

iOS Simulator can use 127.0.0.1. For a physical device, use the computer's private
LAN IPv4 address; Android Emulator needs the host LAN address or adb reverse.

```sh
npm run backend:env -- --host 192.168.1.20 --force
```

Restart Expo after changing configuration. Uploaded image URLs contain the API
host; after switching hosts, re-upload images if old URLs are unreachable.
Both devices must reach the same backend for shared chat.

## Admin dashboard

After generating the local environment:

```sh
npm --prefix admin ci
npm --prefix admin run dev
```

Open http://localhost:3000 and sign in with the demo host account. The admin app
has its own dependencies and TypeScript configuration.

## Development commands

```sh
npm run typecheck
npm run typecheck:admin
npm run build:web
npm run test:backend
npm run audit:submission
```

Backend tests use local demo accounts and disposable events to check auth, event
CRUD, RSVP membership, image storage, realtime chat, and RLS restrictions.
They refuse to target a hosted URL and expect the seed accounts to exist.

The submission audit scans working files and historical text blobs for common
key patterns without printing values. It exits nonzero on findings; it is not a
complete credential or personal-data audit. See [submission status](docs/SUBMISSION.md).

```sh
npm run backend:stop   # Stop containers; preserve local data
npm run backend:start # Resume containers
npm run backend:reset # Erase only the local DB and reseed fictional data
npm run backend:types # Regenerate schema types after migrations
```

Never run supabase db push as part of local setup: it targets a linked remote
project. Keep migrations in Git and use local resets to validate them.

## Optional hosted deployment

Use your own Supabase project, apply migrations through your reviewed deployment
process, and set `EXPO_PUBLIC_BACKEND_MODE=hosted`, the project URL, and its public
anon key in your ignored environment. Configure the admin NEXT_PUBLIC values
separately. Never seed demo accounts into production or put service-role keys
in an EXPO_PUBLIC or NEXT_PUBLIC variable.

No changes to the old hosted database or billing are required by this preparation.
Keep existing backups private; do not import real users into the demo.

## Structure

- `app/`, `screens/`, `components/`: Expo app and UI.
- `services/`, `contexts/`: data access and app state.
- `supabase/migrations/`: versioned schema and RLS.
- `supabase/seed.sql`: synthetic local fixtures.
- `types/supabase.generated.ts`: generated schema types.
- `admin/`: separate Next.js administration app.
- `scripts/`: configuration, integration checks, and submission audit.

The embedded Leaflet runtime is generated from the pinned dependency. Run
`npm run vendor:map` after deliberately updating Leaflet, and retain its license notice.

## Ownership and license

Created and maintained by Renato V, with contributions from Shalom Meoded.
Original project code is [MIT licensed](LICENSE); commit history is preserved.
See [third-party notices](THIRD_PARTY_NOTICES.md) for map code, map data, media,
and external integrations.

See [ROADMAP.md](ROADMAP.md) for planned work and
[CONTRIBUTING.md](CONTRIBUTING.md) for contribution guidance.
