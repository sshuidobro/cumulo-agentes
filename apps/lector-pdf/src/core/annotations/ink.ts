import { rectFromPaths, type InkAnnotation, type Rgb } from './model';

export interface NewInkInput {
  readonly id: string;
  readonly pageIndex: number;
  /** Trazos ya simplificados, en puntos PDF: cada uno es `[x0, y0, x1, y1, ...]`. */
  readonly paths: readonly (readonly number[])[];
  /** Grosor del trazo en puntos PDF. */
  readonly width: number;
  readonly color: Rgb;
  readonly author: string;
  /** Instante de creación en ISO 8601. */
  readonly now: string;
}

/** Dibujo a mano nuevo (PDF-035): la caja es la de los trazos, ampliada la mitad del grosor más 1 pt. */
export function newInkAnnotation(input: NewInkInput): InkAnnotation {
  return {
    id: input.id,
    type: 'ink',
    pageIndex: input.pageIndex,
    rect: rectFromPaths(input.paths, input.width / 2 + 1),
    paths: input.paths,
    width: input.width,
    color: input.color,
    opacity: 1,
    contents: '',
    author: input.author,
    modified: input.now,
    created: input.now,
    origin: { kind: 'new' },
  };
}
