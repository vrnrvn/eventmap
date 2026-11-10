/**
 * One resolver for "how does this category look": label, colour, icon
 * component and SVG paths. Everything that renders a category (chips, badges,
 * pickers, map pins) goes through here instead of the old slug-keyed maps.
 *
 * Inputs accepted, in order of preference:
 *  - a `categories` row (or anything with slug/label/color/icon_key) — the
 *    database is the source of truth;
 *  - an event-category slug, a pre-migration slug alias ('cafe'), a current or
 *    legacy label;
 *  - a business category label ('Restaurant', …).
 * Unknown input resolves to a neutral grey map pin labelled "Event".
 *
 * Rows from a database that predates the taxonomy migration have no `color`;
 * those are presented from the bundled seed (by slug) so the app looks the
 * same before and after the migration is applied.
 */
import type { Category } from '@/types/database';
import {
  CATEGORY_SEED,
  CATEGORY_SEED_BY_SLUG,
  CATEGORY_SLUG_ALIASES,
  LEGACY_CATEGORY_LABELS,
  type CategorySeed,
} from '@/constants/categorySeed';
import { BUSINESS_CATEGORY_BY_LABEL } from '@/constants/businessCategories';
import {
  DEFAULT_CATEGORY_ICON,
  getCategoryIconEntry,
  type CategoryIconComponent,
} from '@/constants/categoryIconRegistry';

export const DEFAULT_CATEGORY_COLOR = '#607D8B';
export const DEFAULT_CATEGORY_LABEL = 'Event';

export type CategoryLike =
  | Partial<Pick<Category, 'slug' | 'label' | 'color' | 'icon_key' | 'description'>>
  | string
  | null
  | undefined;

export type CategoryPresentation = {
  slug: string | null;
  label: string;
  description: string;
  color: string;
  /** Lucide icon name; null when falling back to the pin. */
  iconKey: string | null;
  Icon: CategoryIconComponent;
  paths: readonly string[];
};

const HEX = /^#[0-9a-fA-F]{6}$/;

const SEED_BY_LABEL: Readonly<Record<string, CategorySeed>> = Object.fromEntries(
  CATEGORY_SEED.map((c) => [c.label.toLowerCase(), c])
);

/** Resolve any slug-ish or label-ish string to a seeded event category. */
export function resolveCategorySlug(input: string | null | undefined): string | null {
  if (!input) return null;
  const trimmed = input.trim();
  if (!trimmed) return null;
  if (CATEGORY_SEED_BY_SLUG[trimmed]) return trimmed;
  const alias = CATEGORY_SLUG_ALIASES[trimmed];
  if (alias) return alias;
  const legacy = LEGACY_CATEGORY_LABELS[trimmed];
  if (legacy) return legacy;
  const byLabel = SEED_BY_LABEL[trimmed.toLowerCase()];
  return byLabel ? byLabel.slug : null;
}

function fromSeed(seed: CategorySeed): CategoryPresentation {
  const icon = getCategoryIconEntry(seed.icon_key);
  return {
    slug: seed.slug,
    label: seed.label,
    description: seed.description,
    color: seed.color,
    iconKey: seed.icon_key,
    Icon: icon.Icon,
    paths: icon.paths,
  };
}

const FALLBACK: CategoryPresentation = {
  slug: null,
  label: DEFAULT_CATEGORY_LABEL,
  description: '',
  color: DEFAULT_CATEGORY_COLOR,
  iconKey: null,
  Icon: DEFAULT_CATEGORY_ICON.Icon,
  paths: DEFAULT_CATEGORY_ICON.paths,
};

function presentString(value: string): CategoryPresentation {
  const slug = resolveCategorySlug(value);
  if (slug) return fromSeed(CATEGORY_SEED_BY_SLUG[slug]);
  const business = BUSINESS_CATEGORY_BY_LABEL[value.trim()];
  if (business) {
    const icon = getCategoryIconEntry(business.iconKey);
    return {
      slug: null,
      label: business.label,
      description: '',
      color: business.color,
      iconKey: business.iconKey,
      Icon: icon.Icon,
      paths: icon.paths,
    };
  }
  return { ...FALLBACK, label: value.trim() || DEFAULT_CATEGORY_LABEL };
}

export function presentCategory(input: CategoryLike): CategoryPresentation {
  if (input == null) return FALLBACK;
  if (typeof input === 'string') return presentString(input);

  const seed = input.slug ? CATEGORY_SEED_BY_SLUG[resolveCategorySlug(input.slug) ?? ''] : undefined;
  const hasColor = typeof input.color === 'string' && HEX.test(input.color);

  // Pre-migration row (no colour yet): present from the seed when we know
  // the slug, otherwise from whatever the row carries.
  if (!hasColor && seed) return fromSeed(seed);

  const iconKey = input.icon_key && getCategoryIconEntry(input.icon_key) !== DEFAULT_CATEGORY_ICON
    ? input.icon_key
    : seed?.icon_key ?? null;
  const icon = getCategoryIconEntry(iconKey);
  return {
    slug: input.slug ?? seed?.slug ?? null,
    label: input.label?.trim() || seed?.label || DEFAULT_CATEGORY_LABEL,
    description: input.description ?? seed?.description ?? '',
    color: hasColor ? (input.color as string) : seed?.color ?? DEFAULT_CATEGORY_COLOR,
    iconKey,
    Icon: icon.Icon,
    paths: icon.paths,
  };
}

export function getCategoryColor(input: CategoryLike): string {
  return presentCategory(input).color;
}

/**
 * Soft tint of the category colour for badge backgrounds (hex + alpha byte).
 * `alpha` is 0–1.
 */
export function categoryTint(color: string, alpha = 0.1): string {
  const byte = Math.round(Math.min(Math.max(alpha, 0), 1) * 255)
    .toString(16)
    .padStart(2, '0');
  return HEX.test(color) ? `${color}${byte}` : color;
}

/**
 * Picker/chip ordering: the viewer's preferred categories first (in their
 * stored order), then everything else by `sort_order`. Inactive categories
 * are dropped unless they are preferred (so a retired interest still shows).
 */
export function orderCategoriesForViewer<T extends Pick<Category, 'id' | 'sort_order' | 'is_active'>>(
  categories: readonly T[],
  preferredIds: readonly string[] | null | undefined
): T[] {
  const rank = new Map<string, number>();
  (preferredIds ?? []).forEach((id, i) => rank.set(id, i));
  return categories
    .filter((c) => c.is_active !== false || rank.has(c.id))
    .slice()
    .sort((a, b) => {
      const ra = rank.get(a.id);
      const rb = rank.get(b.id);
      if (ra != null && rb != null) return ra - rb;
      if (ra != null) return -1;
      if (rb != null) return 1;
      return a.sort_order - b.sort_order;
    });
}
