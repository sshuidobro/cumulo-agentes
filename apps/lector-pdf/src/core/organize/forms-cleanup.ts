/**
 * Limpieza de formularios al borrar páginas (PDF-119, ADR-0035). Los widgets de una página borrada dejan de
 * estar en la página, pero siguen en `/AcroForm /Fields` y en `/CO`: se quitan de ahí para que el visor no
 * liste campos huérfanos. Solo se escriben los objetos que cambian, en el incremento que recibe.
 */
import type { DeltaWriter } from '../pdf/delta-writer';
import type { ObjectReader } from '../pdf/object-reader';
import { dict, dictGet, PdfSyntaxError, withEntries, type PdfDict, type PdfRef, type PdfValue } from '../pdf/objects';

/** Profundidad máxima del árbol de campos (`/Kids`). Más allá, el nodo se conserva tal cual. */
const MAX_FIELD_DEPTH = 32;

/** Estado de una pasada: widgets y nodos a quitar, y nodos ya recorridos (cada uno una sola vez). */
interface Walk {
  readonly reader: ObjectReader;
  readonly writer: DeltaWriter;
  readonly widgets: ReadonlySet<number>;
  readonly dropped: Set<number>;
  readonly visited: Set<number>;
}

/**
 * Quita de `/AcroForm` (`/Fields` y `/CO`) los widgets de `removedPages` (refs de páginas que se borran) y
 * escribe los objetos que cambian en `writer`. Devuelve el número de widgets de esas páginas (0 si no hay
 * ninguno, y entonces no escribe nada). `catalog` es la ref del catálogo, para reescribirlo si `/AcroForm` es directo.
 */
export async function removePageWidgets(
  reader: ObjectReader,
  writer: DeltaWriter,
  removedPages: readonly PdfRef[],
  catalog: PdfRef,
): Promise<number> {
  return updateAcroForm(reader, writer, removedPages, catalog, null);
}

/** Lo que se añade al `/AcroForm` del documento de destino al insertar páginas con formulario (PDF-055). */
export interface AcroFormAdditions {
  /** Raíces de campo nuevas: se añaden al final de `/Fields`. */
  readonly fields: readonly PdfValue[];
  /** Fuentes de `/DR /Font` del importado: solo se añaden las que el destino no tiene con ese nombre. */
  readonly fonts: ReadonlyMap<string, PdfValue>;
  /** `/AcroForm` completo del importado para el documento que no tiene `/AcroForm`; `null` si no hace falta. */
  readonly whenMissing: PdfDict | null;
}

/**
 * Como `removePageWidgets`, y además añade `additions` al `/AcroForm` en el mismo incremento: campos al final de
 * `/Fields`, fuentes de `/DR /Font` que faltan, o (si no hay `/AcroForm`) el `whenMissing` en el catálogo. Con
 * `additions === null` se comporta exactamente como `removePageWidgets`. Devuelve los widgets de las páginas dadas.
 */
export async function updateAcroForm(
  reader: ObjectReader,
  writer: DeltaWriter,
  removedPages: readonly PdfRef[],
  catalog: PdfRef,
  additions: AcroFormAdditions | null,
): Promise<number> {
  const widgets = await widgetsOf(reader, removedPages);
  return removeWidgetRefs(reader, writer, widgets, catalog, additions);
}

/**
 * Quita de `/AcroForm` las referencias a los widgets `widgets` (nums de objeto) y, si `additions` no es `null`,
 * añade lo indicado en el mismo incremento. Lo usa la redacción (PDF-135) para los widgets de las páginas que
 * redacta. Devuelve `widgets.size`.
 */
