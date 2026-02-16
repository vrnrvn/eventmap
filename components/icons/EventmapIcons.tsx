import React from 'react';
import Svg, { Path, Circle, Rect } from 'react-native-svg';

type IconProps = {
  size?: number;
  color?: string;
};

export function EventmapSearch({ size = 20, color = '#8A8A8A' }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" accessibilityLabel="Search">
      <Circle
        cx="10"
        cy="10"
        r="6"
        stroke={color}
        strokeWidth={2}
        strokeLinecap="round"
        fill="none"
      />
      <Path
        d="M14.5 14.5L19 19"
        stroke={color}
        strokeWidth={2}
        strokeLinecap="round"
      />
    </Svg>
  );
}

export function EventmapFilter({ size = 20, color = '#C45C3E' }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" accessibilityLabel="Filter">
      <Path
        d="M4 6h16M7 12h10M10 18h4"
        stroke={color}
        strokeWidth={2}
        strokeLinecap="round"
      />
    </Svg>
  );
}

export function EventmapMapPin({ size = 20, color = '#5C5C5C' }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" accessibilityLabel="Location">
      <Path
        d="M12 2L20 10L12 18L4 10L12 2Z"
        fill={color}
        stroke={color}
        strokeWidth={1}
        strokeLinejoin="round"
      />
    </Svg>
  );
}

export function EventmapCalendar({ size = 20, color = '#5C5C5C' }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" accessibilityLabel="Calendar">
      <Rect
        x="3"
        y="5"
        width="18"
        height="16"
        rx="2"
        stroke={color}
        strokeWidth={2}
        fill="none"
      />
      <Path d="M3 10h18" stroke={color} strokeWidth={2} />
      <Path d="M8 3v4M16 3v4" stroke={color} strokeWidth={2} strokeLinecap="round" />
    </Svg>
  );
}
