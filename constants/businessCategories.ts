/**
 * Business (venue) categories. `businesses.category` is free text chosen from
 * this list in Business Onboarding and Settings; it is a separate taxonomy
 * from event categories (`categories` table) and used to live mixed into the
 * event icon config. Icons/colours reuse the event registry so a venue pin on
 * the map looks like the matching event pin.
 */
export type BusinessCategoryStyle = {
  label: string;
  /** Lucide icon name in constants/categoryIconRegistry.ts; null = map pin. */
  iconKey: string | null;
  color: string;
};

export const BUSINESS_CATEGORIES: readonly BusinessCategoryStyle[] = [
  { label: 'Restaurant', iconKey: 'utensils-crossed', color: '#be123c' },
  { label: 'Bar & Nightlife', iconKey: 'disc-3', color: '#7e22ce' },
  { label: 'Fitness & Wellness', iconKey: 'flame', color: '#c2410c' },
  { label: 'Coffee Shop', iconKey: 'coffee', color: '#b45309' },
  { label: 'Entertainment', iconKey: 'mic-vocal', color: '#1d4ed8' },
  { label: 'Arts & Culture', iconKey: 'palette', color: '#a21caf' },
  { label: 'Sports & Recreation', iconKey: 'trophy', color: '#047857' },
  { label: 'Education', iconKey: 'pen-tool', color: '#475569' },
  { label: 'Community', iconKey: 'users', color: '#0e7490' },
  { label: 'Other', iconKey: null, color: '#64748b' },
];

export const BUSINESS_CATEGORY_LABELS: readonly string[] = BUSINESS_CATEGORIES.map((c) => c.label);

export const BUSINESS_CATEGORY_BY_LABEL: Readonly<Record<string, BusinessCategoryStyle>> =
  Object.fromEntries(BUSINESS_CATEGORIES.map((c) => [c.label, c]));
