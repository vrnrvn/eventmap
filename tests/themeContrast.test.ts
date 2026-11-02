import { describe, it, expect } from 'vitest';
import { Colors, Typography } from '@/constants/theme';

/**
 * WCAG 2.x contrast guarantees for the design system.
 *
 * These assertions lock in the accessibility contract documented in
 * constants/theme.ts (text-safe tokens, soft tints, brand fills). If one of
 * them fails after a palette tweak, the failure message names the pair and
 * the measured ratio — fix the token, don't loosen the threshold.
 */

type RGB = [number, number, number];

/** Parse '#RRGGBB' (or '#RGB') into an RGB triple. */
function parseHex(color: string): RGB {
  const value = color.trim().replace(/^#/, '');
  if (/^[0-9a-f]{3}$/i.test(value)) {
    return [
      parseInt(value[0] + value[0], 16),
      parseInt(value[1] + value[1], 16),
      parseInt(value[2] + value[2], 16),
    ];
  }
  if (!/^[0-9a-f]{6}$/i.test(value)) {
    throw new Error(`Not a parseable hex color: "${color}"`);
  }
  return [
    parseInt(value.slice(0, 2), 16),
    parseInt(value.slice(2, 4), 16),
    parseInt(value.slice(4, 6), 16),
  ];
}

/** Parse 'rgba(r, g, b, a)' / 'rgb(r, g, b)' into RGB + alpha. */
function parseRgba(color: string): { rgb: RGB; alpha: number } {
  const match = color
    .trim()
    .match(/^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*(?:,\s*([\d.]+)\s*)?\)$/i);
  if (!match) {
    throw new Error(`Not a parseable rgb()/rgba() color: "${color}"`);
  }
  const [, r, g, b, a] = match;
  return {
    rgb: [Number(r), Number(g), Number(b)],
    alpha: a === undefined ? 1 : Number(a),
  };
}

/** Parse any supported color string into RGB + alpha. */
function parseColor(color: string): { rgb: RGB; alpha: number } {
  if (color.trim().startsWith('#')) {
    return { rgb: parseHex(color), alpha: 1 };
  }
  return parseRgba(color);
}

/** Alpha-composite a (possibly translucent) color over an opaque backdrop. */
function compositeOver(foreground: string, backdrop: string): RGB {
  const fg = parseColor(foreground);
  const bg = parseColor(backdrop);
  if (bg.alpha !== 1) {
    throw new Error(`Backdrop must be opaque, got "${backdrop}"`);
  }
  return fg.rgb.map((channel, i) =>
    channel * fg.alpha + bg.rgb[i] * (1 - fg.alpha),
  ) as RGB;
}

