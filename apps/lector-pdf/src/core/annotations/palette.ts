import type { Rgb } from './model';

export interface PaletteEntry {
  readonly id: string;
  readonly label: string;
  readonly rgb: Rgb;
}

/** Colores que ofrece la barra «Comentar». */
export const PALETTE: readonly PaletteEntry[] = [
  { id: 'yellow', label: 'amarillo', rgb: [1, 0.92, 0.23] },
  { id: 'green', label: 'verde', rgb: [0.4, 0.73, 0.42] },
  { id: 'blue', label: 'azul', rgb: [0.26, 0.65, 0.96] },
  { id: 'pink', label: 'rosa', rgb: [0.93, 0.25, 0.48] },
  { id: 'orange', label: 'naranja', rgb: [1, 0.65, 0.15] },
  { id: 'red', label: 'rojo', rgb: [0.9, 0.22, 0.21] },
];

const RED: Rgb = [0.9, 0.22, 0.21];
const BLUE: Rgb = [0.26, 0.65, 0.96];
const YELLOW: Rgb = [1, 0.92, 0.23];

/** Color por defecto de cada herramienta de anotación. */
export const DEFAULT_TOOL_COLORS = {
  highlight: YELLOW,
  underline: BLUE,
  strikeout: RED,
  note: YELLOW,
  freetext: RED,
  ink: RED,
} as const satisfies Record<string, Rgb>;

/** Grosores de trazo permitidos (pt). */
export const INK_WIDTHS = [1, 2, 4, 8] as const;
/** Tamaños de letra permitidos para texto libre (pt). */
export const FONT_SIZES = [8, 10, 12, 14, 18, 24] as const;

export const DEFAULT_INK_WIDTH = 2;
export const DEFAULT_FONT_SIZE = 12;
/** Autor de las anotaciones nuevas cuando el usuario no ha escrito ninguno. */
export const DEFAULT_AUTHOR = 'Usuario';
/** Longitud máxima del nombre del autor, en caracteres. */
export const MAX_AUTHOR_LENGTH = 80;

/** Color de la paleta con ese id, o `undefined`. */
export function paletteColor(id: string): PaletteEntry | undefined {
  return PALETTE.find((entry) => entry.id === id);
}
