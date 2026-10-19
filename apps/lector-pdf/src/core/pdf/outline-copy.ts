/**
 * Índice (ISO 32000-1 §12.3.3): lectura de las entradas de primer nivel con su página, y copia del índice de una
 * fuente bajo una rama nueva de un documento nuevo (PDF-122, ADR-0035). Las fuentes no son de confianza: los ciclos
 * se cortan con un conjunto de visitados y cada fuente admite como mucho 10 000 entradas.
 */
import type { ObjectCopier } from './object-copier';
import type { ObjectReader } from './object-reader';
import { bytesString, dict, dictGet, name, type PdfDict, type PdfName, type PdfRef, type PdfString, type PdfValue } from './objects';
import { resolveNamedDest } from './name-tree';
import { decodeTextString, encodeTextString } from './text-string';

/** Entradas que se leen o copian de una fuente, como mucho. */
const MAX_ENTRIES = 10_000;

export interface OutlineTop {
  readonly title: string;
  /** Página (base 0) a la que lleva la entrada, o `null` (URI, sin destino, página inexistente). */
  readonly pageIndex: number | null;
}

export interface OutlineBranch {
  /** Nodo raíz de la rama: apunta a la primera página de la parte. */
  readonly ref: PdfRef;
  /** Objetos nuevos de la rama (raíz incluida). La raíz no lleva aún `/Parent`, `/Prev` ni `/Next`. */
  readonly objects: readonly (readonly [PdfRef, PdfValue])[];
  /** Elementos visibles bajo la raíz (sin contarla): su `/Count`. */
  readonly visibleCount: number;
}

/** Entradas de primer nivel del índice con la página (0-based) a la que llevan, o null (URI, sin destino, página inexistente). */
export async function readTopLevelOutline(reader: ObjectReader): Promise<readonly OutlineTop[]> {
  const outlines = await outlinesOf(reader);
  if (outlines === null) return [];
  const pages = await pageIndexes(reader);
  const out: OutlineTop[] = [];
  const visited = new Set<number>();
  let cursor = dictGet(outlines, 'First');
  while (out.length < MAX_ENTRIES && isRef(cursor) && !visited.has(cursor.num)) {
    visited.add(cursor.num);
    const item = await reader.getDict(cursor);
    if (item === null) break;
    const title = await reader.resolve(dictGet(item, 'Title'));
    out.push({
      title: isString(title) ? decodeTextString(title) : '',
      pageIndex: await pageIndexOf(reader, item, pages),
    });
    cursor = dictGet(item, 'Next');
  }
  return out;
}

/**
 * Copia el índice de `reader` con `copier` (destinos remapeados) bajo un nodo nuevo con `title` que apunta a
 * `firstPage`. Devuelve la ref del nodo raíz del subárbol y sus objetos. Entradas cuyo destino era una página no
 * copiada: se conservan sin `/Dest`.
 */
export async function copyOutlineBranch(
  reader: ObjectReader,
  copier: ObjectCopier,
  title: string,
  firstPage: PdfRef,
): Promise<OutlineBranch> {
  const nodes = await collectEntries(reader, copier);
  const below = visibleBelow(nodes);
  const branchRef = copier.allocRef();

  const objects: (readonly [PdfRef, PdfValue])[] = [];
  for (const node of nodes) {
    const entries = await entryDict(reader, copier, node.dict);
    entries.Parent = node.parent === null ? branchRef : refAt(nodes, node.parent);
    if (node.prev !== null) entries.Prev = refAt(nodes, node.prev);
    if (node.next !== null) entries.Next = refAt(nodes, node.next);
    const first = node.children[0];
    const last = node.children[node.children.length - 1];
    if (first !== undefined && last !== undefined) {
      entries.First = refAt(nodes, first);
      entries.Last = refAt(nodes, last);
    }
    objects.push([node.ref, dict(entries)]);
  }

  const topLevel = nodes.map((node, index) => ({ node, index })).filter(({ node }) => node.parent === null);
  const visibleCount = topLevel.reduce((sum, { index }) => sum + 1 + (nodeOpen(nodes, index) ? (below[index] ?? 0) : 0), 0);
  const root: Record<string, PdfValue> = {
    Title: encodeTextString(title),
    Dest: [firstPage, name('Fit')],
  };
  const firstTop = topLevel[0];
  const lastTop = topLevel[topLevel.length - 1];
  if (firstTop !== undefined && lastTop !== undefined) {
    root.First = refAt(nodes, firstTop.index);
    root.Last = refAt(nodes, lastTop.index);
    root.Count = visibleCount;
  }
  objects.push([branchRef, dict(root)]);
  return { ref: branchRef, objects: [...objects, ...copier.drain()], visibleCount };
}

