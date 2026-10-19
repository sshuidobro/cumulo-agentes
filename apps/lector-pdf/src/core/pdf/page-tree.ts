/**
 * Reorganización de páginas por actualización incremental (PDF-052, ADR-0028). Dada la lista final de páginas
 * (orden y giro de cada una), escribe un incremento que reescribe el árbol `/Pages`: borrar, reordenar y girar
 * conservando anotaciones, enlaces, índice y cifrado. Solo se reescriben los objetos de página y los nodos
 * `/Pages` nuevos; el resto del fichero no se toca. Nunca lanza: los errores vuelven como `Result`.
 */
import type { ByteSource } from '@suite/platform';
import { err, ok, type Result } from '@suite/shared';
import { pdfError } from '../errors';
import type { RandomBytes } from './crypt-rules';
import { finishDelta, reserveXref, startDelta } from './delta-writer';
import { toSaveError } from './incremental';
import type { ObjectReader } from './object-reader';
import { dict, dictGet, name, PdfSyntaxError, ref, withEntries, type PdfDict, type PdfRef, type PdfValue } from './objects';

export type PageRotation = 0 | 90 | 180 | 270;

/** Una página del documento resultante. `source`: índice 0-based de la página en el fichero abierto. `rotate`: giro final absoluto. */
export interface PageSlot {
  readonly source: number;
  readonly rotate: PageRotation;
}

export interface PageTreeInput {
  readonly source: ByteSource;
  /** Abierto con `openForSave` sobre el mismo `source`. */
  readonly reader: ObjectReader;
  /** Orden final de las páginas. */
  readonly pages: readonly PageSlot[];
  /** ISO 8601 (semilla de `/ID`). */
  readonly now: string;
  readonly random?: RandomBytes;
  /** Abortada → `cancelled`. */
  readonly signal?: AbortSignal;
  /** Cada 1 000 páginas procesadas y al final (`done === total`). */
  readonly onProgress?: (done: number, total: number) => void;
}

export interface PageTreeOutput {
  /** Bytes a anexar al original; vacío si no hay cambios. */
  readonly delta: Uint8Array;
  /** Tamaño del fichero resultante: `source.size + delta.length`. */
  readonly expectedSize: number;
  /** Páginas escritas de nuevo. */
  readonly rewrittenPages: number;
}

/** Hijos por nodo `/Pages` (árbol equilibrado). */
export const PAGE_TREE_FANOUT = 32;
const VALID_ROTATIONS: readonly PageRotation[] = [0, 90, 180, 270];
const INHERITED_KEYS = ['Resources', 'MediaBox', 'CropBox'] as const;
const MAX_ANCESTORS = 64;
const PROGRESS_EVERY = 1000;

/** Giro efectivo de cada página (propio o heredado), en orden. Para que la UI sepa el estado inicial. */
export async function readPageRotations(reader: ObjectReader): Promise<Result<readonly PageRotation[]>> {
  try {
    const memo: AncestorMemo = new Map();
    const out: PageRotation[] = [];
    for await (const { dict } of eachPage(reader)) {
      const { rotation } = await rotationOf(reader, dict, await ancestorsOf(reader, dict, memo));
      out.push(rotation);
    }
    return ok(out);
  } catch (error: unknown) {
    return err(toSaveError(error));
  }
}

/**
 * Escribe la actualización que deja las páginas en el orden y con el giro de `pages`. Solo giros (mismo orden,
 * mismo número de páginas): reescribe solo las páginas cuyo giro cambia. En otro caso, reconstruye el árbol
 * `/Pages` con nodos de hasta 32 hijos y reescribe cada página conservada.
 */
export async function buildPageTreeUpdate(input: PageTreeInput): Promise<Result<PageTreeOutput>> {
  try {
    return await writeUpdate(input);
  } catch (error: unknown) {
    return err(toSaveError(error));
  }
}

