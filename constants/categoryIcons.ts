/**
 * Bespoke category icon mapping for Eventmap.
 * Maps category slugs to Lucide icons and premium color palettes.
 * Used by CategoryIcon component for filter pills, floating card badge, etc.
 */

import type React from 'react';
import {
  Disc3,
  Flame,
  Coffee,
  Dices,
  Sparkles,
  MicVocal,
  PenTool,
  UtensilsCrossed,
  Trophy,
  Palette,
  MapPin,
} from 'lucide-react-native';

export type CategoryIconSize = 'sm' | 'md' | 'lg';

type IconComponent = React.ComponentType<{ size?: number; color?: string; style?: object }>;

export const CATEGORY_ICON_CONFIG: Record<
  string,
  { icon: IconComponent; color: string; label: string }
> = {
  nightlife: {
    icon: Disc3,
    color: '#9333ea',
    label: 'DJ Nights & Nightlife',
  },
  fitness: {
    icon: Flame,
    color: '#ea580c',
    label: 'Run Clubs & Fitness',
  },
  'food-drink': {
    icon: Coffee,
    color: '#d97706',
    label: 'Coffee & Tastings',
  },
  trivia: {
    icon: Dices,
    color: '#4f46e5',
    label: 'Trivia & Game Nights',
  },
  markets: {
    icon: Sparkles,
    color: '#0d9488',
    label: 'Pop-ups & Markets',
  },
  'live-music': {
    icon: MicVocal,
    color: '#2563eb',
    label: 'Live Music',
  },
  workshops: {
    icon: PenTool,
    color: '#475569',
    label: 'Workshops & Classes',
  },
  dining: {
    icon: UtensilsCrossed,
    color: '#e11d48',
    label: 'Food & Dining',
  },
  sports: {
    icon: Trophy,
    color: '#059669',
    label: 'Sports & Recreation',
  },
  culture: {
    icon: Palette,
    color: '#c026d3',
    label: 'Art & Culture',
  },
  coffee: {
    icon: Coffee,
    color: '#d97706',
    label: 'Coffee',
  },
  cafe: {
    icon: Coffee,
    color: '#d97706',
    label: 'Cafe',
  },
  Restaurant: {
    icon: UtensilsCrossed,
    color: '#e11d48',
    label: 'Restaurant',
  },
  'Bar & Nightlife': {
    icon: Disc3,
    color: '#9333ea',
    label: 'Bar & Nightlife',
  },
  'Fitness & Wellness': {
    icon: Flame,
    color: '#ea580c',
    label: 'Fitness & Wellness',
  },
  'Coffee Shop': {
    icon: Coffee,
    color: '#d97706',
    label: 'Coffee Shop',
  },
  Entertainment: {
    icon: MicVocal,
    color: '#2563eb',
    label: 'Entertainment',
  },
};

const FALLBACK_CONFIG = {
  icon: MapPin,
  color: '#64748b',
  label: 'Event',
};

const SIZE_SPEC = {
  sm: { container: 24, icon: 14 },
  md: { container: 40, icon: 20 },
  lg: { container: 56, icon: 28 },
} as const;

export function getCategoryIconConfig(slugOrLabel: string | null | undefined) {
  if (!slugOrLabel) return FALLBACK_CONFIG;
  if (CATEGORY_ICON_CONFIG[slugOrLabel]) return CATEGORY_ICON_CONFIG[slugOrLabel];
  const slug = Object.entries(CATEGORY_ICON_CONFIG).find(
    ([, c]) => c.label === slugOrLabel
  )?.[0];
  return slug ? CATEGORY_ICON_CONFIG[slug] : FALLBACK_CONFIG;
}

export function getCategoryIconSize(size: CategoryIconSize) {
  return SIZE_SPEC[size];
}

export function getCategoryIconColor(slug: string | null | undefined): string {
  return getCategoryIconConfig(slug).color;
}

/** Returns slug for map/API use; accepts slug or label. */
export function getCategorySlug(slugOrLabel: string | null | undefined): string | null {
  if (!slugOrLabel) return null;
  if (CATEGORY_ICON_CONFIG[slugOrLabel]) return slugOrLabel;
  const slug = Object.entries(CATEGORY_ICON_CONFIG).find(
    ([, c]) => c.label === slugOrLabel
  )?.[0];
  return slug ?? null;
}