/** Entrada leída de la fuente: su diccionario, su ref nueva y su parentesco (índices en `nodes`). */
interface CopyNode {
  readonly dict: PdfDict;
  readonly ref: PdfRef;
  /** Índice del padre, o `null` si cuelga de la raíz de la rama. */
  readonly parent: number | null;
  readonly prev: number | null;
  readonly next: number | null;
  readonly children: readonly number[];
  /** `/Count` original si es un entero (su signo indica si la entrada está abierta); si no, `null`. */
  readonly count: number | null;
}

/**
 * Recorre el índice de la fuente en profundidad y por hermanos, sin recursión. Cada entrada se visita una vez; el
 * padre siempre va antes que sus hijos en `nodes`.
 */
async function collectEntries(reader: ObjectReader, copier: ObjectCopier): Promise<CopyNode[]> {
  const outlines = await outlinesOf(reader);
  if (outlines === null) return [];

  const dicts: PdfDict[] = [];
  const refs: PdfRef[] = [];
  const parents: (number | null)[] = [];
  const children: number[][] = [];
  const visited = new Set<number>();
  const pending: { first: PdfValue | undefined; parent: number | null }[] = [{ first: dictGet(outlines, 'First'), parent: null }];

  for (let job = pending.pop(); job !== undefined; job = pending.pop()) {
    let cursor = job.first;
    while (dicts.length < MAX_ENTRIES && isRef(cursor) && !visited.has(cursor.num)) {
      visited.add(cursor.num);
      const dict = await reader.getDict(cursor);
      if (dict === null) break;
      const index = dicts.length;
      dicts.push(dict);
      refs.push(copier.allocRef());
      parents.push(job.parent);
      children.push([]);
      if (job.parent !== null) children[job.parent]?.push(index);
      pending.push({ first: dictGet(dict, 'First'), parent: index });
      cursor = dictGet(dict, 'Next');
    }
  }

  const siblings = siblingLinks(parents, dicts.length);
  const out: CopyNode[] = [];
  for (const [index, dict] of dicts.entries()) {
    const ref = refOf(refs, index);
    const count = await reader.resolve(dictGet(dict, 'Count'));
    out.push({
      dict,
      ref,
      parent: parents[index] ?? null,
      prev: siblings.prev[index] ?? null,
      next: siblings.next[index] ?? null,
      children: children[index] ?? [],
      count: typeof count === 'number' ? count : null,
    });
  }
  return out;
}

/** Hermanos anterior y siguiente de cada entrada, según el orden en que se recorrieron. */
function siblingLinks(parents: readonly (number | null)[], count: number): { prev: (number | null)[]; next: (number | null)[] } {
  const prev: (number | null)[] = new Array<number | null>(count).fill(null);
  const next: (number | null)[] = new Array<number | null>(count).fill(null);
  const lastOf = new Map<number | null, number>();
  for (let index = 0; index < count; index++) {
    const parent = parents[index] ?? null;
    const before = lastOf.get(parent);
    if (before !== undefined) {
      prev[index] = before;
      next[before] = index;
    }
    lastOf.set(parent, index);
  }
  return { prev, next };
}

/**
 * Elementos visibles bajo cada entrada (sin contarla): los hijos de una entrada cerrada (`/Count` ≤ 0) no cuentan.
 * Se recorre de atrás adelante, porque el padre siempre va antes que sus hijos.
 */
function visibleBelow(nodes: readonly CopyNode[]): number[] {
  const below = new Array<number>(nodes.length).fill(0);
  for (let index = nodes.length - 1; index >= 0; index--) {
    const node = nodes[index];
    if (node === undefined) continue;
    below[index] = node.children.reduce((sum, child) => sum + 1 + (nodeOpen(nodes, child) ? (below[child] ?? 0) : 0), 0);
  }
  return below;
}

/** Una entrada está abierta si su `/Count` original es positivo. */
function nodeOpen(nodes: readonly CopyNode[], index: number): boolean {
  return (nodes[index]?.count ?? 0) > 0;
}

/** Ref nueva de la entrada `index` (debe existir: es un índice de `nodes`). */
function refAt(nodes: readonly CopyNode[], index: number): PdfRef {
  const node = nodes[index];
  if (node === undefined) throw new RangeError(`entrada de índice ${index} fuera de rango (bug)`);
  return node.ref;
}

function refOf(refs: readonly PdfRef[], index: number): PdfRef {
  const found = refs[index];
  if (found === undefined) throw new RangeError(`entrada de índice ${index} fuera de rango (bug)`);
  return found;
}

/**
 * Entradas copiadas de una fuente: título, color, estilo, recuento y destino o acción. Los enlaces se rellenan
 * después, con las refs nuevas.
 */