async function writeUpdate(input: PageTreeInput): Promise<Result<PageTreeOutput>> {
  const { reader, pages, signal } = input;
  const n = await reader.pageCount();
  if (!isValidList(pages, n)) return err(pdfError('organize-invalid'));
  if (signal?.aborted === true) return err(pdfError('cancelled'));

  const identity = pages.length === n && pages.every((slot, i) => slot.source === i);
  return identity ? writeRotationsOnly(input) : writeReordered(input, await reader.pageRefs());
}

/** `pages` no vacío, `source` entero sin repetir en [0, n) y `rotate` ∈ {0, 90, 180, 270}. */
function isValidList(pages: readonly PageSlot[], n: number): boolean {
  if (pages.length < 1) return false;
  const seen = new Set<number>();
  for (const slot of pages) {
    if (!Number.isInteger(slot.source) || slot.source < 0 || slot.source >= n || seen.has(slot.source)) return false;
    seen.add(slot.source);
    if (!VALID_ROTATIONS.includes(slot.rotate)) return false;
  }
  return true;
}

/** Solo giros: reescribe las páginas cuyo giro efectivo cambia. Sin cambios → delta vacío. */
async function writeRotationsOnly(input: PageTreeInput): Promise<Result<PageTreeOutput>> {
  const { source, reader, pages, signal, onProgress, now } = input;
  const writer = await startDelta(source, reader, input.random);
  const memo: AncestorMemo = new Map();
  let rewritten = 0;
  let index = 0;
  for await (const { ref: pageRef, dict: page } of eachPage(reader)) {
    if (signal?.aborted === true) return err(pdfError('cancelled'));
    if (index >= pages.length) throw unreadable('más páginas que /Count');
    const { rotation, own } = await rotationOf(reader, page, await ancestorsOf(reader, page, memo));
    const slot = itemAt(pages, index);
    if (rotation !== slot.rotate) {
      const changes = own ? { Rotate: slot.rotate === 0 ? undefined : slot.rotate } : { Rotate: slot.rotate };
      writer.object(pageRef.num, pageRef.gen, withEntries(page, changes));
      rewritten += 1;
    }
    index += 1;
    reportProgress(onProgress, index, pages.length);
  }
  if (index !== pages.length) throw unreadable('menos páginas que /Count');
  if (rewritten === 0) return ok({ delta: new Uint8Array(0), expectedSize: source.size, rewrittenPages: 0 });

  const root = await catalogRef(reader);
  const { xrefNum, size } = reserveXref(reader, reader.xref.size);
  const delta = finishDelta(writer, { reader, root, size, xrefNum, now, sourceSize: source.size });
  return ok({ delta, expectedSize: source.size + delta.length, rewrittenPages: rewritten });
}

/** Caso general: árbol nuevo bajo la raíz original y cada página conservada reescrita con su número. */
async function writeReordered(input: PageTreeInput, refs: readonly PdfRef[]): Promise<Result<PageTreeOutput>> {
  const { source, reader, pages, signal, onProgress, now } = input;
  const root = await catalogRef(reader);
  const rootPages = await rootPagesRef(reader, root);
  const tree = buildTree(pages.length);
  const memo: AncestorMemo = new Map();

  // BFS: de arriba abajo y de izquierda a derecha. Los nodos nuevos toman números desde `/Size` original.
  let nextNum = reader.xref.size;
  const nodes: NodeEntry[] = [{ node: tree, ref: rootPages, parent: null, kids: [] }];
  const parentOfSlot: PdfRef[] = [];
  for (let at = 0; at < nodes.length; at++) {
    const entry = itemAt(nodes, at);
    for (const kid of entry.node.kids) {
      if ('slot' in kid) {
        parentOfSlot[kid.slot] = entry.ref;
        entry.kids.push(refAt(refs, itemAt(pages, kid.slot).source));
      } else {
        const childRef = ref(nextNum++);
        entry.kids.push(childRef);
        nodes.push({ node: kid.node, ref: childRef, parent: entry.ref, kids: [] });
      }
    }
  }

  const writer = await startDelta(source, reader, input.random);
  for (const entry of nodes) {
    if (signal?.aborted === true) return err(pdfError('cancelled'));
    const d: Record<string, PdfValue> = { Type: name('Pages'), Kids: entry.kids, Count: entry.node.count };
    if (entry.parent !== null) d.Parent = entry.parent;
    writer.object(entry.ref.num, entry.ref.gen, dict(d));
  }

  for (const [i, slot] of pages.entries()) {
    if (signal?.aborted === true) return err(pdfError('cancelled'));
    const pageRef = refAt(refs, slot.source);
    const page = await pageDict(reader, pageRef);
    const ancestors = await ancestorsOf(reader, page, memo);
    const changes: Record<string, PdfValue | undefined> = {
      Parent: itemAt(parentOfSlot, i),
      Rotate: slot.rotate === 0 ? undefined : slot.rotate,
    };
    for (const key of INHERITED_KEYS) {
      if (dictGet(page, key) !== undefined) continue;
      const value = inheritedValue(ancestors, key);
      if (value !== undefined) changes[key] = value;
    }
    writer.object(pageRef.num, pageRef.gen, withEntries(page, changes));
    reportProgress(onProgress, i + 1, pages.length);
  }

  const { xrefNum, size } = reserveXref(reader, nextNum);
  const delta = finishDelta(writer, { reader, root, size, xrefNum, now, sourceSize: source.size });
  return ok({ delta, expectedSize: source.size + delta.length, rewrittenPages: pages.length });
}