/** WCAG relative luminance of an sRGB color. */
function relativeLuminance([r, g, b]: RGB): number {
  const linearize = (channel: number) => {
    const c = channel / 255;
    return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * linearize(r) + 0.7152 * linearize(g) + 0.0722 * linearize(b);
}

/** WCAG contrast ratio between two opaque colors (strings or RGB triples). */
function contrastRatio(a: string | RGB, b: string | RGB): number {
  const toRgb = (color: string | RGB): RGB => {
    if (typeof color !== 'string') return color;
    const parsed = parseColor(color);
    if (parsed.alpha !== 1) {
      throw new Error(
        `Translucent color "${color}" must be composited before measuring contrast`,
      );
    }
    return parsed.rgb;
  };
  const l1 = relativeLuminance(toRgb(a));
  const l2 = relativeLuminance(toRgb(b));
  const [lighter, darker] = l1 >= l2 ? [l1, l2] : [l2, l1];
  return (lighter + 0.05) / (darker + 0.05);
}

/** Assert with a message naming the pair and the measured ratio. */
function expectContrast(
  label: string,
  fg: string | RGB,
  bg: string | RGB,
  minimum: number,
) {
  const ratio = contrastRatio(fg, bg);
  expect(
    ratio,
    `${label}: contrast ${ratio.toFixed(3)}:1 is below the required ${minimum}:1 ` +
      `(short by ${(minimum - ratio).toFixed(3)})`,
  ).toBeGreaterThanOrEqual(minimum);
}

describe('color parsing helpers (self-check)', () => {
  it('parses hex and rgba strings', () => {
    expect(parseHex('#FFFFFF')).toEqual([255, 255, 255]);
    expect(parseHex('#2D2F2F')).toEqual([45, 47, 47]);
    expect(parseRgba('rgba(180, 25, 36, 0.10)')).toEqual({
      rgb: [180, 25, 36],
      alpha: 0.1,
    });
    expect(parseRgba('rgb(1,2,3)')).toEqual({ rgb: [1, 2, 3], alpha: 1 });
  });

  it('composites translucent tints over an opaque surface', () => {
    expect(compositeOver('rgba(0, 0, 0, 0.5)', '#FFFFFF')).toEqual([
      127.5, 127.5, 127.5,
    ]);
    expect(compositeOver('#000000', '#FFFFFF')).toEqual([0, 0, 0]);
  });

  it('reproduces canonical WCAG ratios', () => {
    expect(contrastRatio('#000000', '#FFFFFF')).toBeCloseTo(21, 5);
    expect(contrastRatio('#FFFFFF', '#FFFFFF')).toBeCloseTo(1, 5);
  });
});

describe('body text meets AA (>= 4.5:1) on all light canvases', () => {
  const canvases: Array<[string, string]> = [
    ['background.primary', Colors.background.primary],
    ['background.secondary', Colors.background.secondary],
    ['surface', Colors.surface],
  ];
  const textTokens: Array<[string, string]> = [
    ['text.primary', Colors.text.primary],
    ['text.secondary', Colors.text.secondary],
    ['text.tertiary', Colors.text.tertiary],
  ];

  for (const [bgName, bg] of canvases) {
    for (const [fgName, fg] of textTokens) {
      it(`${fgName} on ${bgName}`, () => {
        expectContrast(`${fgName} on ${bgName}`, fg, bg, 4.5);
      });
    }
  }

  it('background.primary is the documented #F6F6F6', () => {
    expect(Colors.background.primary.toUpperCase()).toBe('#F6F6F6');
  });

  it('surface is the documented #FFFFFF', () => {
    expect(Colors.surface.toUpperCase()).toBe('#FFFFFF');
  });
});

describe('text-safe status tokens meet AA on surface and their soft tints', () => {
  it('successText on surface', () => {
    expectContrast('successText on surface', Colors.successText, Colors.surface, 4.5);
  });

  it('successText on successSoft composited over surface', () => {
    const tint = compositeOver(Colors.successSoft, Colors.surface);
    expectContrast('successText on successSoft@surface', Colors.successText, tint, 4.5);
  });

  it('warningText on surface', () => {
    expectContrast('warningText on surface', Colors.warningText, Colors.surface, 4.5);
  });

  it('warningText on warningSoft composited over surface', () => {
    const tint = compositeOver(Colors.warningSoft, Colors.surface);
    expectContrast('warningText on warningSoft@surface', Colors.warningText, tint, 4.5);
  });
});

describe('text on filled brand surfaces meets AA', () => {
  it('white on primary', () => {
    expectContrast('white on primary', Colors.white, Colors.primary, 4.5);
  });

  it('text.inverse on primary', () => {
    expectContrast('text.inverse on primary', Colors.text.inverse, Colors.primary, 4.5);
  });
});

describe('saturated tokens meet AA on their soft tints (badges/chips)', () => {
  it('primary on primarySoft composited over surface', () => {
    const tint = compositeOver(Colors.primarySoft, Colors.surface);
    expectContrast('primary on primarySoft@surface', Colors.primary, tint, 4.5);
  });

  it('premium on premiumSoft composited over surface', () => {
    const tint = compositeOver(Colors.premiumSoft, Colors.surface);
    expectContrast('premium on premiumSoft@surface', Colors.premium, tint, 4.5);
  });

  it('error on errorSoft composited over surface', () => {
    const tint = compositeOver(Colors.errorSoft, Colors.surface);
    expectContrast('error on errorSoft@surface', Colors.error, tint, 4.5);
  });
});

describe('non-text UI contrast (>= 3:1)', () => {
  it('border.medium on surface', () => {
    expectContrast('border.medium on surface', Colors.border.medium, Colors.surface, 3);
  });
});

describe('design-system token presence', () => {
  it('Typography.sizes.xxs is 11', () => {
    expect(Typography.sizes.xxs).toBe(11);
  });

  it("Typography.weights.extrabold is '800'", () => {
    expect(Typography.weights.extrabold).toBe('800');
  });

  it('Colors.white, successText, and warningText exist', () => {
    expect(Colors.white).toBeDefined();
    expect(Colors.successText).toBeDefined();
    expect(Colors.warningText).toBeDefined();
  });
});
