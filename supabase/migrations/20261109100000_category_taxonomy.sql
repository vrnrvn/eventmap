-- Category taxonomy: data-driven presentation + cleanup
-- (docs/CATEGORIES_AND_SERIES_PLAN.md §3.1, Phase A).
--
-- NOT applied to the shared local database by the author. Validated on an
-- isolated scratch copy only (scripts/db-scratch.sh). Ask the owner before
-- applying; afterwards run `npm run backend:types`.
--
-- What changes
--  1. `categories` gains `color` (hex), `description`, `synonyms` (search
--     terms, used by Phase B) and `is_active` (retire a category without
--     deleting it: events keep their category_id, pickers hide it).
--  2. Labels are shortened and the overlaps fixed ("Coffee & Tastings" vs
--     "Food & Dining", "DJ Nights & Nightlife" vs "Live Music"). Slugs and
--     ids are untouched, so existing events are unaffected.
--  3. `icon_key` now holds the Lucide icon name the client renders
--     (constants/categoryIconRegistry.ts); the old values ('music',
--     'activity', 'brain', …) were never read.
--  4. Two catch-all categories are added: `community` and `family`.
--
-- Everything is idempotent (IF NOT EXISTS / ON CONFLICT) so it can be
-- re-applied to a database that already has part of it.

ALTER TABLE public.categories
  ADD COLUMN IF NOT EXISTS color text,
  ADD COLUMN IF NOT EXISTS description text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS synonyms text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS is_active boolean NOT NULL DEFAULT true;

COMMENT ON COLUMN public.categories.color IS
  'Hex colour (#rrggbb) used for chips, badges and map pins. White text must stay >= 4.5:1 on it (tests/categoryPresentation.test.ts).';
COMMENT ON COLUMN public.categories.icon_key IS
  'Lucide icon name (kebab-case) resolved by constants/categoryIconRegistry.ts on the client; unknown keys fall back to a map pin.';
COMMENT ON COLUMN public.categories.synonyms IS
  'Lower-case search terms that should surface this category ("concert", "gig" -> live-music).';
COMMENT ON COLUMN public.categories.is_active IS
  'false = retired: hidden from pickers and Discover chips, still rendered on events that use it.';

ALTER TABLE public.categories DROP CONSTRAINT IF EXISTS categories_color_hex;
ALTER TABLE public.categories
  ADD CONSTRAINT categories_color_hex CHECK (color IS NULL OR color ~ '^#[0-9a-fA-F]{6}$');

-- Pickers read active categories ordered by sort_order.
CREATE INDEX IF NOT EXISTS idx_categories_active_sort
  ON public.categories (sort_order) WHERE is_active;

-- Taxonomy. Colours are the darker shade of each hue so white text on a
-- filled chip clears WCAG AA (4.5:1); the client test locks this in.
WITH taxonomy(slug, label, icon_key, color, description, synonyms, sort_order) AS (
  VALUES
    ('live-music', 'Live Music',        'mic-vocal',        '#1d4ed8',
      'Concerts, gigs, open mics and DJ sets with a live act',
      ARRAY['music','concert','gig','band','live','open mic','dj set','show','jam'], 1),
    ('nightlife',  'Nightlife',         'disc-3',           '#7e22ce',
      'Club nights, DJ nights, parties and late bars',
      ARRAY['club','party','dj','dance','late','bar','rave','after party'], 2),
    ('dining',     'Food',              'utensils-crossed', '#be123c',
      'Dinners, pop-up kitchens, supper clubs and food trucks',
      ARRAY['food','dinner','restaurant','supper','brunch','lunch','food truck','pop-up kitchen','bbq'], 3),
    ('food-drink', 'Drinks & Tastings', 'coffee',           '#b45309',
      'Coffee cuppings, wine and beer tastings, cocktail nights',
      ARRAY['coffee','tasting','wine','beer','cocktail','drinks','cafe','brewery','happy hour'], 4),
    ('markets',    'Markets & Pop-ups', 'sparkles',         '#0f766e',
      'Makers markets, vintage fairs and flea markets',
      ARRAY['market','pop-up','fair','vintage','flea','craft','makers','bazaar'], 5),
    ('fitness',    'Fitness',           'flame',            '#c2410c',
      'Run clubs, group workouts, yoga and cycling',
      ARRAY['run','running','workout','yoga','gym','cycling','bootcamp','pilates','hike'], 6),
    ('sports',     'Sports',            'trophy',           '#047857',
      'Pickup games, leagues and watch parties',
      ARRAY['football','soccer','basketball','pickup','league','match','game','watch party','tennis','padel'], 7),
    ('workshops',  'Workshops',         'pen-tool',         '#475569',
      'Classes, talks and skill-shares',
      ARRAY['class','workshop','talk','lecture','course','learn','skill','seminar','meetup'], 8),
    ('trivia',     'Games & Trivia',    'dices',            '#4338ca',
      'Quiz nights, board games and karaoke',
      ARRAY['trivia','quiz','board games','karaoke','bingo','games','pub quiz'], 9),
    ('culture',    'Arts & Culture',    'palette',          '#a21caf',
      'Exhibitions, theatre, film and readings',
      ARRAY['art','exhibition','gallery','theatre','theater','film','cinema','reading','poetry','museum'], 10),
    ('community',  'Community',         'users',            '#0e7490',
      'Meetups, volunteering and networking',
      ARRAY['meetup','volunteer','networking','community','social','neighbourhood','neighborhood','club'], 11),
    ('family',     'Family',            'baby',             '#be185d',
      'Kid-friendly and all-ages events',
      ARRAY['kids','family','children','all ages','toddler','parents','playgroup'], 12)
)
INSERT INTO public.categories (slug, label, icon_key, color, description, synonyms, sort_order, is_active)
SELECT slug, label, icon_key, color, description, synonyms, sort_order, true FROM taxonomy
ON CONFLICT (slug) DO UPDATE SET
  label       = EXCLUDED.label,
  icon_key    = EXCLUDED.icon_key,
  color       = EXCLUDED.color,
  description = EXCLUDED.description,
  synonyms    = EXCLUDED.synonyms,
  sort_order  = EXCLUDED.sort_order,
  is_active   = true;
