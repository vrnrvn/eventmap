/**
 * Bundled snapshot of the event-category taxonomy
 * (supabase/migrations/20261109100000_category_taxonomy.sql).
 *
 * The database is the source of truth; this copy exists so that
 *  - the first render (before the persisted categories query hydrates) and
 *    a device that has never been online still get labelled, coloured chips;
 *  - rows from a database that predates the taxonomy migration (no `color`,
 *    old long labels) still present with the new look;
 *  - the map WebViews, which cannot query, have a slug → style table.
 *
 * Keep in sync with the migration. `tests/categoryPresentation.test.ts`
 * checks every `icon_key` here resolves in the icon registry and every colour
 * carries white text at AA contrast.
 */
import type { Category } from '@/types/database';

export type CategorySeed = Omit<Category, 'id' | 'created_at'> & {
  color: string;
  description: string;
  synonyms: string[];
  is_active: boolean;
};

export const CATEGORY_SEED: readonly CategorySeed[] = [
  { slug: 'live-music', label: 'Live Music', icon_key: 'mic-vocal', color: '#1d4ed8', sort_order: 1, is_active: true,
    description: 'Concerts, gigs, open mics and DJ sets with a live act',
    synonyms: ['music', 'concert', 'gig', 'band', 'live', 'open mic', 'dj set', 'show', 'jam'] },
  { slug: 'nightlife', label: 'Nightlife', icon_key: 'disc-3', color: '#7e22ce', sort_order: 2, is_active: true,
    description: 'Club nights, DJ nights, parties and late bars',
    synonyms: ['club', 'party', 'dj', 'dance', 'late', 'bar', 'rave', 'after party'] },
  { slug: 'dining', label: 'Food', icon_key: 'utensils-crossed', color: '#be123c', sort_order: 3, is_active: true,
    description: 'Dinners, pop-up kitchens, supper clubs and food trucks',
    synonyms: ['food', 'dinner', 'restaurant', 'supper', 'brunch', 'lunch', 'food truck', 'pop-up kitchen', 'bbq'] },
  { slug: 'food-drink', label: 'Drinks & Tastings', icon_key: 'coffee', color: '#b45309', sort_order: 4, is_active: true,
    description: 'Coffee cuppings, wine and beer tastings, cocktail nights',
    synonyms: ['coffee', 'tasting', 'wine', 'beer', 'cocktail', 'drinks', 'cafe', 'brewery', 'happy hour'] },
  { slug: 'markets', label: 'Markets & Pop-ups', icon_key: 'sparkles', color: '#0f766e', sort_order: 5, is_active: true,
    description: 'Makers markets, vintage fairs and flea markets',
    synonyms: ['market', 'pop-up', 'fair', 'vintage', 'flea', 'craft', 'makers', 'bazaar'] },
  { slug: 'fitness', label: 'Fitness', icon_key: 'flame', color: '#c2410c', sort_order: 6, is_active: true,
    description: 'Run clubs, group workouts, yoga and cycling',
    synonyms: ['run', 'running', 'workout', 'yoga', 'gym', 'cycling', 'bootcamp', 'pilates', 'hike'] },
  { slug: 'sports', label: 'Sports', icon_key: 'trophy', color: '#047857', sort_order: 7, is_active: true,
    description: 'Pickup games, leagues and watch parties',
    synonyms: ['football', 'soccer', 'basketball', 'pickup', 'league', 'match', 'game', 'watch party', 'tennis', 'padel'] },
  { slug: 'workshops', label: 'Workshops', icon_key: 'pen-tool', color: '#475569', sort_order: 8, is_active: true,
    description: 'Classes, talks and skill-shares',
    synonyms: ['class', 'workshop', 'talk', 'lecture', 'course', 'learn', 'skill', 'seminar', 'meetup'] },
  { slug: 'trivia', label: 'Games & Trivia', icon_key: 'dices', color: '#4338ca', sort_order: 9, is_active: true,
    description: 'Quiz nights, board games and karaoke',
    synonyms: ['trivia', 'quiz', 'board games', 'karaoke', 'bingo', 'games', 'pub quiz'] },
  { slug: 'culture', label: 'Arts & Culture', icon_key: 'palette', color: '#a21caf', sort_order: 10, is_active: true,
    description: 'Exhibitions, theatre, film and readings',
    synonyms: ['art', 'exhibition', 'gallery', 'theatre', 'theater', 'film', 'cinema', 'reading', 'poetry', 'museum'] },
  { slug: 'community', label: 'Community', icon_key: 'users', color: '#0e7490', sort_order: 11, is_active: true,
    description: 'Meetups, volunteering and networking',
    synonyms: ['meetup', 'volunteer', 'networking', 'community', 'social', 'neighbourhood', 'neighborhood', 'club'] },
  { slug: 'family', label: 'Family', icon_key: 'baby', color: '#be185d', sort_order: 12, is_active: true,
    description: 'Kid-friendly and all-ages events',
    synonyms: ['kids', 'family', 'children', 'all ages', 'toddler', 'parents', 'playgroup'] },
];

export const CATEGORY_SEED_BY_SLUG: Readonly<Record<string, CategorySeed>> = Object.fromEntries(
  CATEGORY_SEED.map((c) => [c.slug, c])
);

/**
 * Pre-migration labels, so a database that still carries them matches the
 * seed row (and therefore the new colour/icon) when looked up by label.
 */
export const LEGACY_CATEGORY_LABELS: Readonly<Record<string, string>> = {
  'DJ Nights & Nightlife': 'nightlife',
  'Run Clubs & Fitness': 'fitness',
  'Coffee & Tastings': 'food-drink',
  'Trivia & Game Nights': 'trivia',
  'Pop-ups & Markets': 'markets',
  'Workshops & Classes': 'workshops',
  'Food & Dining': 'dining',
  'Sports & Recreation': 'sports',
  'Art & Culture': 'culture',
};

/** Slugs the app has historically accepted as synonyms of a seeded slug. */
export const CATEGORY_SLUG_ALIASES: Readonly<Record<string, string>> = {
  cafe: 'food-drink',
  coffee: 'food-drink',
};
