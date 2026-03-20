/**
 * Eventmap Design System
 * See style.md for full documentation.
 */

export const Colors = {
  /** New brand red */
  primary: '#B41924',
  primaryDark: '#A3041A',
  primaryLight: '#FF7671',

  /** Warm secondary orange-brown */
  secondary: '#9B3E20',
  secondaryDark: '#8B3315',
  secondaryLight: '#FFC4B3',

  /** Accent retained for highlights and badges */
  accent: '#FF8EAA',
  accentDark: '#B40953',
  accentLight: '#FFEFF0',

  success: '#2D8A6E',
  warning: '#D4A017',
  error: '#B41340',

  text: {
    primary: '#2D2F2F',
    secondary: '#5A5C5C',
    tertiary: '#767777',
    disabled: '#9C9D9D',
    inverse: '#FFEFEE',
  },

  background: {
    /** Main canvas */
    primary: '#F6F6F6',
    /** Elevated surface */
    secondary: '#F0F1F1',
    /** Muted surface */
    tertiary: '#E7E8E8',
    /** Dark mode / overlays */
    dark: '#0C0F0F',
  },

  border: {
    light: '#DBDDDD',
    medium: '#ACADAD',
    dark: '#767777',
  },

  overlay: {
    light: 'rgba(28, 28, 28, 0.08)',
    medium: 'rgba(28, 28, 28, 0.25)',
    dark: 'rgba(28, 28, 28, 0.55)',
  },

  premium: '#B40953',
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


/** Plus Jakarta Sans – headings, display (modern, neutral) */
export const PlusJakartaSansFont = {
  regular: 'PlusJakartaSans_400Regular',
  medium: 'PlusJakartaSans_500Medium',
  semibold: 'PlusJakartaSans_600SemiBold',
  bold: 'PlusJakartaSans_700Bold',
  extrabold: 'PlusJakartaSans_800ExtraBold',
} as const;

/** DM Sans – body, UI, readable */
export const DMSansFont = {
  regular: 'DMSans_400Regular',
  medium: 'DMSans_500Medium',
  semibold: 'DMSans_600SemiBold',
  bold: 'DMSans_700Bold',
} as const;

/** Inter – labels and compact UI metadata */
export const InterFont = {
  regular: 'Inter_400Regular',
  medium: 'Inter_500Medium',
  semibold: 'Inter_600SemiBold',
} as const;

export const Typography = {
  fontFamily: DMSansFont.regular,
  fontFamilies: DMSansFont,
  displayFont: PlusJakartaSansFont.bold,
  displayFontFamilies: PlusJakartaSansFont,
  labelFont: InterFont.medium,
  labelFontFamilies: InterFont,
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
