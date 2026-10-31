import { describe, it, expect } from 'vitest';
import {
  buildActiveMarkerInjection,
  buildAnimateToInjection,
  buildMarkersInjection,
  encodeForSingleQuotedLiteral,
  type InjectableMarker,
} from '@/utils/webviewInject';

/**
 * Execute an injection snippet against stub globals and return what the page
 * actually received. This is the real contract: the snippet is source code, so
 * a malformed literal is a syntax error that silently stops marker updates.
 */
function runMarkers(script: string): { markers: InjectableMarker[]; activeId: string } | null {
  let captured: { markers: InjectableMarker[]; activeId: string } | null = null;
  const win = {
    __updateMarkers: (markers: InjectableMarker[], activeId: string) => {
      captured = { markers, activeId };
    },
  };
  new Function('window', script)(win);
  return captured;
}

function runActive(script: string): string | null {
  let captured: string | null = null;
  const win = { __updateActiveMarker: (id: string) => (captured = id) };
  new Function('window', script)(win);
  return captured;
}

const base = (title: string): InjectableMarker => ({
  id: 'e1',
  lat: 37.7749,
  lng: -122.4194,
  title,
  categorySlug: 'dining',
});

describe('encodeForSingleQuotedLiteral', () => {
  it('produces a literal that parses back to the original value', () => {
    const nasty = [
      `plain`,
      `single ' quote`,
      `double " quote`,
      `back \\ slash`,
      `both ' and " and \\`,
      `new\nline`,
      `tab\there`,
      `carriage\rreturn`,
      `</script><script>alert(1)</script>`,
      `'; alert(1); var x='`,
      `\\'; alert(1); //`,
      `emoji 🎉🗺️ and accents café naïve`,
      `rtl ‮evil`,
      `null\u0000byte`,
      `line separator`,
      `paragraph separator`,
      `{"nested":"json"}`,
      `\${template}`,
      `back\`tick`,
    ];
    for (const title of nasty) {
      const literal = encodeForSingleQuotedLiteral({ title });
      const parsed = new Function(`return JSON.parse('${literal}')`)() as { title: string };
      expect(parsed.title, JSON.stringify(title)).toBe(title);
    }
  });

  it('escapes the JS line terminators JSON.stringify leaves raw', () => {
    // U+2028/U+2029 are legal in JSON strings but terminate a JS string
    // literal on older engines, which would break the whole injection.
    expect(encodeForSingleQuotedLiteral('a b')).toContain('\\u2028');
    expect(encodeForSingleQuotedLiteral('a b')).toContain('\\u2029');
    expect(encodeForSingleQuotedLiteral('a b')).not.toContain(' ');
    expect(encodeForSingleQuotedLiteral('a b')).not.toContain(' ');
  });

  it('leaves no bare single quote that would close the literal', () => {
    const literal = encodeForSingleQuotedLiteral("it's a 'test'");
    // Every ' must be preceded by a backslash.
    for (let i = 0; i < literal.length; i++) {
      if (literal[i] === "'") expect(literal[i - 1], `index ${i}`).toBe('\\');
    }
  });
});

describe('buildMarkersInjection', () => {
  it('round-trips marker data through the generated script', () => {
    const markers = [base(`O'Brien's "Pub" \\ Grill`), { ...base('Second'), id: 'e2' }];
    const result = runMarkers(buildMarkersInjection(markers, 'e2'));
    expect(result).not.toBeNull();
    expect(result!.markers).toEqual(markers);
    expect(result!.activeId).toBe('e2');
  });

  it('survives every hostile title', () => {
    for (const title of [
      `'); window.__pwned=1; ('`,
      `\\'); window.__pwned=1; ('`,
      `</script>`,
      `"}]); window.__pwned=1; //`,
      ` window.__pwned=1`,
      `🎉`,
    ]) {
      const script = buildMarkersInjection([base(title)], '');
      const result = runMarkers(script);
      expect(result?.markers[0].title, JSON.stringify(title)).toBe(title);
      expect((globalThis as Record<string, unknown>).__pwned).toBeUndefined();
    }
  });

  it('handles an empty marker set', () => {
    const result = runMarkers(buildMarkersInjection([], ''));
    expect(result).toEqual({ markers: [], activeId: '' });
  });

  it('handles a large marker set', () => {
    const many = Array.from({ length: 2000 }, (_, i) => ({ ...base(`Event ${i}`), id: `e${i}` }));
    const result = runMarkers(buildMarkersInjection(many, 'e1999'));
    expect(result!.markers).toHaveLength(2000);
    expect(result!.activeId).toBe('e1999');
  });

  it('preserves numeric precision', () => {
    const precise = { ...base('x'), lat: 37.774929123456, lng: -122.419415987654 };
    const result = runMarkers(buildMarkersInjection([precise], ''));
    expect(result!.markers[0].lat).toBe(precise.lat);
    expect(result!.markers[0].lng).toBe(precise.lng);
  });

  it('is a no-op when the page has not defined the handler yet', () => {
    // Injection can land before the map script runs; it must not throw.
    expect(() => new Function('window', buildMarkersInjection([base('x')], ''))({})).not.toThrow();
  });

  it('swallows a handler that throws rather than killing the page', () => {
    const win = {
      __updateMarkers: () => {
        throw new Error('boom');
      },
    };
    expect(() => new Function('window', buildMarkersInjection([base('x')], ''))(win)).not.toThrow();
  });
});

