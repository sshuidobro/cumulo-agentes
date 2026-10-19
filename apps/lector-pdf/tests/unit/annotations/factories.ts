import type { Annotation, AnnotationType, PdfObjRef } from '../../../src/core/annotations';

export const T0 = '2026-10-17T12:00:00.000Z';

export function fileRef(num: number, gen = 0): PdfObjRef {
  return { num, gen };
}

/** Anotación nueva de tipo dado, en la página `pageIndex`. */
export function newAnnotation(id: string, type: AnnotationType = 'highlight', pageIndex = 0): Annotation {
  const base = {
    id,
    pageIndex,
    rect: [10, 20, 110, 40] as const,
    color: [1, 1, 0] as const,
    opacity: 1,
    contents: '',
    author: 'Ana',
    modified: T0,
    created: T0,
    origin: { kind: 'new' } as const,
  };
  const quads = [[10, 40, 110, 40, 10, 20, 110, 20]] as const;
  switch (type) {
    case 'highlight':
    case 'underline':
    case 'strikeout':
      return { ...base, type, quads };
    case 'note':
      return { ...base, type, icon: 'Note', open: false };
    case 'freetext':
      return { ...base, type, fontSize: 12, textColor: [0, 0, 0] };
    case 'ink':
      return { ...base, type, paths: [[10, 20, 30, 40, 50, 20]], width: 2 };
    case 'signature':
      return { ...base, type, art: { kind: 'ink', paths: [[0, 0, 50, 25]], width: 2, box: [100, 50] } };
    case 'square':
    case 'circle':
      return { ...base, type, width: 2, interior: null };
    case 'line':
      return { ...base, type, points: [10, 20, 110, 40], width: 2, endings: ['None', 'OpenArrow'], interior: null };
    case 'polygon':
      return { ...base, type, vertices: [10, 20, 110, 20, 60, 50], width: 2, interior: null };
    case 'stamp':
      return { ...base, type, name: 'Draft' };
    case 'reply':
      return { ...base, type, parentId: 'suite-padre' };
    case 'review':
      return { ...base, type, parentId: 'suite-padre', state: 'Accepted' };
  }
}

/** Anotación del fichero con `ref` (id `ref:<num>R`). */
export function fileAnnotation(num: number, type: AnnotationType = 'underline', pageIndex = 0): Annotation {
  const ref = fileRef(num);
  const a = newAnnotation(`ref:${num}R`, type, pageIndex);
  return { ...a, origin: { kind: 'file', ref, popupRef: null } };
}