/** Nodo del árbol nuevo. Los hijos son posiciones de `pages` (`slot`) o nodos (`node`). */
type TreeChild = { readonly slot: number } | { readonly node: TreeNode };
interface TreeNode {
  readonly kids: readonly TreeChild[];
  /** Número de páginas bajo este nodo. */
  readonly count: number;
}

interface NodeEntry {
  readonly node: TreeNode;
  readonly ref: PdfRef;
  readonly parent: PdfRef | null;
  /** Referencias de los hijos, en orden: páginas o nodos nuevos. */
  readonly kids: PdfRef[];
}

/** Árbol de abajo arriba: cada nivel agrupa de 32 en 32 hasta que cabe en la raíz. */
function buildTree(slotCount: number): TreeNode {
  let layer: readonly TreeChild[] = Array.from({ length: slotCount }, (_, slot) => ({ slot }));
  while (layer.length > PAGE_TREE_FANOUT) {
    const upper: TreeChild[] = [];
    for (let at = 0; at < layer.length; at += PAGE_TREE_FANOUT) {
      const kids = layer.slice(at, at + PAGE_TREE_FANOUT);
      upper.push({ node: { kids, count: kids.reduce((n, kid) => n + countOf(kid), 0) } });
    }
    layer = upper;
  }
  return { kids: layer, count: slotCount };
}

function countOf(child: TreeChild): number {
  return 'node' in child ? child.node.count : 1;
}

/** Referencia de la página `index` del fichero original. Fuera de rango es un bug de quien llama. */
function refAt(refs: readonly PdfRef[], index: number): PdfRef {
  return itemAt(refs, index);
}

function itemAt<T>(items: readonly T[], index: number): T {
  const item = items[index];
  if (item === undefined) throw new RangeError(`índice ${index} fuera de rango`);
  return item;
}

/** Rotación efectiva: la propia de la página o la del antecesor más cercano que la tenga; si ninguno, 0. */
async function rotationOf(
  reader: ObjectReader,
  page: PdfDict,
  ancestors: readonly PdfDict[],
): Promise<{ readonly rotation: PageRotation; readonly own: boolean }> {
  for (const [level, node] of [page, ...ancestors].entries()) {
    const value = await reader.resolve(dictGet(node, 'Rotate'));
    if (typeof value === 'number' && Number.isFinite(value)) {
      return { rotation: normalizeRotation(value), own: level === 0 };
    }
  }
  return { rotation: 0, own: false };
}

/** Grados a 0-359 y redondeo al múltiplo de 90 más cercano. */
function normalizeRotation(degrees: number): PageRotation {
  const turns = Math.round((((degrees % 360) + 360) % 360) / 90) % 4;
  return VALID_ROTATIONS[turns] ?? 0;
}

