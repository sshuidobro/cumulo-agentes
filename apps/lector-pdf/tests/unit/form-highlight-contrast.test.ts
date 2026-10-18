import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { NIGHT_PAGE_COLORS } from '../../src/core/night.ts';

/** PDF-041: el resaltado de campos no debe volver ilegible el texto de la página en modo noche (WCAG AA, 4,5:1). */

type Rgb = readonly [number, number, number];

function luminance([r, g, b]: Rgb): number {
  const f = (v: number): number => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}

function contrast(a: Rgb, b: Rgb): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

function hex(value: string): Rgb {
  return [1, 3, 5].map((i) => parseInt(value.slice(i, i + 2), 16)) as unknown as Rgb;
}

function overlay(fg: Rgb, alpha: number, bg: Rgb): Rgb {
  const mix = (i: 0 | 1 | 2): number => alpha * fg[i] + (1 - alpha) * bg[i];
  return [mix(0), mix(1), mix(2)];
}

describe('contraste del resaltado de campos en modo noche', () => {
  it('el texto de la página sigue legible bajo el resaltado (>= 4,5:1)', () => {
    const css = readFileSync(new URL('../../src/ui/viewer/FormLayer.module.css', import.meta.url), 'utf8');
    const rule = /\.night\.highlight\s*\{[^}]*background:\s*rgb\(\s*(\d+)\s+(\d+)\s+(\d+)\s*\/\s*(\d+)%\s*\)/.exec(css);
    expect(rule, 'falta una regla .night.highlight con background rgb(r g b / a%)').not.toBeNull();
    const [, red = '', green = '', blue = '', percent = ''] = rule ?? [];
    const color: Rgb = [Number(red), Number(green), Number(blue)];
    const shown = overlay(color, Number(percent) / 100, hex(NIGHT_PAGE_COLORS.background));
    expect(contrast(shown, hex(NIGHT_PAGE_COLORS.foreground))).toBeGreaterThanOrEqual(4.5);
  });
});
