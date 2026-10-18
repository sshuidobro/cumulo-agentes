import type { NoteAnnotation, RectPt, Rgb } from './model';

/** Lado del icono de nota, en puntos PDF (igual que la apariencia de PDF-027). */
export const NOTE_SIZE_PT = 20;

/**
 * Rectángulo de una nota de `NOTE_SIZE_PT` × `NOTE_SIZE_PT` cuya esquina superior izquierda es (x, y), en puntos PDF.
 * Se desplaza hacia dentro si el punto cae cerca del borde de la página (`bounds`, en puntos PDF).
 */
export function noteRectAt(x: number, y: number, bounds: RectPt): RectPt {
  const [bx1, by1, bx2, by2] = bounds;
  const x1 = clamp(x, bx1, bx2 - NOTE_SIZE_PT);
  const top = clamp(y, by1 + NOTE_SIZE_PT, by2);
  return [x1, top - NOTE_SIZE_PT, x1 + NOTE_SIZE_PT, top];
}

/** Distancia del icono de una nota colocada con teclado a los bordes izquierdo y superior de lo visible, en pt. */
export const NOTE_KEYBOARD_INSET_PT = 24;

/**
 * Rectángulo de una nota colocada con teclado: centrada a INSET + NOTE_SIZE_PT/2 pt del borde izquierdo de la
 * vista y del borde superior visible (`yFraction` de la página). `widthPt`/`heightPt` sin girar; `rotation` total
 * de la vista (página + visor), 0/90/180/270.
 */
export function keyboardNoteRect(widthPt: number, heightPt: number, rotation: number, yFraction: number): RectPt {
  const r = ((rotation % 360) + 360) % 360;
  const c = NOTE_KEYBOARD_INSET_PT + NOTE_SIZE_PT / 2;
  const viewH = r === 90 || r === 270 ? widthPt : heightPt;
  // Punto en la vista, en pt desde arriba-izquierda.
  const vx = c;
  const vy = yFraction * viewH + c;
  let x: number;
  let y: number;
  switch (r) {
    case 90:
      x = vy;
      y = vx;
      break;
    case 180:
      x = widthPt - vx;
      y = vy;
      break;
    case 270:
      x = widthPt - vy;
      y = heightPt - vx;
      break;
    default:
      x = vx;
      y = heightPt - vy;
  }
  return noteRectAt(x - NOTE_SIZE_PT / 2, y + NOTE_SIZE_PT / 2, [0, 0, widthPt, heightPt]);
}

export interface NewNoteInput {
  readonly id: string;
  readonly pageIndex: number;
  readonly rect: RectPt;
  readonly color: Rgb;
  readonly author: string;
  /** Instante de creación en ISO 8601. */
  readonly now: string;
}

/** Nota nueva sin texto: icono «Comentario», cerrada, opacidad plena. */
export function newNoteAnnotation(input: NewNoteInput): NoteAnnotation {
  return {
    id: input.id,
    type: 'note',
    pageIndex: input.pageIndex,
    rect: input.rect,
    icon: 'Comment',
    open: false,
    color: input.color,
    opacity: 1,
    contents: '',
    author: input.author,
    modified: input.now,
    created: input.now,
    origin: { kind: 'new' },
  };
}

function clamp(value: number, min: number, max: number): number {
  if (max < min) return min;
  return Math.min(Math.max(value, min), max);
}
