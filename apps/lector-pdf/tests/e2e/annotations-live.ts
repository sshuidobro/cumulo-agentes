/**
 * Anotaciones «vivas» de un PDF: las referenciadas desde el `/Annots` de alguna página (qpdf, PDF-029).
 * Una actualización incremental deja en el fichero los objetos borrados; solo cuentan los referenciados.
 */
import { qpdfObjects, type QpdfObjects } from '../support/qpdf.ts';

/** Anotación referenciada desde una página. */
export interface LiveAnnotation {
  /** Referencia del objeto, `"<num> <gen> R"`. */
  readonly ref: string;
  /** Subtipo sin barra (`Highlight`, `Text`...). */
  readonly subtype: string;
}

function isDict(v: unknown): v is Readonly<Record<string, unknown>> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** Anotaciones que aparecen en el `/Annots` de alguna página del fichero. */
export function liveAnnotations(path: string): LiveAnnotation[] {
  return liveFrom(qpdfObjects(path));
}

function liveFrom(objects: QpdfObjects): LiveAnnotation[] {
  const out: LiveAnnotation[] = [];
  for (const object of Object.values(objects)) {
    const page = object.value;
    if (!isDict(page) || page['/Type'] !== '/Page') continue;
    const annots = resolveArray(page['/Annots'], objects);
    for (const item of annots) {
      if (typeof item !== 'string') continue;
      const target = objects[`obj:${item}`]?.value;
      if (!isDict(target) || target['/Type'] !== '/Annot') continue;
      const subtype = typeof target['/Subtype'] === 'string' ? target['/Subtype'].replace(/^\//, '') : '';
      out.push({ ref: item, subtype });
    }
  }
  return out;
}

/** Array de `/Annots`: directo, o indirecto (`N G R`, muy común en PDF de otros programas). */
function resolveArray(value: unknown, objects: QpdfObjects): unknown[] {
  if (Array.isArray(value)) return value;
  if (typeof value === 'string') {
    const target = objects[`obj:${value}`]?.value;
    if (Array.isArray(target)) return target;
  }
  return [];
}
