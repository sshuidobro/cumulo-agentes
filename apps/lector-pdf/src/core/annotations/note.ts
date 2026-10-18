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