async function entryDict(reader: ObjectReader, copier: ObjectCopier, source: PdfDict): Promise<Record<string, PdfValue>> {
  const entries: Record<string, PdfValue> = {};
  const title = await reader.resolve(dictGet(source, 'Title'));
  entries.Title = isString(title) ? title : bytesString(new Uint8Array());
  for (const key of ['C', 'F'] as const) {
    const value = dictGet(source, key);
    if (value !== undefined) entries[key] = await copier.copyDirect(value);
  }
  const count = await reader.resolve(dictGet(source, 'Count'));
  if (typeof count === 'number') entries.Count = count;

  const dest = dictGet(source, 'Dest');
  const action = dictGet(source, 'A');
  if (dest !== undefined) {
    const copied = await destOf(reader, copier, dest);
    if (copied !== undefined) entries.Dest = copied;
  } else if (action !== undefined) {
    const copied = await actionOf(reader, copier, action);
    if (copied !== undefined) entries.A = copied;
  }
  return entries;
}

/** Destino explícito copiado con su página remapeada; `undefined` si no hay página copiada o no es un destino. */
async function destOf(reader: ObjectReader, copier: ObjectCopier, value: PdfValue): Promise<PdfValue | undefined> {
  const resolved = await reader.resolve(value);
  if (isNamedKey(resolved)) return usableDest(await copier.namedDestValue(resolved));
  if (Array.isArray(resolved)) return usableDest(await copier.copyDirect(resolved));
  return undefined;
}

/** Acción de la entrada: `GoTo` con destino remapeado, `URI` tal cual; el resto se quita. */
async function actionOf(reader: ObjectReader, copier: ObjectCopier, value: PdfValue): Promise<PdfValue | undefined> {
  const action = await reader.resolve(value);
  if (action === undefined || !isDict(action)) return undefined;
  const type = typeNameOf(dictGet(action, 'S'));
  if (type === 'URI') return copier.copyDirect(action);
  if (type !== 'GoTo') return undefined;
  const target = await destOf(reader, copier, dictGet(action, 'D') ?? null);
  return target === undefined ? undefined : dict({ S: name('GoTo'), D: target });
}

/** Un destino sirve si su página está copiada (primera posición con ref). */
function usableDest(value: PdfValue | undefined): PdfValue | undefined {
  if (!Array.isArray(value)) return undefined;
  return value[0] === null || value[0] === undefined ? undefined : value;
}

/** Página (índice base 0) de una entrada de primer nivel, o `null`. */
async function pageIndexOf(reader: ObjectReader, item: PdfDict, pages: ReadonlyMap<number, number>): Promise<number | null> {
  const dest = await explicitDestOf(reader, item);
  const page = Array.isArray(dest) ? dest[0] : undefined;
  if (!isRef(page)) return null;
  return pages.get(page.num) ?? null;
}

/** Destino explícito de una entrada (`/Dest`, o `/A` con `GoTo`), con los nombres resueltos. */
async function explicitDestOf(reader: ObjectReader, item: PdfDict): Promise<readonly PdfValue[] | null> {
  const dest = dictGet(item, 'Dest');
  if (dest !== undefined) return destArray(reader, dest);
  const action = await reader.resolve(dictGet(item, 'A'));
  if (action === undefined || !isDict(action) || typeNameOf(dictGet(action, 'S')) !== 'GoTo') return null;
  return destArray(reader, dictGet(action, 'D') ?? null);
}

async function destArray(reader: ObjectReader, value: PdfValue): Promise<readonly PdfValue[] | null> {
  const resolved = await reader.resolve(value);
  if (isNamedKey(resolved)) return resolveNamedDest(reader, resolved);
  return Array.isArray(resolved) ? resolved : null;
}

/** Índices base 0 de las páginas por número de objeto. */
async function pageIndexes(reader: ObjectReader): Promise<ReadonlyMap<number, number>> {
  const map = new Map<number, number>();
  (await reader.pageRefs()).forEach((page, index) => map.set(page.num, index));
  return map;
}

/** Diccionario `/Outlines` del catálogo, o `null` si no hay índice. */
async function outlinesOf(reader: ObjectReader): Promise<PdfDict | null> {
  const catalog = await reader.resolve(dictGet(reader.xref.trailer, 'Root'));
  if (catalog === undefined || !isDict(catalog)) return null;
  const outlines = await reader.resolve(dictGet(catalog, 'Outlines'));
  return outlines !== undefined && isDict(outlines) ? outlines : null;
}

function typeNameOf(v: PdfValue | undefined): string | null {
  return typeof v === 'object' && v !== null && !Array.isArray(v) && 'kind' in v && v.kind === 'name' ? v.value : null;
}

function isRef(v: PdfValue | undefined): v is PdfRef {
  return typeof v === 'object' && v !== null && !Array.isArray(v) && 'kind' in v && v.kind === 'ref';
}

function isDict(v: PdfValue): v is PdfDict {
  return typeof v === 'object' && v !== null && !Array.isArray(v) && 'kind' in v && v.kind === 'dict';
}

function isString(v: PdfValue | undefined): v is PdfString {
  return typeof v === 'object' && v !== null && !Array.isArray(v) && 'kind' in v && v.kind === 'string';
}

function isNamedKey(v: PdfValue | undefined): v is PdfString | PdfName {
  return isString(v) || (typeof v === 'object' && v !== null && !Array.isArray(v) && 'kind' in v && v.kind === 'name');
}
