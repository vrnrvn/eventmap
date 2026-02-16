/**
 * Eventmap Design System
 * See style.md for full documentation.
 */

export const Colors = {
  /** Terracotta – warm, earthy, place-centric primary */
  primary: '#C45C3E',
  primaryDark: '#A34A2F',
  primaryLight: '#D47A5F',

  /** Deep teal – geography, water, secondary actions */
  secondary: '#0D4F4F',
  secondaryDark: '#083838',
  secondaryLight: '#1A6B6B',

  /** Warm amber – energy, events, accents */
  accent: '#E8A838',
  accentDark: '#C98E1F',
  accentLight: '#F0BC5C',

  success: '#2D8A6E',
  warning: '#D4A017',
  error: '#C45C3E',

  text: {
    primary: '#1C1C1C',
    secondary: '#5C5C5C',
    tertiary: '#8A8A8A',
    disabled: '#B8B8B8',
    inverse: '#FAF8F5',
  },

  background: {
    /** Warm cream – main app background */
    primary: '#FAF8F5',
    /** Slightly cooler surface for cards */
    secondary: '#F2EFE9',
    /** Deeper surface for contrast */
    tertiary: '#E8E4DC',
    /** Dark mode / overlays */
    dark: '#1C1C1C',
  },

  border: {
    light: '#E8E4DC',
    medium: '#D4CFC4',
    dark: '#8A8A8A',
  },

  overlay: {
    light: 'rgba(28, 28, 28, 0.08)',
    medium: 'rgba(28, 28, 28, 0.25)',
    dark: 'rgba(28, 28, 28, 0.55)',
  },

  premium: '#E8A838',
};

export const Spacing = {
  xs: 4,
  sm: 8,
  md: 16,
  lg: 24,
  xl: 32,
  xxl: 48,
  xxxl: 64,
};

export const BorderRadius = {
  sm: 6,
  md: 12,
  lg: 18,
  xl: 24,
  xxl: 32,
  round: 9999,
};

/** Syne – headings, display, editorial */
export const SyneFont = {
  regular: 'Syne_400Regular',
  medium: 'Syne_500Medium',
  semibold: 'Syne_600SemiBold',
  bold: 'Syne_700Bold',
  extrabold: 'Syne_800ExtraBold',
} as const;

/** DM Sans – body, UI, readable */
export const DMSansFont = {
  regular: 'DMSans_400Regular',
  medium: 'DMSans_500Medium',
  semibold: 'DMSans_600SemiBold',
  bold: 'DMSans_700Bold',
} as const;

export const Typography = {
  fontFamily: DMSansFont.regular,
  fontFamilies: DMSansFont,
  displayFont: SyneFont.bold,
  displayFontFamilies: SyneFont,
  sizes: {
    xs: 12,
    sm: 14,
    md: 16,
    lg: 18,
    xl: 24,
    xxl: 32,
    xxxl: 48,
  },
  weights: {
    regular: '400' as const,
    medium: '500' as const,
    semibold: '600' as const,
    bold: '700' as const,
  },
  lineHeights: {
    tight: 1.2,
    normal: 1.5,
    relaxed: 1.75,
  },
};

export const Shadows = {
  sm: {
    shadowColor: '#1C1C1C',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 3,
    elevation: 2,
  },
  md: {
    shadowColor: '#1C1C1C',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.1,
    shadowRadius: 8,
    elevation: 5,
  },
  lg: {
    shadowColor: '#1C1C1C',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.12,
    shadowRadius: 16,
    elevation: 10,
  },
  /** Softer, warmer shadow for cards */
  card: {
    shadowColor: '#C45C3E',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.08,
    shadowRadius: 12,
    elevation: 6,
  },
};
