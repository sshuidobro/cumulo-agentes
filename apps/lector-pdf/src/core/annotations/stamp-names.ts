/**
 * `/Name` de los `/Stamp` ajenos (ISO 32000-1 §12.5.6.12). pdf.js no lo expone, así que se lee el diccionario
 * del objeto con el `ObjectReader` que ya usa el guardado. Solo se consultan los sellos ajenos.
 */
import type { ObjectReader } from '../pdf/object-reader';
import { dictGet, ref, type PdfValue } from '../pdf/objects';
import { parseRef, type ForeignAnnotation, type ImportedPage } from './import';

/** Prefijo de los ids de anotación ajena que pudieron leerse como referencia (`ref:<num>R[<gen>]`). */
const REF_PREFIX = 'ref:';

/** Valor de un `/Name`; `undefined` si el valor no es un nombre. */
function nameValue(v: PdfValue | undefined): string | undefined {
  return v !== null && typeof v === 'object' && 'kind' in v && v.kind === 'name' ? v.value : undefined;
}

/**
 * `/Name` de cada `/Stamp` ajeno, por id de anotación. Un `/Stamp` sin `/Name`, o cuyo objeto no se puede leer,
 * no aparece en el mapa. Nunca lanza.
 */
export async function readStampNames(
  reader: ObjectReader,
  foreign: readonly ForeignAnnotation[],
): Promise<ReadonlyMap<string, string>> {
  const names = new Map<string, string>();
  for (const a of foreign) {
    if (a.subtype !== 'Stamp' || !a.id.startsWith(REF_PREFIX)) continue;
    const r = parseRef(a.id.slice(REF_PREFIX.length));
    if (r === null) continue;
    try {
      const d = await reader.getDict(ref(r.num, r.gen));
      const name = d === null ? undefined : nameValue(dictGet(d, 'Name'));
      if (name !== undefined) names.set(a.id, name);
    } catch {
      // Objeto ilegible: la anotación sigue mostrándose como «Sello».
    }
  }
  return names;
}

/**
 * Copia de la página con `stampName` puesto en los ajenos que aparecen en `names`.
 * Sin coincidencias devuelve el mismo objeto.
 */
export function withStampNames(page: ImportedPage, names: ReadonlyMap<string, string>): ImportedPage {
  if (names.size === 0) return page;
  let changed = false;
  const foreign = page.foreign.map((a): ForeignAnnotation => {
    const stampName = names.get(a.id);
    if (stampName === undefined || a.stampName === stampName) return a;
    changed = true;
    return { ...a, stampName };
  });
  return changed ? { ...page, foreign } : page;
}
