/**
 * Contenido de página compartido (ADR-0036): recursos efectivos, nombres libres y envoltura del contenido
 * existente. Lo usan el aplanado de anotaciones (PDF-059), el OCR (PDF-061) y la redacción (PDF-135).
 * Sin E/S salvo `effectiveResources`, que lee del fichero a través de `ObjectReader`.
 */
import type { ObjectReader } from './object-reader';
import { flateEncode } from './filters';
import { dict, dictGet, name, stream, withEntries, type PdfDict, type PdfRef, type PdfStream, type PdfValue } from './objects';

/** Profundidad máxima de `/Parent` al buscar `/Resources` heredados. */
const MAX_ANCESTORS = 64;
/** Categorías de recursos que usan los escritores de contenido. */
export type ResourceCategory = 'XObject' | 'Font';

const TEXT_ENCODER = new TextEncoder();

/**
 * `/Resources` efectivos de la página como diccionario directo: el propio o el heredado (máx. 64 niveles), con sus
 * subdiccionarios `/Font` y `/XObject` resueltos a directos. Sin recursos → dict vacío.
 */
export async function effectiveResources(reader: ObjectReader, page: PdfDict): Promise<PdfDict> {
  const resolved = await reader.resolve(await inheritedResources(reader, page));
  if (!isDict(resolved)) return dict({});
  const changes: Record<string, PdfValue> = {};
  for (const key of ['Font', 'XObject'] as const) {
    const sub = await reader.resolve(dictGet(resolved, key));
    if (isDict(sub)) changes[key] = sub;
  }
  return withEntries(resolved, changes);
}

/** Primer nombre libre en la categoría: `base`, `base1`, `base2`… */
export function freeResourceName(resources: PdfDict, category: ResourceCategory, base: string): string {
  const used = categoryEntries(resources, category);
  if (!used.has(base)) return base;
  for (let i = 1; ; i += 1) {
    const candidate = `${base}${String(i)}`;
    if (!used.has(candidate)) return candidate;
  }
}

/** Recursos con `resName` añadido en `category` (los demás nombres no cambian). */
export function withResource(resources: PdfDict, category: ResourceCategory, resName: string, value: PdfRef): PdfDict {
  const entries = new Map<string, PdfValue>(categoryEntries(resources, category));
  entries.set(resName, value);
  return withEntries(resources, { [category]: dict(entries) });
}

/** Flujos para envolver el contenido existente: `open` = «q\n»; `close` = «Q\n» + `ops` (Flate). */
export function wrapStreams(ops: string): { readonly open: PdfStream; readonly close: PdfStream } {
  return {
    open: stream({}, TEXT_ENCODER.encode('q\n')),
    close: stream({ Filter: name('FlateDecode') }, flateEncode(TEXT_ENCODER.encode(`Q\n${ops}`))),
  };
}

/** `/Contents` nuevo: [open, …contenidos originales (directo, ref o array), close]. */
export function wrappedContents(page: PdfDict, open: PdfRef, close: PdfRef): readonly PdfValue[] {
  const original = dictGet(page, 'Contents');
  let middle: readonly PdfValue[] = [];
  if (isArray(original)) middle = original;
  else if (original !== undefined && original !== null) middle = [original];
  return [open, ...middle, close];
}

async function inheritedResources(reader: ObjectReader, page: PdfDict): Promise<PdfValue | undefined> {
  let node: PdfDict | null = page;
  for (let depth = 0; node !== null && depth < MAX_ANCESTORS; depth += 1) {
    const value = dictGet(node, 'Resources');
    if (value !== undefined && value !== null) return value;
    const parent = dictGet(node, 'Parent');
    node = isRef(parent) ? await reader.getDict(parent) : null;
  }
  return undefined;
}

function categoryEntries(resources: PdfDict, category: ResourceCategory): ReadonlyMap<string, PdfValue> {
  const sub = dictGet(resources, category);
  return isDict(sub) ? sub.entries : new Map<string, PdfValue>();
}

function isDict(v: PdfValue | undefined): v is PdfDict {
  return typeof v === 'object' && v !== null && !Array.isArray(v) && 'kind' in v && v.kind === 'dict';
}

function isRef(v: PdfValue | undefined): v is PdfRef {
  return typeof v === 'object' && v !== null && !Array.isArray(v) && 'kind' in v && v.kind === 'ref';
}

function isArray(v: PdfValue | undefined): v is readonly PdfValue[] {
  return Array.isArray(v);
}
