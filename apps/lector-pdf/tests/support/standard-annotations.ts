/**
 * Conjunto estándar de anotaciones de prueba (PDF-029): una de cada tipo del modelo, con geometría fija,
 * colores distintos, autor `Prueba` y contenidos con acentos y `€`. Todas nuevas (origen `new`) y con
 * fechas fijas, así que el resultado es determinista.
 */
import { quadFromRect, type Annotation, type AnnotationType, type RectPt, type Rgb } from '../../src/core/annotations';

/** Tipos del conjunto: los que la app escribe como anotaciones editables (sin la firma, PDF-085). */
type StandardType = Exclude<AnnotationType, 'signature' | 'square' | 'circle' | 'line' | 'polygon' | 'stamp'>;

export const STANDARD_AUTHOR = 'Prueba';
export const STANDARD_CONTENTS = 'Revisión: año, ñandú, café, ¿qué tal? 5 € ';
export const STANDARD_DATE = '2026-10-17T12:00:00.000Z';

/** Tipos del conjunto, en el orden en que se añaden. Cubren los seis subtipos que escribe la app. */
export const STANDARD_TYPES: readonly StandardType[] = ['highlight', 'underline', 'strikeout', 'note', 'freetext', 'ink'];

/** Id de una anotación del conjunto estándar. */
export function standardId(type: StandardType): string {
  return `suite-std-${type}`;
}

const RECTS: Readonly<Record<StandardType, RectPt>> = {
  highlight: [72, 700, 272, 720],
  underline: [72, 660, 272, 680],
  strikeout: [72, 620, 272, 640],
  note: [300, 700, 320, 720],
  freetext: [72, 540, 372, 580],
  ink: [72, 460, 200, 500],
};

const COLORS: Readonly<Record<StandardType, Rgb>> = {
  highlight: [1, 1, 0],
  underline: [0, 0, 1],
  strikeout: [1, 0, 0],
  note: [0, 0.5, 0],
  freetext: [0.5, 0, 0.5],
  ink: [0, 1, 1],
};

/** Las seis anotaciones del conjunto sobre la página `pageIndex` (0-based). */
export function standardAnnotations(pageIndex = 0): readonly Annotation[] {
  return STANDARD_TYPES.map((type) => standardAnnotation(type, pageIndex));
}

function standardAnnotation(type: StandardType, pageIndex: number): Annotation {
  const rect = RECTS[type];
  const base = {
    id: standardId(type),
    pageIndex,
    rect,
    color: COLORS[type],
    opacity: 1,
    contents: STANDARD_CONTENTS,
    author: STANDARD_AUTHOR,
    modified: STANDARD_DATE,
    created: STANDARD_DATE,
    origin: { kind: 'new' } as const,
  };
  switch (type) {
    case 'highlight':
    case 'underline':
    case 'strikeout':
      return { ...base, type, quads: [quadFromRect(rect)] };
    case 'note':
      return { ...base, type, icon: 'Comment', open: false };
    case 'freetext':
      return { ...base, type, fontSize: 12, textColor: [0, 0, 0] };
    case 'ink':
      return { ...base, type, paths: [[100, 470, 150, 490, 200, 470]], width: 2 };
  }
}
