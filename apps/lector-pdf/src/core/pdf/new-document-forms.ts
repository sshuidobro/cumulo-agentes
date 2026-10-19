/**
 * Formularios al copiar páginas a un PDF nuevo (PDF-123, ADR-0035 punto 4, ADR-0019). Por cada parte con
 * `/AcroForm`: los widgets copiados suben por `/Parent` hasta su campo raíz; los `/Kids` que no se copiaron se
 * quitan (y un campo sin hijos útiles, también); las firmas se copian sin `/V`. El `/AcroForm` del documento nuevo
 * toma `/DA`, `/Q`, `/NeedAppearances` y `/DR` de la primera parte con formulario; las fuentes de `/DR` de las
 * demás partes se añaden con nombres libres. `/SigFlags` y `/CO` no se copian.
 */
import type { ObjectCopier } from './object-copier';
import type { ObjectReader } from './object-reader';
import { dict, dictGet, withEntries, type PdfDict, type PdfName, type PdfRef, type PdfValue } from './objects';

/** Profundidad máxima de `/Parent` y de `/Kids` al recorrer campos (ISO 32000-1 §12.7.3.1). */
const MAX_FIELD_DEPTH = 32;
/** Entradas de `/AcroForm` que se copian de la primera parte con formulario (además de `/DR`, que va aparte). */
const SETTING_KEYS: readonly string[] = ['DA', 'Q', 'NeedAppearances'];

