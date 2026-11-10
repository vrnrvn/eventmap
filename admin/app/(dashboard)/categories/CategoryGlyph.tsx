import { iconPaths } from '@/lib/categoryIcons';

/**
 * Inline SVG preview of a category glyph (Lucide path data, stroked), in a
 * tinted disc like the app's CategoryIcon. Falls back to a plain dot when
 * the icon key is unknown so a typo is visible rather than invisible.
 */
export function CategoryGlyph({
  iconKey,
  color,
  size = 32,
  filled = false,
}: {
  iconKey: string | null | undefined;
  color: string;
  size?: number;
  filled?: boolean;
}) {
  const paths = iconPaths(iconKey);
  const stroke = filled ? '#ffffff' : color;
  return (
    <span
      aria-hidden
      className="inline-flex shrink-0 items-center justify-center rounded-full"
      style={{ width: size, height: size, backgroundColor: filled ? color : `${color}1a` }}
    >
      <svg
        width={size * 0.55}
        height={size * 0.55}
        viewBox="0 0 24 24"
        fill="none"
        stroke={stroke}
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        {paths.length > 0 ? (
          paths.map((d) => <path key={d} d={d} />)
        ) : (
          <circle cx="12" cy="12" r="4" fill={stroke} stroke="none" />
        )}
      </svg>
    </span>
  );
}
