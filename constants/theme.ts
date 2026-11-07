/**
 * Eventmap Design System
 * See style.md for full documentation.
 */

/**
 * Convert a 6-digit hex color to an rgba() string at the given opacity.
 * Use this instead of concatenating alpha hex onto color tokens.
 */
export function alpha(hex: string, opacity: number): string {
  const value = hex.replace('#', '');
  const r = parseInt(value.slice(0, 2), 16);
  const g = parseInt(value.slice(2, 4), 16);
  const b = parseInt(value.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${opacity})`;
}

export const Colors = {
  /** New brand red */
  primary: '#B41924',
  /** Soft brand tint for badge/chip backgrounds and glows */
  primarySoft: 'rgba(180, 25, 36, 0.10)',
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
  /** Text-safe success — use for success-colored text/icons on light backgrounds (AA ≥ 4.5:1) */
  successText: '#1F7058',
  warning: '#D4A017',
  /** Text-safe warning — use for warning-colored text/icons on light backgrounds (AA ≥ 4.5:1) */
  warningText: '#8A6A00',
  error: '#B41340',

  text: {
    primary: '#2D2F2F',
    secondary: '#5A5C5C',
    tertiary: '#6B6C6C',
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
    medium: '#8E8F8F',
    dark: '#767777',
  },

  overlay: {
    light: 'rgba(28, 28, 28, 0.08)',
    medium: 'rgba(28, 28, 28, 0.25)',
    dark: 'rgba(28, 28, 28, 0.55)',
  },

  premium: '#B40953',
  /** Soft premium tint for badges and highlighted rows */
  premiumSoft: 'rgba(180, 9, 83, 0.10)',

  /** Pure white — text/icons on filled brand surfaces */
  white: '#FFFFFF',
  /** Card / elevated surface color */
  surface: '#FFFFFF',
  /** Neutral soft tint for muted chips and icon wells */
  neutralSoft: 'rgba(45, 47, 47, 0.06)',
  /** Soft error tint for destructive-action backgrounds */
  errorSoft: 'rgba(180, 19, 64, 0.10)',
  /** Soft success tint */
  successSoft: 'rgba(45, 138, 110, 0.10)',
  /** Soft warning tint (ratings, premium gold accents) */
  warningSoft: 'rgba(212, 160, 23, 0.12)',
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
  mono: 'monospace',
  regular: 'DMSans_400Regular',
  medium: 'DMSans_500Medium',
  semibold: 'DMSans_600SemiBold',
  bold: 'DMSans_700Bold',
} as const;

/**
 * Labels and compact UI metadata. Was Inter, which alone was ~670 KB of the
 * ~1.2 MB of fonts loaded at startup (two weights, labels only); labels now
 * use DM Sans weights that are loaded anyway for body text.
 */
export const LabelFont = {
  medium: DMSansFont.medium,
  semibold: DMSansFont.semibold,
} as const;

export const Typography = {
  fontFamily: DMSansFont.regular,
  fontFamilies: DMSansFont,
  displayFont: PlusJakartaSansFont.bold,
  displayFontFamilies: PlusJakartaSansFont,
  labelFont: LabelFont.medium,
  labelFontFamilies: LabelFont,
  sizes: {
    /** Smallest legible label size — tiny badges and pills only */
    xxs: 11,
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
    extrabold: '800' as const,
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
  /** Softer shadow for cards */
  card: {
    shadowColor: '#2D2F2F',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.08,
    shadowRadius: 12,
    elevation: 6,
  },
};
