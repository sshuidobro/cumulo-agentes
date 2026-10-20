import { describe, expect, it } from 'vitest';
import { firstUnmappable } from '../../../src/core/annotations/winansi';
import { standardBaseFont, standardFontFor } from '../../../src/core/edit-text/standard-font';

const FIXED_PITCH = 1;
const SERIF = 2;
const ITALIC = 64;
const FORCE_BOLD = 262144;

describe('standardFontFor → standardBaseFont', () => {
  it.each([
    ['TimesNewRomanPS-BoldItalicMT', 0, 'Times-BoldItalic'],
    ['Arial-BoldMT', 0, 'Helvetica-Bold'],
    ['CourierNewPSMT', 0, 'Courier'],
    ['Calibri', 32, 'Helvetica'],
    ['Garamond', 0, 'Times-Roman'],
    ['MicrosoftSansSerif', 0, 'Helvetica'],
    ['LiberationSerif-Italic', 0, 'Times-Italic'],
    ['XYZ', SERIF, 'Times-Roman'],
    ['XYZ', FIXED_PITCH, 'Courier'],
    ['XYZ', ITALIC, 'Helvetica-Oblique'],
    ['XYZ', FORCE_BOLD, 'Helvetica-Bold'],
    ['Georgia-Bold', 0, 'Times-Bold'],
    ['Verdana-BoldItalic', 0, 'Helvetica-BoldOblique'],
    ['Consolas-Italic', 0, 'Courier-Oblique'],
    ['Palatino-Black', 0, 'Times-Bold'],
    ['Tahoma', ITALIC | FORCE_BOLD, 'Helvetica-BoldOblique'],
    ['Something-DEMIBOLD', 0, 'Helvetica-Bold'],
    ['Foo-Oblique', 0, 'Helvetica-Oblique'],
    ['XYZ', 0, 'Helvetica'],
  ])('%s con flags %i → %s', (baseFont, flags, expected) => {
    expect(standardBaseFont(standardFontFor(baseFont, flags))).toBe(expected);
  });

  it('el nombre se compara sin distinguir mayúsculas', () => {
    expect(standardFontFor('TIMES-BOLD', 0)).toEqual({ family: 'Times', bold: true, italic: false });
  });

  it('el modo fijo (FixedPitch) gana a un nombre sans', () => {
    expect(standardFontFor('Arial', FIXED_PITCH)).toEqual({ family: 'Courier', bold: false, italic: false });
  });
});

describe('firstUnmappable', () => {
  it('texto representable en WinAnsi → null', () => {
    expect(firstUnmappable('Ñandú € ¿?')).toBeNull();
    expect(firstUnmappable('')).toBeNull();
  });

  it('devuelve el primer carácter no representable, completo aunque sea un emoji', () => {
    expect(firstUnmappable('Hola 😀')).toBe('😀');
    expect(firstUnmappable('a\tb')).toBe('\t');
    expect(firstUnmappable('Ω')).toBe('Ω');
  });

  it('el signo de interrogación literal no cuenta como no representable', () => {
    expect(firstUnmappable('¿Qué?')).toBeNull();
  });
});
