/**
 * Lucide glyphs available to event categories, as SVG path data on a 24×24
 * grid, keyed by `categories.icon_key`. The admin app has no icon library,
 * so previews are inline SVGs built from these paths.
 *
 * This is a copy of the app's constants/categoryIconRegistry.ts path table;
 * tests/adminCategoryForm.test.ts in the app repo fails if the two drift.
 */
export const CATEGORY_ICON_PATHS: Readonly<Record<string, readonly string[]>> = {
  'disc-3': [
    'M12 2 A10 10 0 0 1 22 12 A10 10 0 0 1 12 22 A10 10 0 0 1 2 12 A10 10 0 0 1 12 2',
    'M6 12c0-1.7.7-3.2 1.8-4.2',
    'M12 10 A2 2 0 0 1 14 12 A2 2 0 0 1 12 14 A2 2 0 0 1 10 12 A2 2 0 0 1 12 10',
    'M18 12c0 1.7-.7 3.2-1.8 4.2',
  ],
  'mic-vocal': [
    'm11 7.601-5.994 8.19a1 1 0 0 0 .1 1.298l.817.818a1 1 0 0 0 1.314.087L15.09 12',
    'M16.5 21.174C15.5 20.5 14.372 20 13 20c-2.058 0-3.928 2.356-6 2-2.072-.356-2.775-3.369-1.5-4.5',
    'M16 7m-5 0a5 5 0 1 0 10 0a5 5 0 1 0-10 0',
  ],
  coffee: [
    'M10 2v2',
    'M14 2v2',
    'M16 8a1 1 0 0 1 1 1v8a4 4 0 0 1-4 4H7a4 4 0 0 1-4-4V9a1 1 0 0 1 1-1h14a4 4 0 1 1 0 8h-1',
    'M6 2v2',
  ],
  'utensils-crossed': [
    'm16 2-2.3 2.3a3 3 0 0 0 0 4.2l1.8 1.8a3 3 0 0 0 4.2 0L22 8',
    'M15 15 3.3 3.3a4.2 4.2 0 0 0 0 6l7.3 7.3c.7.7 2 .7 2.8 0L15 15Zm0 0 7 7',
    'm2.1 21.8 6.4-6.3',
    'm19 5-7 7',
  ],
  flame: [
    'M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 0 0 2.5 2.5z',
  ],
  trophy: [
    'M10 14.66v1.626a2 2 0 0 1-.976 1.696A5 5 0 0 0 7 21.978',
    'M14 14.66v1.626a2 2 0 0 0 .976 1.696A5 5 0 0 1 17 21.978',
    'M18 9h1.5a1 1 0 0 0 0-5H18',
    'M4 22h16',
    'M6 9a6 6 0 0 0 12 0V3a1 1 0 0 0-1-1H7a1 1 0 0 0-1 1z',
    'M6 9H4.5a1 1 0 0 1 0-5H6',
  ],
  palette: [
    'M12 22a1 1 0 0 1 0-20 10 9 0 0 1 10 9 5 5 0 0 1-5 5h-2.25a1.75 1.75 0 0 0-1.4 2.8l.3.4a1.75 1.75 0 0 1-1.4 2.8z',
    'M13.5 6.5m-0.5 0a0.5 0.5 0 1 0 1 0a0.5 0.5 0 1 0-1 0',
    'M17.5 10.5m-0.5 0a0.5 0.5 0 1 0 1 0a0.5 0.5 0 1 0-1 0',
    'M6.5 12.5m-0.5 0a0.5 0.5 0 1 0 1 0a0.5 0.5 0 1 0-1 0',
    'M8.5 7.5m-0.5 0a0.5 0.5 0 1 0 1 0a0.5 0.5 0 1 0-1 0',
  ],
  'pen-tool': [
    'M15.707 21.293a1 1 0 0 1-1.414 0l-1.586-1.586a1 1 0 0 1 0-1.414l5.586-5.586a1 1 0 0 1 1.414 0l1.586 1.586a1 1 0 0 1 0 1.414z',
    'm18 13-1.375-6.874a1 1 0 0 0-.746-.776L3.235 2.028a1 1 0 0 0-1.207 1.207L5.35 15.879a1 1 0 0 0 .776.746L13 18',
    'm2.3 2.3 7.286 7.286',
    'M11 9m-2 0a2 2 0 1 0 4 0a2 2 0 1 0-4 0',
  ],
  sparkles: [
    'M11.017 2.814a1 1 0 0 1 1.966 0l1.051 5.558a2 2 0 0 0 1.594 1.594l5.558 1.051a1 1 0 0 1 0 1.966l-5.558 1.051a2 2 0 0 0-1.594 1.594l-1.051 5.558a1 1 0 0 1-1.966 0l-1.051-5.558a2 2 0 0 0-1.594-1.594l-5.558-1.051a1 1 0 0 1 0-1.966l5.558-1.051a2 2 0 0 0 1.594-1.594z',
    'M20 2v4',
    'M22 4h-4',
    'M4 18m-2 0a2 2 0 1 0 4 0a2 2 0 1 0-4 0',
  ],
  dices: [
    'M4 12h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2z',
    'm17.92 14 3.5-3.5a2.24 2.24 0 0 0 0-3l-5-4.92a2.24 2.24 0 0 0-3 0L10 6',
  ],
  users: [
    'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2',
    'M16 3.128a4 4 0 0 1 0 7.744',
    'M22 21v-2a4 4 0 0 0-3-3.87',
    'M9 7m-4 0a4 4 0 1 0 8 0a4 4 0 1 0-8 0',
  ],
  baby: [
    'M10 16c.5.3 1.2.5 2 .5s1.5-.2 2-.5',
    'M15 12h.01',
    'M19.38 6.813A9 9 0 0 1 20.8 10.2a2 2 0 0 1 0 3.6 9 9 0 0 1-17.6 0 2 2 0 0 1 0-3.6A9 9 0 0 1 12 3c2 0 3.5 1.1 3.5 2.5s-.9 2.5-2 2.5c-.8 0-1.5-.4-1.5-1',
    'M9 12h.01',
  ],
};

export const CATEGORY_ICON_KEYS: readonly string[] = Object.keys(CATEGORY_ICON_PATHS);

/** Inline SVG markup for a glyph preview (used via dangerouslySetInnerHTML-free JSX in CategoryGlyph). */
export function iconPaths(iconKey: string | null | undefined): readonly string[] {
  return (iconKey && CATEGORY_ICON_PATHS[iconKey]) || [];
}
