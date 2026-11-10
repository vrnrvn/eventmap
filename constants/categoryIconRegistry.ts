/**
 * Icon registry for categories, keyed by Lucide icon name (the value stored
 * in `categories.icon_key`).
 *
 * Each entry carries the glyph twice, on purpose:
 *  - `Icon`: the React component for React Native / web UI;
 *  - `paths`: the same glyph as raw SVG path data on Lucide's 24×24 grid, for
 *    the map WebViews where a marker has to be an SVG *string*.
 * Keeping both in one place means the pin and the chip cannot drift apart.
 *
 * Adding a category with a new icon = add a Lucide name here (+ its import in
 * components/icons.generated.ts via `node scripts/generate-icons.mjs`), then
 * reference it from the `icon_key` column. Unknown keys fall back to
 * `DEFAULT_CATEGORY_ICON` (a map pin) rather than crashing.
 */
import type React from 'react';
import {
  Baby,
  Coffee,
  Dices,
  Disc3,
  Flame,
  MapPin,
  MicVocal,
  Palette,
  PenTool,
  Sparkles,
  Trophy,
  Users,
  UtensilsCrossed,
} from '@/components/icons.generated';

export type CategoryIconComponent = React.ComponentType<{
  size?: number;
  color?: string;
  strokeWidth?: number;
  style?: object;
}>;

export type CategoryIconEntry = {
  Icon: CategoryIconComponent;
  /** SVG path `d` strings; circles are expressed as two-arc paths. */
  paths: readonly string[];
};

