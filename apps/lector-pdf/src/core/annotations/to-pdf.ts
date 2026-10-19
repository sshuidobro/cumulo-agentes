/**
 * Modelo de anotación → diccionario PDF (ISO 32000-1 §12.5). Funciones puras: no escriben bytes ni
 * conocen números de objeto; el que escribe (`core/pdf/incremental.ts`) asigna las referencias.
 */
import { decodeTextString, encodeTextString, pdfDate } from '../pdf/text-string';
import {
  bytesString,
  dict,
  dictGet,
  name,
  withEntries,
  type PdfDict,
  type PdfRef,
  type PdfString,
  type PdfValue,
} from '../pdf/objects';
import { serializeValue } from '../pdf/serialize';
import type {
  Annotation,
  BoxShapeAnnotation,
  LineShapeAnnotation,
  PolygonAnnotation,
  RectPt,
  Rgb,
} from './model';

/** Bit 3 de `/F` (print, ISO 32000 §12.5.3): la anotación se imprime. */
const FLAG_PRINT = 4;
/** Popup oculto (`/F 28` = print + no zoom + no rotate): lo abre el usuario desde la nota. */
const POPUP_FLAGS = 28;
const POPUP_HEIGHT = 100;
const POPUP_WIDTH = 200;
/** Ancho de la línea de los dibujos y del texto libre, en puntos. */
const FREETEXT_BORDER = 1;

const TEXT_ENCODER = new TextEncoder();
const TEXT_DECODER = new TextDecoder();

/** `/Name` de los `/Stamp` que son firmas de la suite: así se distinguen de los sellos de otros programas. */
export const SIGNATURE_STAMP_NAME = 'SuiteFirma';

const SUBTYPES: Readonly<Record<Annotation['type'], string>> = {
  highlight: 'Highlight',
  underline: 'Underline',
  strikeout: 'StrikeOut',
  note: 'Text',
  freetext: 'FreeText',
  ink: 'Ink',
  signature: 'Stamp',
  square: 'Square',
  circle: 'Circle',
  line: 'Line',
  polygon: 'Polygon',
  stamp: 'Stamp',
};

export interface AnnotationDictOptions {
  /** Página a la que pertenece (`/P`). */
  readonly pageRef: PdfRef;
  /** Forma de apariencia normal (`/AP /N`). */
  readonly apRef: PdfRef;
  /** Popup de una nota; `null` para el resto. */
  readonly popupRef: PdfRef | null;
  /** ISO 8601: fecha de modificación (`/M`). */
  readonly now: string;
}

export interface UpdatedDictOptions {
  readonly apRef: PdfRef;
  readonly now: string;
}

/** Número PDF con la misma serialización que el resto del escritor. */
function numText(n: number): string {
  return TEXT_DECODER.decode(serializeValue(n));
}

function rectArray(r: RectPt): readonly number[] {
  return [...r];
}

function rgbArray(c: Rgb): readonly number[] {
  return [...c];
}

/** Diccionario `/Annot` nuevo de la anotación `a`. */
export function annotationDict(a: Annotation, o: AnnotationDictOptions): PdfDict {
  const entries: Record<string, PdfValue> = {
    Type: name('Annot'),
    Subtype: name(SUBTYPES[a.type]),
    Rect: rectArray(a.rect),
    Contents: encodeTextString(a.contents),
    T: encodeTextString(a.author),
    NM: encodeTextString(a.id),
    M: pdfDate(o.now),
    CreationDate: pdfDate(a.created ?? o.now),
    P: o.pageRef,
    F: FLAG_PRINT,
    C: rgbArray(a.color),
    CA: a.opacity,
    AP: dict({ N: o.apRef }),
  };
  for (const [key, value] of Object.entries(typeEntries(a))) {
    if (value !== undefined) entries[key] = value;
  }
  if (o.popupRef !== null) entries.Popup = o.popupRef;
  return dict(entries);
}

/** Popup de una nota: caja de 200 × 100 pt a la derecha de la nota, hija de ella (`/Parent`). */
export function popupDict(parentRef: PdfRef, noteRect: RectPt, open: boolean): PdfDict {
  const [, , x2, y2] = noteRect;
  return dict({
    Type: name('Annot'),
    Subtype: name('Popup'),
    Rect: [x2, y2 - POPUP_HEIGHT, x2 + POPUP_WIDTH, y2],
    Parent: parentRef,
    Open: open,
    F: POPUP_FLAGS,
  });
}

/**
 * Diccionario de una anotación ya existente con los cambios de `a`. Conserva el resto de claves
 * (`/P`, `/Popup`, `/IRT`, `/RC`, claves privadas…). Si cambia el texto, quita `/RC` (texto enriquecido),
 * que si no seguiría mostrando el texto viejo.
 */
export function updatedDict(original: PdfDict, a: Annotation, o: UpdatedDictOptions): PdfDict {
  const updated = withEntries(original, {
    Rect: rectArray(a.rect),
    Contents: encodeTextString(a.contents),
    M: pdfDate(o.now),
    C: rgbArray(a.color),
    CA: a.opacity,
    AP: dict({ N: o.apRef }),
    ...typeEntries(a),
  });
  const previous = dictGet(original, 'Contents');
  const sameText = isPdfString(previous) && decodeTextString(previous) === a.contents;
  return sameText ? updated : withEntries(updated, { RC: undefined });
}

function isPdfString(v: PdfValue | undefined): v is PdfString {
  return typeof v === 'object' && v !== null && !Array.isArray(v) && 'kind' in v && v.kind === 'string';
}

/**
 * Claves propias de cada tipo (sin `/Popup`, que pertenece a la nota y se gestiona aparte). Un valor `undefined`
 * quita la clave (en `updatedDict`) o no la pone (en `annotationDict`).
 */
function typeEntries(a: Annotation): Record<string, PdfValue | undefined> {
  switch (a.type) {
    case 'highlight':
    case 'underline':
    case 'strikeout':
      return { QuadPoints: a.quads.flatMap((q) => [...q]) };
    case 'note':
      return { Name: name(a.icon), Open: a.open };
    case 'freetext': {
      const da = `/Helv ${numText(a.fontSize)} Tf ${a.textColor.map(numText).join(' ')} rg`;
      return { DA: bytesString(TEXT_ENCODER.encode(da)), Q: 0, BS: dict({ W: FREETEXT_BORDER }) };
    }
    case 'ink':
      return { InkList: a.paths.map((p) => [...p]), BS: dict({ W: a.width }) };
    case 'signature':
      return { Name: name(SIGNATURE_STAMP_NAME) };
    case 'square':
    case 'circle':
      return shapeEntries(a);
    case 'line':
      return {
        ...shapeEntries(a),
        L: [...a.points],
        LE: [name(a.endings[0]), name(a.endings[1])],
        IT: a.endings.some((e) => e !== 'None') ? name('LineArrow') : undefined,
      };
    case 'polygon':
      return { ...shapeEntries(a), Vertices: [...a.vertices] };
    case 'stamp':
      return { Name: name(a.name) };
  }
}

/**
 * Borde y relleno de una forma: `/BS` con el grosor y trazo continuo; `/IC` solo con relleno. Se quitan `/RD`
 * y `/BE` (rectángulo de diferencias y efecto nube), que solo tienen sentido en las formas del fichero.
 */
function shapeEntries(a: BoxShapeAnnotation | LineShapeAnnotation | PolygonAnnotation): Record<string, PdfValue | undefined> {
  return {
    BS: dict({ W: a.width, S: name('S') }),
    IC: a.interior === null ? undefined : rgbArray(a.interior),
    RD: undefined,
    BE: undefined,
  };
}