export async function removeWidgetRefs(
  reader: ObjectReader,
  writer: DeltaWriter,
  widgets: ReadonlySet<number>,
  catalog: PdfRef,
  additions: AcroFormAdditions | null = null,
): Promise<number> {
  const extraFields = additions?.fields ?? [];
  const extraFonts = additions?.fonts ?? new Map<string, PdfValue>();
  if (widgets.size === 0 && additions === null) return 0;

  const catalogDict = await reader.getDict(catalog);
  if (catalogDict === null) throw unreadable('catálogo');
  const acroRaw = dictGet(catalogDict, 'AcroForm');
  const acro = await reader.resolve(acroRaw);
  if (!isDict(acro)) {
    if (additions?.whenMissing) writer.object(catalog.num, catalog.gen, withEntries(catalogDict, { AcroForm: additions.whenMissing }));
    return widgets.size;
  }

  const walk: Walk = { reader, writer, widgets, dropped: new Set(), visited: new Set() };
  const changes: Record<string, PdfValue | undefined> = {};

  const fieldsRaw = dictGet(acro, 'Fields');
  const fields = await reader.resolve(fieldsRaw);
  if (Array.isArray(fields) || extraFields.length > 0) {
    const current = Array.isArray(fields) ? fields : [];
    const pruned = await pruneList(walk, current, 0);
    if (pruned.changed || extraFields.length > 0) {
      const items = [...pruned.items, ...extraFields];
      if (isRef(fieldsRaw)) writer.object(fieldsRaw.num, fieldsRaw.gen, items);
      else changes.Fields = items;
    }
  }

  const coRaw = dictGet(acro, 'CO');
  const co = await reader.resolve(coRaw);
  if (Array.isArray(co)) {
    const pruned = await pruneList(walk, co, 0);
    if (pruned.changed) {
      if (isRef(coRaw)) writer.object(coRaw.num, coRaw.gen, pruned.items);
      else changes.CO = pruned.items;
    }
  }

  if (extraFonts.size > 0) {
    const drRaw = dictGet(acro, 'DR');
    const dr = asDict(await reader.resolve(drRaw)) ?? dict({});
    const fontRaw = dictGet(dr, 'Font');
    const font = asDict(await reader.resolve(fontRaw)) ?? dict({});
    const missing: Record<string, PdfValue> = {};
    for (const [key, value] of extraFonts) if (!font.entries.has(key)) missing[key] = value;
    if (Object.keys(missing).length > 0) {
      const newFont = withEntries(font, missing);
      if (isRef(fontRaw)) {
        writer.object(fontRaw.num, fontRaw.gen, newFont);
      } else {
        const newDr = withEntries(dr, { Font: newFont });
        if (isRef(drRaw)) writer.object(drRaw.num, drRaw.gen, newDr);
        else changes.DR = newDr;
      }
    }
  }

  if (Object.keys(changes).length > 0) {
    const newAcro = withEntries(acro, changes);
    if (isRef(acroRaw)) writer.object(acroRaw.num, acroRaw.gen, newAcro);
    else writer.object(catalog.num, catalog.gen, withEntries(catalogDict, { AcroForm: newAcro }));
  }
  return widgets.size;
}

function asDict(v: PdfValue | undefined): PdfDict | null {
  return isDict(v) ? v : null;
}

/** Refs de los widgets (`/Subtype /Widget`) que aparecen en `/Annots` de las páginas dadas. */
async function widgetsOf(reader: ObjectReader, pages: readonly PdfRef[]): Promise<ReadonlySet<number>> {
  const found = new Set<number>();
  for (const page of pages) {
    const dictionary = await reader.getDict(page);
    if (dictionary === null) continue;
    const annots = await reader.resolve(dictGet(dictionary, 'Annots'));
    if (!Array.isArray(annots)) continue;
    for (const item of annots) {
      if (!isRef(item)) continue;
      const annot = await reader.getDict(item);
      if (annot === null) continue;
      const subtype = dictGet(annot, 'Subtype');
      if (isName(subtype) && subtype.value === 'Widget') found.add(item.num);
    }
  }
  return found;
}

/**
 * Filtra una lista de campos o de `/CO`. Devuelve la lista sin las referencias quitadas y si cambió. Los
 * elementos que no son referencias se conservan tal cual.
 */
async function pruneList(
  walk: Walk,
  items: readonly PdfValue[],
  depth: number,
): Promise<{ readonly items: PdfValue[]; readonly changed: boolean }> {
  const kept: PdfValue[] = [];
  let changed = false;
  for (const item of items) {
    if (!isRef(item) || (await keepField(walk, item, depth))) kept.push(item);
    else changed = true;
  }
  return { items: kept, changed };
}

/**
 * Decide si el campo `field` se conserva. Un widget quitado o un nodo que se queda sin hijos no se conserva.
 * Un nodo con hijos que pierden algunos se reescribe (o se reescribe su `/Kids` si es un array indirecto).
 */
async function keepField(walk: Walk, field: PdfRef, depth: number): Promise<boolean> {
  const { reader, writer, widgets, dropped, visited } = walk;
  if (widgets.has(field.num) || dropped.has(field.num)) {
    dropped.add(field.num);
    return false;
  }
  if (visited.has(field.num)) return true;
  visited.add(field.num);
  if (depth >= MAX_FIELD_DEPTH) return true;

  const node = await reader.getDict(field);
  if (node === null) return true;
  const kidsRaw = dictGet(node, 'Kids');
  const kids = await reader.resolve(kidsRaw);
  if (!Array.isArray(kids)) return true;

  const pruned = await pruneList(walk, kids, depth + 1);
  if (!pruned.changed) return true;
  if (pruned.items.length === 0) {
    dropped.add(field.num);
    return false;
  }
  if (isRef(kidsRaw)) writer.object(kidsRaw.num, kidsRaw.gen, pruned.items);
  else writer.object(field.num, field.gen, withEntries(node, { Kids: pruned.items }));
  return true;
}

function unreadable(where: string): PdfSyntaxError {
  return new PdfSyntaxError(`estructura no legible: ${where}`, 0);
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
