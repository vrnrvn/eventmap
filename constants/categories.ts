export const CATEGORY_COLORS: Record<string, string> = {
  nightlife: '#9C27B0',
  fitness: '#4CAF50',
  'food-drink': '#FF9800',
  trivia: '#2196F3',
  markets: '#00BCD4',
  'live-music': '#E91E63',
  workshops: '#673AB7',
  dining: '#F44336',
  sports: '#FFC107',
  culture: '#795548',
};

export const DEFAULT_CATEGORY_COLOR = '#607D8B';

export function getCategoryColor(slug: string | null | undefined): string {
  if (!slug) return DEFAULT_CATEGORY_COLOR;
  return CATEGORY_COLORS[slug] ?? DEFAULT_CATEGORY_COLOR;
}