/** Cambio sobre un objeto ya copiado (su número en el documento nuevo). */
type Edit =
  /** `/Kids` directo en el diccionario del campo. */
  | { readonly kind: 'kids'; readonly num: number; readonly kids: readonly PdfValue[] }
  /** `/Kids` indirecto: el objeto `num` es el propio array. */
  | { readonly kind: 'kids-array'; readonly num: number; readonly kids: readonly PdfValue[] }
  /** Firma sin firmar: se quita `/V` del diccionario del campo. */
  | { readonly kind: 'no-value'; readonly num: number };

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
  private edits: Edit[] = [];

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
    const walk = new FieldWalk(reader, copier, widgets.nums);
    for (const root of await rootsOf(reader, widgets.ordered)) {
      const copiedRoot = await copier.copyDirect(root);
      if (isRef(copiedRoot) && (await walk.keep(root, 0))) this.roots.push(copiedRoot);
    }
    this.edits.push(...walk.edits);
  }

  /** Aplica a `objects` (número → valor, ya volcados por el copiador) los cambios de los campos de las partes. */
  applyEdits(objects: Map<number, PdfValue>): void {
    for (const edit of this.edits) {
      const current = objects.get(edit.num);
      if (current === undefined) throw new RangeError(`objeto ${edit.num} sin contenido (bug)`);
      if (edit.kind === 'kids-array') {
        objects.set(edit.num, edit.kids);
        continue;
      }
      if (!isDict(current)) throw new RangeError(`campo ${edit.num} no es un diccionario (bug)`);
      objects.set(edit.num, withEntries(current, edit.kind === 'kids' ? { Kids: edit.kids } : { V: undefined }));
    }
    this.edits = [];
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

/**
 * Recorre los campos de una parte. Un campo se conserva si es un widget copiado o si tiene algún hijo conservado.
 * Las decisiones se memorizan: cada nodo se decide una sola vez (también en ciclos, que se cortan como «no»).
 */
class FieldWalk {
  readonly edits: Edit[] = [];
  private readonly decided = new Map<number, boolean>();

  constructor(
    private readonly reader: ObjectReader,
    private readonly copier: ObjectCopier,
    /** Números de origen de los widgets que están en las páginas copiadas. */
    private readonly widgets: ReadonlySet<number>,
  ) {}

  /** `true` si el campo (origen) se conserva; deja en `edits` lo que hay que reescribir. */
  async keep(field: PdfRef, depth: number): Promise<boolean> {
    const known = this.decided.get(field.num);
    if (known !== undefined) return known;
    this.decided.set(field.num, false);
    const result = await this.decide(field, depth);
    this.decided.set(field.num, result);
    return result;
  }

  private async decide(field: PdfRef, depth: number): Promise<boolean> {
    const target = this.copier.mapped(field.num);
    if (target === undefined) return false;
    if (this.widgets.has(field.num)) {
      if (await this.isSignature(field)) this.edits.push({ kind: 'no-value', num: target.num });
      return true;
    }
    if (depth >= MAX_FIELD_DEPTH) return false;

    const node = await this.reader.getDict(field);
    if (node === null) return false;
    const kidsRaw = dictGet(node, 'Kids');
    const kids = await this.reader.resolve(kidsRaw);
    if (!Array.isArray(kids)) return false;

    const usable: PdfRef[] = [];
    for (const kid of kids) {
      if (!isRef(kid)) continue;
      const copiedKid = this.copier.mapped(kid.num);
      if (copiedKid !== undefined && (await this.keep(kid, depth + 1))) usable.push(copiedKid);
    }
    if (usable.length === 0) return false;

    if (usable.length !== kids.length) {
      if (isRef(kidsRaw)) {
        const arrayNum = this.copier.mapped(kidsRaw.num);
        if (arrayNum === undefined) throw new RangeError(`/Kids ${kidsRaw.num} sin copiar (bug)`);
        this.edits.push({ kind: 'kids-array', num: arrayNum.num, kids: usable });
      } else {
        this.edits.push({ kind: 'kids', num: target.num, kids: usable });
      }
    }
    if (await this.isSignature(field)) this.edits.push({ kind: 'no-value', num: target.num });
    return true;
  }

  /** Tipo de campo heredado (`/FT` puede estar en un antecesor): `true` si es `/Sig`. */
  private async isSignature(field: PdfRef): Promise<boolean> {
    let current: PdfRef | undefined = field;
    for (let level = 0; current !== undefined && level <= MAX_FIELD_DEPTH; level++) {
      const node = await this.reader.getDict(current);
      if (node === null) return false;
      const ft = await this.reader.resolve(dictGet(node, 'FT'));
      if (ft !== undefined) return isName(ft) && ft.value === 'Sig';
      const parent = dictGet(node, 'Parent');
      current = isRef(parent) ? parent : undefined;
    }
    return false;
  }
}

/** `/AcroForm` del catálogo del origen, o `null` si no lo tiene. */
async function acroFormOf(reader: ObjectReader): Promise<PdfDict | null> {
  const catalog = asDict(await reader.resolve(dictGet(reader.xref.trailer, 'Root')));
  if (catalog === null) return null;
  return asDict(await reader.resolve(dictGet(catalog, 'AcroForm')));
}

/** Widgets (`/Subtype /Widget`) de las páginas copiadas: números de origen y referencias en orden de aparición. */
async function widgetsOfPages(
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

/** Campo raíz de cada widget (subiendo por `/Parent`, máximo 32 niveles), sin repetir, en orden de aparición. */
async function rootsOf(reader: ObjectReader, widgets: readonly PdfRef[]): Promise<PdfRef[]> {
  const seen = new Set<number>();
  const roots: PdfRef[] = [];
  for (const widget of widgets) {
    let current = widget;
    for (let level = 0; level < MAX_FIELD_DEPTH; level++) {
      const node = await reader.getDict(current);
      if (node === null) break;
      const parent = dictGet(node, 'Parent');
      if (!isRef(parent)) break;
      current = parent;
    }
    if (!seen.has(current.num)) {
      seen.add(current.num);
      roots.push(current);
    }
  }
  return roots;
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

function isName(v: PdfValue | undefined): v is PdfName {
  return typeof v === 'object' && v !== null && !Array.isArray(v) && 'kind' in v && v.kind === 'name';
}

function asDict(v: PdfValue | undefined): PdfDict | null {
  return isDict(v) ? v : null;
}
