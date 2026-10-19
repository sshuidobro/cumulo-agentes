/**
 * Árboles de nombres (ISO 32000-1 §7.9.6) y destinos con nombre (§12.3.2.3). Solo lectura: sirven para convertir
 * `/Dest` con nombre y acciones `GoTo` en destinos explícitos al copiar páginas (PDF-122, ADR-0035).
 */
import type { ObjectReader } from './object-reader';
import { dictGet, type PdfDict, type PdfName, type PdfString, type PdfValue } from './objects';
import { decodeTextString } from './text-string';

/** Niveles máximos del árbol: los nodos más profundos se ignoran (protege de árboles malformados). */
const MAX_LEVELS = 32;

interface Frame {
  readonly node: PdfDict;
  /** Nivel del nodo: la raíz es 1. */
  readonly level: number;
  /** Número del objeto indirecto del nodo, o `null` si la raíz es directa. Sirve para cortar ciclos. */
  readonly num: number | null;
}

/**
 * Valor de `key` en un árbol de nombres (`/Names` en las hojas, `/Kids` con `/Limits` en los nodos intermedios).
 * Devuelve el valor ya resuelto, o `undefined` si la clave no está. Máximo 32 niveles.
 */
export async function lookupNameTree(reader: ObjectReader, root: PdfDict, key: Uint8Array): Promise<PdfValue | undefined> {
  const visited = new Set<number>();
  // Pila: el primer hijo queda arriba para respetar el orden de /Kids.
  const stack: Frame[] = [{ node: root, level: 1, num: null }];
  for (let frame = stack.pop(); frame !== undefined; frame = stack.pop()) {
    const names = await reader.resolve(dictGet(frame.node, 'Names'));
    if (Array.isArray(names)) {
      const found = await findInNames(reader, names, key);
      if (found !== undefined) return found;
      continue;
    }
    const kids = await reader.resolve(dictGet(frame.node, 'Kids'));
    if (!Array.isArray(kids) || frame.level >= MAX_LEVELS) continue;
    for (let i = kids.length - 1; i >= 0; i--) {
      const child = await childFrame(reader, kids[i], frame.level + 1, key, visited);
      if (child !== null) stack.push(child);
    }
  }
  return undefined;
}

/**
 * Destino explícito de un nombre: busca primero en `/Names /Dests` del catálogo y, si no está, en el antiguo
 * `/Dests` del catálogo. Un valor `<< /D [...] >> ` devuelve su `/D`. `null` si no existe o no es un array.
 */
export async function resolveNamedDest(reader: ObjectReader, nameKey: PdfString | PdfName): Promise<readonly PdfValue[] | null> {
  const catalog = asPlainDict(await reader.resolve(dictGet(reader.xref.trailer, 'Root')));
  if (catalog === null) return null;

  const names = asPlainDict(await reader.resolve(dictGet(catalog, 'Names')));
  const tree = names === null ? null : asPlainDict(await reader.resolve(dictGet(names, 'Dests')));
  let value: PdfValue | undefined = tree === null ? undefined : await lookupNameTree(reader, tree, keyBytes(nameKey));
  if (value === undefined || value === null) {
    const legacy = asPlainDict(await reader.resolve(dictGet(catalog, 'Dests')));
    if (legacy !== null) {
      const key = nameKey.kind === 'name' ? nameKey.value : decodeTextString(nameKey);
      value = await reader.resolve(legacy.entries.get(key));
    }
  }

  const dest = value !== undefined && value !== null && isPlainDict(value) ? await reader.resolve(dictGet(value, 'D')) : value;
  return Array.isArray(dest) ? dest : null;
}

/** Nodo hijo listo para recorrer, o `null` si ya se visitó o si su intervalo `/Limits` no contiene `key`. */
async function childFrame(
  reader: ObjectReader,
  kid: PdfValue,
  level: number,
  key: Uint8Array,
  visited: Set<number>,
): Promise<Frame | null> {
  const num = kid !== null && typeof kid === 'object' && !Array.isArray(kid) && 'kind' in kid && kid.kind === 'ref' ? kid.num : null;
  if (num !== null) {
    if (visited.has(num)) return null;
    visited.add(num);
  }
  const node = asPlainDict(await reader.resolve(kid));
  if (node === null) return null;
  const limits = await reader.resolve(dictGet(node, 'Limits'));
  if (Array.isArray(limits)) {
    const low = await reader.resolve(limits[0]);
    const high = await reader.resolve(limits[1]);
    if (isString(low) && compareBytes(key, low.bytes) < 0) return null;
    if (isString(high) && compareBytes(key, high.bytes) > 0) return null;
  }
  return { node, level, num };
}

/** Busca `key` entre los pares `[clave valor …]` de una hoja. */
async function findInNames(reader: ObjectReader, names: readonly PdfValue[], key: Uint8Array): Promise<PdfValue | undefined> {
  for (let i = 0; i + 1 < names.length; i += 2) {
    const candidate = await reader.resolve(names[i]);
    if (isString(candidate) && bytesEqual(candidate.bytes, key)) {
      return (await reader.resolve(names[i + 1])) ?? null;
    }
  }
  return undefined;
}

/** Bytes de la clave: los de una cadena, o el UTF-8 de un nombre (el lector decodifica los nombres como UTF-8). */
function keyBytes(key: PdfString | PdfName): Uint8Array {
  return key.kind === 'string' ? key.bytes : new TextEncoder().encode(key.value);
}

function compareBytes(a: Uint8Array, b: Uint8Array): number {
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) {
    const diff = (a[i] ?? 0) - (b[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return a.length - b.length;
}

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  return compareBytes(a, b) === 0;
}

function isString(v: PdfValue | undefined): v is PdfString {
  return typeof v === 'object' && v !== null && !Array.isArray(v) && 'kind' in v && v.kind === 'string';
}

function isPlainDict(v: PdfValue): v is PdfDict {
  return typeof v === 'object' && v !== null && !Array.isArray(v) && 'kind' in v && v.kind === 'dict';
}

/** Diccionario directo o el diccionario de un flujo; cualquier otra cosa → `null`. */
function asPlainDict(v: PdfValue | undefined): PdfDict | null {
  if (v === undefined || v === null || Array.isArray(v) || typeof v !== 'object' || !('kind' in v)) return null;
  if (v.kind === 'dict') return v;
  if (v.kind === 'stream') return v.dict;
  return null;
}
