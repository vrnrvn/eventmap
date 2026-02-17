/** Bespoke palette aligned with CategoryIcon config */
export const CATEGORY_COLORS: Record<string, string> = {
  nightlife: '#9333ea',
  fitness: '#ea580c',
  'food-drink': '#d97706',
  trivia: '#4f46e5',
  markets: '#0d9488',
  'live-music': '#2563eb',
  workshops: '#475569',
  dining: '#e11d48',
  sports: '#059669',
  culture: '#c026d3',
  coffee: '#d97706',
  cafe: '#d97706',
};

export const DEFAULT_CATEGORY_COLOR = '#607D8B';

export function getCategoryColor(slug: string | null | undefined): string {
  if (!slug) return DEFAULT_CATEGORY_COLOR;
  return CATEGORY_COLORS[slug] ?? DEFAULT_CATEGORY_COLOR;
}
