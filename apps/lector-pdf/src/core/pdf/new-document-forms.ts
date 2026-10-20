/**
 * Formularios al copiar páginas a un PDF nuevo (PDF-123, ADR-0035 punto 4, ADR-0019). Por cada parte con
 * `/AcroForm`: los widgets copiados suben por `/Parent` hasta su campo raíz (`copyFieldRoots`, en `form-copy.ts`);
 * las firmas se copian sin `/V`. El `/AcroForm` del documento nuevo toma `/DA`, `/Q`, `/NeedAppearances` y `/DR` de
 * la primera parte con formulario; las fuentes de `/DR` de las demás partes se añaden con nombres libres.
 * `/SigFlags` y `/CO` no se copian.
 */
import { applyFieldEdits, copyFieldRoots, type FieldEdit } from './form-copy';
import type { ObjectCopier } from './object-copier';
import type { ObjectReader } from './object-reader';
import { dict, dictGet, type PdfDict, type PdfRef, type PdfValue } from './objects';

/** Entradas de `/AcroForm` que se copian de la primera parte con formulario (además de `/DR`, que va aparte). */
const SETTING_KEYS: readonly string[] = ['DA', 'Q', 'NeedAppearances'];

/**
 * Acumula el `/AcroForm` del documento nuevo a lo largo de las partes. Uso por parte: `addPart` (antes de volcar
 * los objetos del copiador), luego `applyEdits` con el mapa de objetos; al final, `acroForm()`.
 */
export class FormsBuilder {
  private hasForm = false;
  private settings: Record<string, PdfValue> = {};
  private drRest: Record<string, PdfValue> | null = null;
  private readonly fonts = new Map<string, PdfValue>();
  private readonly roots: PdfRef[] = [];
  private edits: FieldEdit[] = [];

  /** Copia los campos de las páginas `sourcePages` (índices del origen) de una parte con `/AcroForm`. */
  async addPart(reader: ObjectReader, copier: ObjectCopier, sourcePages: readonly number[]): Promise<void> {
    if (sourcePages.length === 0) return;
    const acro = await acroFormOf(reader);
    if (acro === null) return;
    const first = !this.hasForm;
    this.hasForm = true;

    if (first) {
      const settings = new Map([...acro.entries].filter(([key]) => SETTING_KEYS.includes(key)));
      this.settings = await copyEntries(settings, copier);
    }
    const dr = asDict(await reader.resolve(dictGet(acro, 'DR')));
    if (dr !== null) {
      if (first) {
        const rest = new Map([...dr.entries].filter(([key]) => key !== 'Font'));
        this.drRest = await copyEntries(rest, copier);
      }
      const font = asDict(await reader.resolve(dictGet(dr, 'Font')));
      if (font !== null) {
        for (const [key, value] of font.entries) this.fonts.set(this.freeFontName(key), await copier.copyDirect(value));
      }
    }

    const widgets = await widgetsOfPages(reader, sourcePages);
    this.roots.push(...(await copyFieldRoots(reader, copier, widgets.nums, this.edits)));
  }

  /** Aplica a `objects` (número → valor, ya volcados por el copiador) los cambios de los campos de las partes. */
  applyEdits(objects: Map<number, PdfValue>): void {
    applyFieldEdits(this.edits, objects);
    this.edits = [];
  }

  /** Raíces de campo copiadas de todas las partes, en orden. */
  fieldRoots(): readonly PdfRef[] {
    return this.roots.slice();
  }

  /** Fuentes de `/DR /Font` de las partes (nombres ya libres entre partes). */
  fontEntries(): ReadonlyMap<string, PdfValue> {
    return new Map(this.fonts);
  }

  /** El `/AcroForm` del documento nuevo, o `null` si ninguna parte tiene formulario. */
  acroForm(): PdfDict | null {
    if (!this.hasForm) return null;
    const entries: Record<string, PdfValue> = { ...this.settings, Fields: this.roots.slice() };
    if (this.drRest !== null || this.fonts.size > 0) {
      entries.DR = dict({ ...(this.drRest ?? {}), Font: dict(this.fonts) });
    }
    return dict(entries);
  }

  /** Nombre de fuente sin usar en `/DR /Font`: el propio si está libre, o `Nombre_2`, `Nombre_3`… */
  private freeFontName(key: string): string {
    if (!this.fonts.has(key)) return key;
    for (let n = 2; ; n++) {
      const candidate = `${key}_${n}`;
      if (!this.fonts.has(candidate)) return candidate;
    }
  }
}

/** `/AcroForm` del catálogo del origen, o `null` si no lo tiene. */
async function acroFormOf(reader: ObjectReader): Promise<PdfDict | null> {
  const catalog = asDict(await reader.resolve(dictGet(reader.xref.trailer, 'Root')));
  if (catalog === null) return null;
  return asDict(await reader.resolve(dictGet(catalog, 'AcroForm')));
}

/** Widgets (`/Subtype /Widget`) de las páginas copiadas: números de origen y referencias en orden de aparición. */
export async function widgetsOfPages(
  reader: ObjectReader,
  sourcePages: readonly number[],
): Promise<{ readonly nums: ReadonlySet<number>; readonly ordered: readonly PdfRef[] }> {
  const nums = new Set<number>();
  const ordered: PdfRef[] = [];
  for (const index of sourcePages) {
    const page = await reader.getDict(await reader.pageRef(index));
    if (page === null) continue;
    const annots = await reader.resolve(dictGet(page, 'Annots'));
    if (!Array.isArray(annots)) continue;
    for (const item of annots) {
      if (!isRef(item) || nums.has(item.num)) continue;
      const annot = await reader.getDict(item);
      if (annot === null) continue;
      const subtype = dictGet(annot, 'Subtype');
      if (!isName(subtype) || subtype.value !== 'Widget') continue;
      nums.add(item.num);
      ordered.push(item);
    }
  }
  return { nums, ordered };
}

/** Copia cada valor con el copiador (sus referencias se copian con él). */
async function copyEntries(entries: ReadonlyMap<string, PdfValue>, copier: ObjectCopier): Promise<Record<string, PdfValue>> {
  const out: Record<string, PdfValue> = {};
  for (const [key, value] of entries) out[key] = await copier.copyDirect(value);
  return out;
}

function isRef(v: PdfValue | undefined): v is PdfRef {
  return typeof v === 'object' && v !== null && !Array.isArray(v) && 'kind' in v && v.kind === 'ref';
}

function isDict(v: PdfValue | undefined): v is PdfDict {
  return typeof v === 'object' && v !== null && !Array.isArray(v) && 'kind' in v && v.kind === 'dict';
}

function isName(v: PdfValue | undefined): v is { readonly kind: 'name'; readonly value: string } {
  return typeof v === 'object' && v !== null && !Array.isArray(v) && 'kind' in v && v.kind === 'name';
}

function asDict(v: PdfValue | undefined): PdfDict | null {
  return isDict(v) ? v : null;
}
