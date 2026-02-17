/**
 * Premium category icon component.
 * Renders Lucide icons inside soft, color-coded circular/squircle backgrounds
 * for a bespoke app-store feel. Used in filter pills and floating event card.
 */

import { View, StyleSheet } from 'react-native';
import {
  getCategoryIconConfig,
  type CategoryIconSize,
} from '@/constants/categoryIcons';

type CategoryIconProps = {
  category: string;
  size?: CategoryIconSize;
  /** Use circle (true) or squircle/soft-rounded square (false) */
  shape?: 'circle' | 'squircle';
  /** 'pill' = icon in tinted circle (default). 'minimal' = icon only, no background */
  variant?: 'pill' | 'minimal';
};

const SIZE_SPEC = {
  sm: { container: 24, icon: 14, radius: 8 },
  md: { container: 40, icon: 20, radius: 12 },
  lg: { container: 56, icon: 28, radius: 16 },
} as const;

export function CategoryIcon({
  category,
  size = 'md',
  shape = 'circle',
  variant = 'pill',
}: CategoryIconProps) {
  const config = getCategoryIconConfig(category);
  const spec = SIZE_SPEC[size];
  const IconComponent = config.icon;

  const containerSize = spec.container;
  const iconSize = spec.icon;
  const borderRadius = shape === 'circle' ? containerSize / 2 : spec.radius;

  if (variant === 'minimal') {
    return (
      <View style={[styles.container, { width: containerSize, height: containerSize }]}>
        <IconComponent size={iconSize} color={config.color} strokeWidth={2} />
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
          backgroundColor: `${config.color}18`,
        },
      ]}
    >
      <IconComponent size={iconSize} color={config.color} strokeWidth={2} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    justifyContent: 'center',
  },
});
