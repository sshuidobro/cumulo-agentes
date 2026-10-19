/**
 * Reorganización de páginas por actualización incremental (PDF-052, ADR-0028). Dada la lista final de páginas
 * (orden y giro de cada una), escribe un incremento que reescribe el árbol `/Pages`: borrar, reordenar y girar
 * conservando anotaciones, enlaces, índice y cifrado. Solo se reescriben los objetos de página y los nodos
 * `/Pages` nuevos; el resto del fichero no se toca. Nunca lanza: los errores vuelven como `Result`.
 *
 * `writePageTree` escribe en un `DeltaWriter` que pone quien llama (PDF-119: la vista Organizar lo usa junto
 * con páginas en blanco y limpieza de formularios en un solo incremento). `buildPageTreeUpdate` es el envoltorio
 * de PDF-052: abre y cierra el incremento.
 */
import type { ByteSource } from '@suite/platform';
import { err, ok, type Result } from '@suite/shared';
import { pdfError } from '../errors';
import type { RandomBytes } from './crypt-rules';
import { finishDelta, reserveXref, startDelta, type DeltaWriter } from './delta-writer';
import { toSaveError } from './incremental';
import type { ObjectReader } from './object-reader';
import { planPageTree, type TreeNode } from './page-tree-layout';
import { dict, dictGet, name, PdfSyntaxError, ref, withEntries, type PdfDict, type PdfRef, type PdfValue } from './objects';

export { PAGE_TREE_FANOUT } from './page-tree-layout';

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

/** Siguiente número de objeto libre. Los números reservados por `next` no se repiten. */
export interface ObjectAllocator {
  next(): PdfRef;
  /** Primer número que aún no se ha dado. */
  readonly nextNum: number;
}

export function createAllocator(first: number): ObjectAllocator {
  let current = first;
  return {
    next(): PdfRef {
      const r = ref(current);
      current += 1;
      return r;
    },
    get nextNum(): number {
      return current;
    },
  };
}

/** Página que no está en el fichero abierto. `dict` sin `/Parent`, con `/MediaBox` y `/Resources` propios. */
export interface AddedPage {
  readonly ref: PdfRef;
  readonly dict: PdfDict;
}

export interface PageTreeWrite {
  readonly reader: ObjectReader;
  readonly writer: DeltaWriter;
  readonly alloc: ObjectAllocator;
  /** `source` en [0, n) = página original; en [n, n + added.length) = `added[source - n]`. */
  readonly pages: readonly PageSlot[];
  readonly added?: readonly AddedPage[];
  readonly signal?: AbortSignal;
  readonly onProgress?: (done: number, total: number) => void;
}

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
 * Escribe la actualización que deja las páginas en el orden y con el giro de `pages`, en `w.writer`. No abre ni
 * cierra el incremento. Solo giros (mismo orden, mismo número de páginas): reescribe solo las páginas cuyo giro
 * cambia. En otro caso, reconstruye el árbol `/Pages` con nodos de hasta 32 hijos y reescribe cada página.
 * Devuelve las páginas escritas (0 si solo giros y ninguno cambia).
 */
export async function writePageTree(w: PageTreeWrite): Promise<Result<number>> {
  try {
    return await writeTree(w);
  } catch (error: unknown) {
    return err(toSaveError(error));
  }
}

/**
 * Envoltorio de PDF-052: abre el incremento, escribe el árbol con `writePageTree` y lo cierra. Sin cambios
 * devuelve delta vacío.
 */
export async function buildPageTreeUpdate(input: PageTreeInput): Promise<Result<PageTreeOutput>> {
  try {
    const { source, reader, pages, now, signal, onProgress } = input;
    const writer = await startDelta(source, reader, input.random);
    const alloc = createAllocator(reader.xref.size);
    const written = await writePageTree({
      reader,
      writer,
      alloc,
      pages,
      ...(signal === undefined ? {} : { signal }),
      ...(onProgress === undefined ? {} : { onProgress }),
    });
    if (!written.ok) return err(written.error);
    if (written.value === 0) return ok({ delta: new Uint8Array(0), expectedSize: source.size, rewrittenPages: 0 });

    const root = await catalogRef(reader);
    const { xrefNum, size } = reserveXref(reader, alloc.nextNum);
    const delta = finishDelta(writer, { reader, root, size, xrefNum, now, sourceSize: source.size });
    return ok({ delta, expectedSize: source.size + delta.length, rewrittenPages: written.value });
  } catch (error: unknown) {
    return err(toSaveError(error));
  }
}

