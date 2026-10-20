/**
 * Elección de una de las 14 fuentes estándar (ISO 32000-1, §9.6.2.2) para reescribir texto editado. Solo mira el
 * nombre y los /Flags del descriptor: no lee la fuente original.
 */

export type FontFamily = 'Helvetica' | 'Times' | 'Courier';

export interface StandardFont {
  readonly family: FontFamily;
  readonly bold: boolean;
  readonly italic: boolean;
}

/** FixedPitch, Serif, Italic y ForceBold del /Flags del descriptor (ISO 32000-1, Tabla 123). */
const FLAG_FIXED_PITCH = 1;
const FLAG_SERIF = 2;
const FLAG_ITALIC = 64;
const FLAG_FORCE_BOLD = 262144;

const COURIER_NAME = /courier|mono|consol/i;
const SANS_NAME = /sans|arial|helvet|verdana|calibri|tahoma|segoe|roboto|open/i;
const SERIF_NAME = /times|serif|roman|georgia|garamond|cambria|palatino|minion|antiqua|baskerville|bookman/i;
const BOLD_NAME = /bold|black|heavy|semibold|demi/i;
const ITALIC_NAME = /italic|oblique/i;

/** Fuente estándar más parecida. `baseFont` ya sin prefijo de subconjunto; `flags` = /FontDescriptor /Flags (0 si no hay). */
export function standardFontFor(baseFont: string, flags: number): StandardFont {
  return {
    family: familyOf(baseFont, flags),
    bold: BOLD_NAME.test(baseFont) || (flags & FLAG_FORCE_BOLD) !== 0,
    italic: ITALIC_NAME.test(baseFont) || (flags & FLAG_ITALIC) !== 0,
  };
}

function familyOf(baseFont: string, flags: number): FontFamily {
  if ((flags & FLAG_FIXED_PITCH) !== 0 || COURIER_NAME.test(baseFont)) return 'Courier';
  if (SANS_NAME.test(baseFont)) return 'Helvetica';
  if (SERIF_NAME.test(baseFont) || (flags & FLAG_SERIF) !== 0) return 'Times';
  return 'Helvetica';
}

const BASE_FONT_NAMES: Readonly<Record<FontFamily, Readonly<Record<'plain' | 'bold' | 'italic' | 'boldItalic', string>>>> = {
  Helvetica: { plain: 'Helvetica', bold: 'Helvetica-Bold', italic: 'Helvetica-Oblique', boldItalic: 'Helvetica-BoldOblique' },
  Times: { plain: 'Times-Roman', bold: 'Times-Bold', italic: 'Times-Italic', boldItalic: 'Times-BoldItalic' },
  Courier: { plain: 'Courier', bold: 'Courier-Bold', italic: 'Courier-Oblique', boldItalic: 'Courier-BoldOblique' },
};

/** Nombre PostScript de las 14 estándar: Helvetica[-Bold|-Oblique|-BoldOblique], Times-Roman|-Bold|-Italic|-BoldItalic, Courier[-Bold|-Oblique|-BoldOblique]. */
export function standardBaseFont(font: StandardFont): string {
  const names = BASE_FONT_NAMES[font.family];
  if (font.bold && font.italic) return names.boldItalic;
  if (font.bold) return names.bold;
  if (font.italic) return names.italic;
  return names.plain;
}