export const CATEGORY_ICON_REGISTRY: Readonly<Record<string, CategoryIconEntry>> = {
  'disc-3': {
    Icon: Disc3,
    paths: [
      'M12 2 A10 10 0 0 1 22 12 A10 10 0 0 1 12 22 A10 10 0 0 1 2 12 A10 10 0 0 1 12 2',
      'M6 12c0-1.7.7-3.2 1.8-4.2',
      'M12 10 A2 2 0 0 1 14 12 A2 2 0 0 1 12 14 A2 2 0 0 1 10 12 A2 2 0 0 1 12 10',
      'M18 12c0 1.7-.7 3.2-1.8 4.2',
    ],
  },
  'mic-vocal': {
    Icon: MicVocal,
    paths: [
      'm11 7.601-5.994 8.19a1 1 0 0 0 .1 1.298l.817.818a1 1 0 0 0 1.314.087L15.09 12',
      'M16.5 21.174C15.5 20.5 14.372 20 13 20c-2.058 0-3.928 2.356-6 2-2.072-.356-2.775-3.369-1.5-4.5',
      'M16 7m-5 0a5 5 0 1 0 10 0a5 5 0 1 0-10 0',
    ],
  },
  coffee: {
    Icon: Coffee,
    paths: [
      'M10 2v2',
      'M14 2v2',
      'M16 8a1 1 0 0 1 1 1v8a4 4 0 0 1-4 4H7a4 4 0 0 1-4-4V9a1 1 0 0 1 1-1h14a4 4 0 1 1 0 8h-1',
      'M6 2v2',
    ],
  },
  'utensils-crossed': {
    Icon: UtensilsCrossed,
    paths: [
      'm16 2-2.3 2.3a3 3 0 0 0 0 4.2l1.8 1.8a3 3 0 0 0 4.2 0L22 8',
      'M15 15 3.3 3.3a4.2 4.2 0 0 0 0 6l7.3 7.3c.7.7 2 .7 2.8 0L15 15Zm0 0 7 7',
      'm2.1 21.8 6.4-6.3',
      'm19 5-7 7',
    ],
  },
  flame: {
    Icon: Flame,
    paths: [
      'M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 0 0 2.5 2.5z',
    ],
  },
  trophy: {
    Icon: Trophy,
    paths: [
      'M10 14.66v1.626a2 2 0 0 1-.976 1.696A5 5 0 0 0 7 21.978',
      'M14 14.66v1.626a2 2 0 0 0 .976 1.696A5 5 0 0 1 17 21.978',
      'M18 9h1.5a1 1 0 0 0 0-5H18',
      'M4 22h16',
      'M6 9a6 6 0 0 0 12 0V3a1 1 0 0 0-1-1H7a1 1 0 0 0-1 1z',
      'M6 9H4.5a1 1 0 0 1 0-5H6',
    ],
  },
  palette: {
    Icon: Palette,
    paths: [
      'M12 22a1 1 0 0 1 0-20 10 9 0 0 1 10 9 5 5 0 0 1-5 5h-2.25a1.75 1.75 0 0 0-1.4 2.8l.3.4a1.75 1.75 0 0 1-1.4 2.8z',
      'M13.5 6.5m-0.5 0a0.5 0.5 0 1 0 1 0a0.5 0.5 0 1 0-1 0',
      'M17.5 10.5m-0.5 0a0.5 0.5 0 1 0 1 0a0.5 0.5 0 1 0-1 0',
      'M6.5 12.5m-0.5 0a0.5 0.5 0 1 0 1 0a0.5 0.5 0 1 0-1 0',
      'M8.5 7.5m-0.5 0a0.5 0.5 0 1 0 1 0a0.5 0.5 0 1 0-1 0',
    ],
  },
  'pen-tool': {
    Icon: PenTool,
    paths: [
      'M15.707 21.293a1 1 0 0 1-1.414 0l-1.586-1.586a1 1 0 0 1 0-1.414l5.586-5.586a1 1 0 0 1 1.414 0l1.586 1.586a1 1 0 0 1 0 1.414z',
      'm18 13-1.375-6.874a1 1 0 0 0-.746-.776L3.235 2.028a1 1 0 0 0-1.207 1.207L5.35 15.879a1 1 0 0 0 .776.746L13 18',
      'm2.3 2.3 7.286 7.286',
      'M11 9m-2 0a2 2 0 1 0 4 0a2 2 0 1 0-4 0',
    ],
  },
  sparkles: {
    Icon: Sparkles,
    paths: [
      'M11.017 2.814a1 1 0 0 1 1.966 0l1.051 5.558a2 2 0 0 0 1.594 1.594l5.558 1.051a1 1 0 0 1 0 1.966l-5.558 1.051a2 2 0 0 0-1.594 1.594l-1.051 5.558a1 1 0 0 1-1.966 0l-1.051-5.558a2 2 0 0 0-1.594-1.594l-5.558-1.051a1 1 0 0 1 0-1.966l5.558-1.051a2 2 0 0 0 1.594-1.594z',
      'M20 2v4',
      'M22 4h-4',
      'M4 18m-2 0a2 2 0 1 0 4 0a2 2 0 1 0-4 0',
    ],
  },
  dices: {
    Icon: Dices,
    paths: [
      'M4 12h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2z',
      'm17.92 14 3.5-3.5a2.24 2.24 0 0 0 0-3l-5-4.92a2.24 2.24 0 0 0-3 0L10 6',
    ],
  },
  users: {
    Icon: Users,
    paths: [
      'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2',
      'M16 3.128a4 4 0 0 1 0 7.744',
      'M22 21v-2a4 4 0 0 0-3-3.87',
      'M9 7m-4 0a4 4 0 1 0 8 0a4 4 0 1 0-8 0',
    ],
  },
  baby: {
    Icon: Baby,
    paths: [
      'M10 16c.5.3 1.2.5 2 .5s1.5-.2 2-.5',
      'M15 12h.01',
      'M19.38 6.813A9 9 0 0 1 20.8 10.2a2 2 0 0 1 0 3.6 9 9 0 0 1-17.6 0 2 2 0 0 1 0-3.6A9 9 0 0 1 12 3c2 0 3.5 1.1 3.5 2.5s-.9 2.5-2 2.5c-.8 0-1.5-.4-1.5-1',
      'M9 12h.01',
    ],
  },
};

/** MapPin — used for unknown or missing icon keys. */
export const DEFAULT_CATEGORY_ICON: CategoryIconEntry = {
  Icon: MapPin,
  paths: [
    'M12,2.06a5.5,5.5,0,0,0-.5,10.97v8.41a.5.5,0,0,0,.5.5.5.5,0,0,0,.5-.5V13.03A5.5,5.5,0,0,0,12,2.06Zm0,10a4.5,4.5,0,1,1,4.5-4.5A4.5,4.5,0,0,1,12,12.06Z',
  ],
};

export function getCategoryIconEntry(iconKey: string | null | undefined): CategoryIconEntry {
  if (!iconKey) return DEFAULT_CATEGORY_ICON;
  return CATEGORY_ICON_REGISTRY[iconKey] ?? DEFAULT_CATEGORY_ICON;
}

/** Path tables only (no components) — safe to serialise into a WebView. */
export function categoryIconPathTable(): Record<string, readonly string[]> {
  return Object.fromEntries(
    Object.entries(CATEGORY_ICON_REGISTRY).map(([key, entry]) => [key, entry.paths])
  );
}