async function writeTree(w: PageTreeWrite): Promise<Result<number>> {
  const { reader, pages, signal } = w;
  const n = await reader.pageCount();
  const total = n + (w.added?.length ?? 0);
  if (!isValidList(pages, total)) return err(pdfError('organize-invalid'));
  if (signal?.aborted === true) return err(pdfError('cancelled'));

  const identity = pages.length === n && pages.every((slot, i) => slot.source === i);
  return identity ? writeRotationsOnly(w) : writeReordered(w, n);
}

/** `pages` no vacío, `source` entero sin repetir en [0, total) y `rotate` ∈ {0, 90, 180, 270}. */
function isValidList(pages: readonly PageSlot[], total: number): boolean {
  if (pages.length < 1) return false;
  const seen = new Set<number>();
  for (const slot of pages) {
    if (!Number.isInteger(slot.source) || slot.source < 0 || slot.source >= total || seen.has(slot.source)) return false;
    seen.add(slot.source);
    if (!VALID_ROTATIONS.includes(slot.rotate)) return false;
  }
  return true;
}

/** Solo giros: reescribe las páginas cuyo giro efectivo cambia. Devuelve cuántas reescribió. */
async function writeRotationsOnly(w: PageTreeWrite): Promise<Result<number>> {
  const { reader, writer, pages, signal, onProgress } = w;
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
  return ok(rewritten);
}

/** Caso general: árbol nuevo bajo la raíz original y cada página escrita con su número. */
async function writeReordered(w: PageTreeWrite, n: number): Promise<Result<number>> {
  const { reader, writer, alloc, pages, signal, onProgress } = w;
  const added = w.added ?? [];
  const refs = await reader.pageRefs();
  const rootPages = await rootPagesRef(reader, await catalogRef(reader));
  const tree = planPageTree(pages.length);
  const memo: AncestorMemo = new Map();
  const pageRefOf = (source: number): PdfRef => (source < n ? itemAt(refs, source) : itemAt(added, source - n).ref);

  // BFS: de arriba abajo y de izquierda a derecha. Los nodos nuevos toman números de `alloc`.
  const nodes: NodeEntry[] = [{ node: tree, ref: rootPages, parent: null, kids: [] }];
  const parentOfSlot: PdfRef[] = [];
  for (let at = 0; at < nodes.length; at++) {
    const entry = itemAt(nodes, at);
    for (const kid of entry.node.kids) {
      if ('slot' in kid) {
        parentOfSlot[kid.slot] = entry.ref;
        entry.kids.push(pageRefOf(itemAt(pages, kid.slot).source));
      } else {
        const childRef = alloc.next();
        entry.kids.push(childRef);
        nodes.push({ node: kid.node, ref: childRef, parent: entry.ref, kids: [] });
      }
    }
  }

  for (const entry of nodes) {
    if (signal?.aborted === true) return err(pdfError('cancelled'));
    const d: Record<string, PdfValue> = { Type: name('Pages'), Kids: entry.kids, Count: entry.node.count };
    if (entry.parent !== null) d.Parent = entry.parent;
    writer.object(entry.ref.num, entry.ref.gen, dict(d));
  }

  for (const [i, slot] of pages.entries()) {
    if (signal?.aborted === true) return err(pdfError('cancelled'));
    const rotate = slot.rotate === 0 ? undefined : slot.rotate;
    if (slot.source >= n) {
      const page = itemAt(added, slot.source - n);
      writer.object(page.ref.num, page.ref.gen, withEntries(page.dict, { Parent: itemAt(parentOfSlot, i), Rotate: rotate }));
    } else {
      const pageRef = itemAt(refs, slot.source);
      const page = await pageDict(reader, pageRef);
      const ancestors = await ancestorsOf(reader, page, memo);
      const changes: Record<string, PdfValue | undefined> = { Parent: itemAt(parentOfSlot, i), Rotate: rotate };
      for (const key of INHERITED_KEYS) {
        if (dictGet(page, key) !== undefined) continue;
        const value = inheritedValue(ancestors, key);
        if (value !== undefined) changes[key] = value;
      }
      writer.object(pageRef.num, pageRef.gen, withEntries(page, changes));
    }
    reportProgress(onProgress, i + 1, pages.length);
  }
  return ok(pages.length);
}

interface NodeEntry {
  readonly node: TreeNode;
  readonly ref: PdfRef;
  readonly parent: PdfRef | null;
  /** Referencias de los hijos, en orden: páginas o nodos nuevos. */
  readonly kids: PdfRef[];
}

/** Elemento de `items` que existe: lanza si el índice está fuera de rango (bug de quien llama). */
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
export async function catalogRef(reader: ObjectReader): Promise<PdfRef> {
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
