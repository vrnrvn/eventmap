/**
 * Category icon: the category's Lucide glyph inside a soft, colour-tinted
 * circle or squircle (or bare, with `variant="minimal"`). Used in filter
 * chips, pickers, the floating map card and event badges.
 *
 * Accepts a `categories` row (preferred — colour and icon come from the
 * database), an event-category slug, or a business category label; see
 * utils/categoryPresentation.ts for the resolution rules.
 */

import { View, StyleSheet } from 'react-native';
import { categoryTint, presentCategory, type CategoryLike } from '@/utils/categoryPresentation';

export type CategoryIconSize = 'sm' | 'md' | 'lg';

type CategoryIconProps = {
  category: CategoryLike;
  size?: CategoryIconSize;
  /** Use circle (true) or squircle/soft-rounded square (false) */
  shape?: 'circle' | 'squircle';
  /** 'pill' = icon in tinted circle (default). 'minimal' = icon only, no background */
  variant?: 'pill' | 'minimal';
  /** Override the glyph colour (e.g. white on a filled, selected chip). */
  color?: string;
};

const SIZE_SPEC = {
  sm: { container: 24, icon: 14, radius: 8 },
  md: { container: 40, icon: 20, radius: 12 },
  lg: { container: 56, icon: 28, radius: 16 },
} as const;

export function getCategoryIconSize(size: CategoryIconSize) {
  return SIZE_SPEC[size];
}

export function CategoryIcon({
  category,
  size = 'md',
  shape = 'circle',
  variant = 'pill',
  color,
}: CategoryIconProps) {
  const presentation = presentCategory(category);
  const spec = SIZE_SPEC[size];
  const IconComponent = presentation.Icon;
  const glyphColor = color ?? presentation.color;

  const containerSize = spec.container;
  const iconSize = spec.icon;
  const borderRadius = shape === 'circle' ? containerSize / 2 : spec.radius;

  if (variant === 'minimal') {
    return (
      <View style={[styles.container, { width: containerSize, height: containerSize }]}>
        <IconComponent size={iconSize} color={glyphColor} strokeWidth={2} />
      </View>
    );
  }

  return (
    <View
      style={[
        styles.container,
        {
          width: containerSize,
          height: containerSize,
          borderRadius,
          backgroundColor: categoryTint(presentation.color, 0.1),
        },
      ]}
    >
      <IconComponent size={iconSize} color={glyphColor} strokeWidth={2} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    justifyContent: 'center',
  },
});