/** Primer valor de `key` entre los antecesores (sin resolver: se copia tal cual). */
function inheritedValue(ancestors: readonly PdfDict[], key: string): PdfValue | undefined {
  for (const node of ancestors) {
    const value = dictGet(node, key);
    if (value !== undefined) return value;
  }
  return undefined;
}

/** Cadena de antecesores: diccionario de cada nodo `/Pages` por `/Parent`, del más cercano a la raíz. */
type AncestorMemo = Map<number, readonly PdfDict[]>;

/** Antecesores de `page` por `/Parent`, del más cercano a la raíz (máximo 64). Memoizados por número de nodo. */
async function ancestorsOf(reader: ObjectReader, page: PdfDict, memo: AncestorMemo): Promise<readonly PdfDict[]> {
  const parent = dictGet(page, 'Parent');
  return isRef(parent) ? chainFrom(reader, parent, memo, MAX_ANCESTORS) : [];
}

/** Cadena que empieza en `node`. Cada nodo se lee una vez por pasada: en 100 000 páginas evita releer los padres. */
async function chainFrom(reader: ObjectReader, node: PdfRef, memo: AncestorMemo, budget: number): Promise<readonly PdfDict[]> {
  const known = memo.get(node.num);
  if (known !== undefined) return known;
  const dict = budget > 0 ? await reader.getDict(node) : null;
  if (dict === null) return [];
  const parent = dictGet(dict, 'Parent');
  const above = isRef(parent) ? await chainFrom(reader, parent, memo, budget - 1) : [];
  const chain: readonly PdfDict[] = [dict, ...above];
  memo.set(node.num, chain);
  return chain;
}

interface PageEntry {
  readonly ref: PdfRef;
  readonly dict: PdfDict;
}

/**
 * Páginas en orden de árbol, leyendo cada objeto una sola vez (el diccionario de la página ya viene con la
 * referencia). Mismo recorrido que `ObjectReader.pageRefs`, pero sin releer las hojas después.
 */
async function* eachPage(reader: ObjectReader): AsyncGenerator<PageEntry, void, undefined> {
  const root = await rootPagesRef(reader, await catalogRef(reader));
  const stack: PdfRef[] = [root];
  const visited = new Set<number>();
  for (let node = stack.pop(); node !== undefined; node = stack.pop()) {
    if (visited.has(node.num)) continue;
    visited.add(node.num);
    const dict = await reader.getDict(node);
    if (dict === null) continue;
    const kids = await reader.resolve(dictGet(dict, 'Kids'));
    if (!Array.isArray(kids)) {
      yield { ref: node, dict };
      continue;
    }
    for (let i = kids.length - 1; i >= 0; i--) {
      const kid = kids[i];
      if (isRef(kid)) stack.push(kid);
    }
  }
}

async function pageDict(reader: ObjectReader, r: PdfRef): Promise<PdfDict> {
  const page = await reader.getDict(r);
  if (page === null) throw unreadable(`página ${r.num}`);
  return page;
}

/** Referencia del catálogo (`/Root` del trailer). */
async function catalogRef(reader: ObjectReader): Promise<PdfRef> {
  const root = dictGet(reader.xref.trailer, 'Root');
  if (!isRef(root)) throw unreadable('Root');
  return root;
}

/** Referencia de `/Pages` del catálogo: se reutiliza como raíz del árbol nuevo. */
async function rootPagesRef(reader: ObjectReader, catalog: PdfRef): Promise<PdfRef> {
  const dictionary = await reader.getDict(catalog);
  if (dictionary === null) throw unreadable('catálogo');
  const pages = dictGet(dictionary, 'Pages');
  if (!isRef(pages)) throw unreadable('/Pages');
  return pages;
}

function reportProgress(onProgress: PageTreeInput['onProgress'], done: number, total: number): void {
  if (onProgress === undefined) return;
  if (done === total || done % PROGRESS_EVERY === 0) onProgress(done, total);
}

function unreadable(where: string): PdfSyntaxError {
  return new PdfSyntaxError(`estructura no legible: ${where}`, 0);
}

function isRef(v: PdfValue | undefined): v is PdfRef {
  return typeof v === 'object' && v !== null && !Array.isArray(v) && 'kind' in v && v.kind === 'ref';
}