describe('buildActiveMarkerInjection', () => {
  it('round-trips ordinary and hostile ids', () => {
    for (const id of ['', 'e1', "it's", 'a\\b', '🎉', 'a b']) {
      expect(runActive(buildActiveMarkerInjection(id)), JSON.stringify(id)).toBe(id);
    }
  });

  it('is a no-op before the handler exists', () => {
    expect(() => new Function('window', buildActiveMarkerInjection('e1'))({})).not.toThrow();
  });
});

describe('buildAnimateToInjection', () => {
  function runAnimate(script: string) {
    const calls: { pan?: { lat: number; lng: number }; zoom?: number } = {};
    const win = {
      __map: {
        panTo: (c: { lat: number; lng: number }) => (calls.pan = c),
        setZoom: (z: number) => (calls.zoom = z),
      },
    };
    new Function('window', script)(win);
    return calls;
  }

  it('pans to the given coordinates', () => {
    expect(runAnimate(buildAnimateToInjection(37.7749, -122.4194)!)).toEqual({
      pan: { lat: 37.7749, lng: -122.4194 },
    });
  });

  it('sets zoom only when supplied', () => {
    expect(runAnimate(buildAnimateToInjection(1, 2, 15)!).zoom).toBe(15);
    expect(runAnimate(buildAnimateToInjection(1, 2)!).zoom).toBeUndefined();
  });

  it('refuses unusable coordinates instead of emitting broken JS', () => {
    expect(buildAnimateToInjection(NaN, 1)).toBeNull();
    expect(buildAnimateToInjection(1, NaN)).toBeNull();
    expect(buildAnimateToInjection(Infinity, 1)).toBeNull();
    expect(buildAnimateToInjection(-Infinity, 1)).toBeNull();
    expect(buildAnimateToInjection(undefined as unknown as number, 1)).toBeNull();
  });

  it('refuses the values Number() silently turns into zero', () => {
    // A null lat from the database must not pan the map to 0,0.
    expect(buildAnimateToInjection(null as unknown as number, 1)).toBeNull();
    expect(buildAnimateToInjection(1, null as unknown as number)).toBeNull();
    expect(buildAnimateToInjection('' as unknown as number, 1)).toBeNull();
    expect(buildAnimateToInjection('   ' as unknown as number, 1)).toBeNull();
    expect(buildAnimateToInjection(false as unknown as number, 1)).toBeNull();
  });

  it('still accepts a genuine zero coordinate', () => {
    // 0,0 is a real location; only the coerced-from-null case is rejected.
    expect(runAnimate(buildAnimateToInjection(0, 0)!).pan).toEqual({ lat: 0, lng: 0 });
  });

  it('ignores a non-finite zoom but still pans', () => {
    const calls = runAnimate(buildAnimateToInjection(1, 2, NaN)!);
    expect(calls.pan).toEqual({ lat: 1, lng: 2 });
    expect(calls.zoom).toBeUndefined();
  });

  it('is a no-op before the map exists', () => {
    expect(() => new Function('window', buildAnimateToInjection(1, 2)!)({})).not.toThrow();
  });

  it('coerces numeric strings rather than interpolating them', () => {
    const script = buildAnimateToInjection('37.7' as unknown as number, '-122.4' as unknown as number)!;
    expect(script).not.toContain("'37.7'");
    expect(runAnimate(script).pan).toEqual({ lat: 37.7, lng: -122.4 });
  });

  it('cannot be injected through coordinates', () => {
    const evil = '0});window.__pwned=1;({' as unknown as number;
    expect(buildAnimateToInjection(evil, 1)).toBeNull();
  });
});
