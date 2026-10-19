/**
 * Extraer y dividir (PDF-054, ADR-0035): planes de reparto de páginas en partes y nombres de los ficheros resultantes.
 * Las funciones de conteo y de índice son puras; `splitBySize` mide cada parte con un `ObjectCopier` nuevo y
 * `serializeIndirect`. Nunca escribe ficheros: eso lo hacen las operaciones de `DOC_OPS`.
 */
import type { ObjectReader } from '../pdf/object-reader';
import { ObjectCopier } from '../pdf/object-copier';
import type { OutlineTop } from '../pdf/outline-copy';
import { createAllocator } from '../pdf/page-tree';
import { serializeIndirect } from '../pdf/serialize';

export type SplitMode =
  | { readonly kind: 'pages'; readonly every: number }
  | { readonly kind: 'bookmarks' }
  | { readonly kind: 'size'; readonly maxBytes: number };

/** Tamaños de parte que ofrece la interfaz, en MB. */
export const SPLIT_SIZES_MB = [1, 2, 5, 10, 25, 50, 100] as const;

/** Mínimo admitido para `maxBytes`: por debajo, ni una página sola cabe en una parte útil. */
const MIN_MAX_BYTES = 100_000;
/** Cabecera, trailer y tabla de referencias de cada parte, estimados. */
const PART_BASE_BYTES = 2048;
/** Entrada de la tabla de referencias (xref) por cada objeto. */
const XREF_BYTES_PER_OBJECT = 20;
/**
 * Coste por página que `buildNewDocument` añade además de sus objetos medidos: `/Parent`, la entrada en `/Kids` y los
 * nodos `/Pages` intermedios. Medido ≈ 27 bytes por página; se deja margen.
 */
export const PAGE_TREE_OVERHEAD = 64;

/** Rango de páginas [from, to) como lista de índices. */
function range(from: number, to: number): number[] {
  const out: number[] = [];
  for (let i = from; i < to; i++) out.push(i);
  return out;
}

/** Grupos consecutivos de `every` páginas (el último puede ser menor). */
export function splitByPageCount(n: number, every: number): readonly (readonly number[])[] {
  if (!Number.isInteger(every) || every < 1) throw new RangeError(`every debe ser un entero ≥ 1: ${every}`);
  const groups: number[][] = [];
  for (let start = 0; start < n; start += every) groups.push(range(start, Math.min(n, start + every)));
  return groups;
}

/**
 * Cortes en las páginas de las entradas de primer nivel (sin repetir, ordenadas, sin null); si la primera no es 0,
 * el primer grupo empieza en 0. Sin cortes → un grupo con todas las páginas.
 */
export function splitByBookmarks(top: readonly OutlineTop[], n: number): readonly (readonly number[])[] {
  const cuts = [
    ...new Set(top.flatMap((entry) => (entry.pageIndex !== null && entry.pageIndex >= 0 && entry.pageIndex < n ? [entry.pageIndex] : []))),
  ].sort((a, b) => a - b);
  if (cuts.length === 0) return n > 0 ? [range(0, n)] : [];
  const starts = cuts[0] === 0 ? cuts : [0, ...cuts];
  return starts.map((start, i) => range(start, starts[i + 1] ?? n));
}

/**
 * Medida voraz: añade páginas a la parte actual mientras el tamaño estimado no supere `maxBytes`. Una página sola
 * mayor que el máximo va en su propia parte (`oversized` la cuenta). Si `signal` se aborta, devuelve los grupos
 * completos hasta ese punto: quien llama comprueba la señal.
 */
export async function splitBySize(
  reader: ObjectReader,
  maxBytes: number,
  signal?: AbortSignal,
): Promise<{ readonly groups: readonly (readonly number[])[]; readonly oversized: number }> {
  if (!Number.isFinite(maxBytes) || maxBytes < MIN_MAX_BYTES) throw new RangeError(`maxBytes debe ser ≥ ${MIN_MAX_BYTES}: ${maxBytes}`);
  const n = await reader.pageCount();
  const groups: number[][] = [];
  let oversized = 0;
  let current: number[] = [];
  let copier = newCopier(reader);
  let size = PART_BASE_BYTES;
  for (let index = 0; index < n; index++) {
    if (signal?.aborted === true) break;
    let delta = await measurePage(copier, index);
    if (current.length > 0 && size + delta > maxBytes) {
      // La página no cabe: el copiador de la parte actual se descarta y la página se mide de nuevo en una parte nueva.
      groups.push(current);
      current = [];
      copier = newCopier(reader);
      size = PART_BASE_BYTES;
      delta = await measurePage(copier, index);
    }
    current.push(index);
    size += delta;
    if (current.length === 1 && size > maxBytes) {
      oversized += 1;
      groups.push(current);
      current = [];
      copier = newCopier(reader);
      size = PART_BASE_BYTES;
    }
  }
  if (current.length > 0) groups.push(current);
  return { groups, oversized };
}

function newCopier(reader: ObjectReader): ObjectCopier {
  const alloc = createAllocator(1);
  return new ObjectCopier({ from: reader, alloc: () => alloc.next(), resolveNames: true });
}

/**
 * Bytes que añade la página `index` a la parte del copiador: su diccionario y los objetos que arrastra, con xref,
 * más el coste del árbol de páginas (`PAGE_TREE_OVERHEAD`).
 */
async function measurePage(copier: ObjectCopier, index: number): Promise<number> {
  await copier.reservePages([index]);
  const copied = await copier.copyPage(index);
  let bytes = serializeIndirect(copied.ref.num, copied.ref.gen, copied.dict).length + XREF_BYTES_PER_OBJECT + PAGE_TREE_OVERHEAD;
  for (const [objectRef, value] of copier.drain()) {
    bytes += serializeIndirect(objectRef.num, objectRef.gen, value).length + XREF_BYTES_PER_OBJECT;
  }
  return bytes;
}

/** true si la suma de los tamaños de las partes cabe en `limit` (el ZIP no puede superar ese tamaño). */
export function checkZipBudget(sizes: readonly number[], limit: number): boolean {
  return sizes.reduce((sum, size) => sum + size, 0) <= limit;
}

/** «informe-parte-01.pdf»… con cifras = max(2, cifras de `count`). */
export function splitPartNames(base: string, count: number): readonly string[] {
  const width = Math.max(2, String(count).length);
  return Array.from({ length: count }, (_, i) => `${base}-parte-${String(i + 1).padStart(width, '0')}.pdf`);
}

/**
 * Páginas 0-based → «informe-paginas-3-7.pdf» si son consecutivas, «informe-paginas-3.pdf» si es una,
 * «informe-extracto.pdf» si no.
 */
export function extractFileName(base: string, pages: readonly number[]): string {
  const first = pages[0];
  const last = pages[pages.length - 1];
  if (first === undefined || last === undefined) return `${base}-extracto.pdf`;
  if (!pages.every((page, i) => page === first + i)) return `${base}-extracto.pdf`;
  if (pages.length === 1) return `${base}-paginas-${first + 1}.pdf`;
  return `${base}-paginas-${first + 1}-${last + 1}.pdf`;
}

/** «informe-partes.zip». */
export function splitZipName(base: string): string {
  return `${base}-partes.zip`;
}
