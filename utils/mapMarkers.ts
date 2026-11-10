export type MarkerKeyInput = {
  id: string;
  lat: number;
  lng: number;
  categorySlug?: string | null;
  categoryColor?: string | null;
  categoryIconKey?: string | null;
};

/**
 * Identity of the marker set as currently rendered in the map WebView, used to
 * skip redundant injections.
 *
 * It must cover everything the injected markers render from — not just the ids.
 * The location pickers keep a single marker with a fixed id (`'business'`,
 * `'profile'`, …) and move it on every map tap / search pick, so an id-only key
 * left the pin stranded at its first position while the map panned away. The
 * category style fields are included for the same reason: a category recolour
 * from the database must redraw the pins.
 *
 * Order-independent (the map doesn't care about array order) and delimiter-safe
 * so distinct marker sets can't alias onto the same key.
 */
export function markerStateKey(markers: readonly MarkerKeyInput[]): string {
  return markers
    .map(
      (m) =>
        `${m.id}@${m.lat},${m.lng}#${m.categorySlug ?? ''}#${m.categoryColor ?? ''}#${m.categoryIconKey ?? ''}`
    )
    .sort()
    .join('|');
}
