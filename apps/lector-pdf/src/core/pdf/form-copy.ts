/**
 * Raíces de campo de los widgets copiados (PDF-055, PDF-123, ADR-0035 punto 4). Dado el conjunto de widgets que
 * han viajado con sus páginas, sube por `/Parent` hasta el campo raíz y copia esa raíz. Los `/Kids` que no se
 * copiaron se quitan (y un campo sin hijos útiles, también); las firmas se copian sin `/V`. Los cambios sobre
 * objetos ya copiados se devuelven en `edits` y los aplica `applyFieldEdits` cuando el copiador ya ha volcado sus
 * objetos (`drain`).
 */
import type { ObjectCopier } from './object-copier';
import type { ObjectReader } from './object-reader';
import { dictGet, ref, withEntries, type PdfDict, type PdfName, type PdfRef, type PdfValue } from './objects';

/** Profundidad máxima de `/Parent` y de `/Kids` al recorrer campos (ISO 32000-1 §12.7.3.1). */
const MAX_FIELD_DEPTH = 32;

/** Cambio sobre un objeto ya copiado (su número en el documento nuevo). */
export type FieldEdit =
  /** `/Kids` directo en el diccionario del campo. */
  | { readonly kind: 'kids'; readonly num: number; readonly kids: readonly PdfValue[] }
  /** `/Kids` indirecto: el objeto `num` es el propio array. */
  | { readonly kind: 'kids-array'; readonly num: number; readonly kids: readonly PdfValue[] }
  /** Firma sin firmar: se quita `/V` del diccionario del campo. */
  | { readonly kind: 'no-value'; readonly num: number };

/**
 * Copia las raíces de campo de los widgets `widgetSourceNums` (números de objeto de origen, en orden de aparición)
 * y devuelve sus referencias en el documento nuevo: solo las que conservan algún widget copiado. Los cambios sobre
 * `/Kids` y `/V` se añaden a `edits`. Debe llamarse después de copiar las páginas con `copier`.
 */
export async function copyFieldRoots(
  from: ObjectReader,
  copier: ObjectCopier,
  widgetSourceNums: ReadonlySet<number>,
  edits: FieldEdit[] = [],
): Promise<readonly PdfRef[]> {
  const walk = new FieldWalk(from, copier, widgetSourceNums, edits);
  const roots: PdfRef[] = [];
  const widgets = [...widgetSourceNums].map((num) => sourceRef(from, num));
  for (const root of await rootsOf(from, widgets)) {
    const copiedRoot = await copier.copyDirect(root);
    if (isRef(copiedRoot) && (await walk.keep(root, 0))) roots.push(copiedRoot);
  }
  return roots;
}

/** Aplica a `objects` (número → valor, ya volcados por el copiador) los cambios de `edits`. */
export function applyFieldEdits(edits: readonly FieldEdit[], objects: Map<number, PdfValue>): void {
  for (const edit of edits) {
    const current = objects.get(edit.num);
    if (current === undefined) throw new RangeError(`objeto ${edit.num} sin contenido (bug)`);
    if (edit.kind === 'kids-array') {
      objects.set(edit.num, edit.kids);
      continue;
    }
    if (!isDict(current)) throw new RangeError(`campo ${edit.num} no es un diccionario (bug)`);
    objects.set(edit.num, withEntries(current, edit.kind === 'kids' ? { Kids: edit.kids } : { V: undefined }));
  }
}

/**
 * Recorre los campos de una parte. Un campo se conserva si es un widget copiado o si tiene algún hijo conservado.
 * Las decisiones se memorizan: cada nodo se decide una sola vez (también en ciclos, que se cortan como «no»).
 */
class FieldWalk {
  private readonly decided = new Map<number, boolean>();

  constructor(
    private readonly reader: ObjectReader,
    private readonly copier: ObjectCopier,
    /** Números de origen de los widgets que están en las páginas copiadas. */
    private readonly widgets: ReadonlySet<number>,
    /** Destino de los cambios (compartido con quien llama). */
    private readonly edits: FieldEdit[],
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

/** Referencia de origen de un objeto por número: su generación según la tabla xref (el lector la exige). */
function sourceRef(from: ObjectReader, num: number): PdfRef {
  const entry = from.xref.entries.get(num);
  return ref(num, entry?.type === 'offset' ? entry.gen : 0);
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

function isRef(v: PdfValue | undefined): v is PdfRef {
  return typeof v === 'object' && v !== null && !Array.isArray(v) && 'kind' in v && v.kind === 'ref';
}

function isDict(v: PdfValue | undefined): v is PdfDict {
  return typeof v === 'object' && v !== null && !Array.isArray(v) && 'kind' in v && v.kind === 'dict';
}

function isName(v: PdfValue | undefined): v is PdfName {
  return typeof v === 'object' && v !== null && !Array.isArray(v) && 'kind' in v && v.kind === 'name';
}
