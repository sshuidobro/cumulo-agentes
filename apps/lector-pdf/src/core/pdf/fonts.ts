/**
 * Fuentes usadas por las páginas (ISO 32000-1 §7.8.3, §9.6 y §9.7). Solo lee los diccionarios necesarios
 * a través de `ObjectReader` (ADR-0014): las páginas, sus `/Resources` (heredables desde `/Pages`), las
 * fuentes de la página y las de los Form XObject de primer nivel. Sin recursión ni fuentes de anotaciones.
 */
import type { ObjectReader } from './object-reader';
import { dictGet, type PdfDict, type PdfRef, type PdfValue } from './objects';

export interface FontInfo {
  /** `/BaseFont` sin el prefijo de subconjunto «ABCDEF+». Vacío si la fuente no tiene nombre (p. ej. Type3). */
  readonly name: string;
  /** `/Subtype`; en Type0, el de su fuente descendiente. */
  readonly subtype: string;
  /** Nombre de `/Encoding`, «Personalizada» (diccionario o flujo CMap) o vacío si no existe. */
  readonly encoding: string;
  /** `FontDescriptor` con `/FontFile`, `/FontFile2` o `/FontFile3`. */
  readonly embedded: boolean;
  /** El nombre original llevaba el prefijo de subconjunto «XXXXXX+». */
  readonly subset: boolean;
}

/** Profundidad máxima subiendo por `/Parent` para heredar `/Resources`; corta árboles incoherentes. */
const MAX_PARENT_DEPTH = 64;
const SUBSET_PREFIX = /^[A-Z]{6}\+/;

/**
 * Diccionarios de fuente ya leídos, por número de objeto (`null` si no es un diccionario de fuente).
 * Vive mientras viva el lector: un escaneo abre un `ObjectReader` nuevo, así que no mezcla documentos.
 */
const fontCaches = new WeakMap<ObjectReader, Map<number, FontInfo | null>>();

/**
 * Fuentes de las páginas `[from, to)` (base 0), únicas por (nombre, subtipo, incrustada).
 * Devuelve `'cancelled'` si `signal` aborta antes de terminar. Los errores de lectura se propagan.
 */
export async function scanFonts(
  reader: ObjectReader,
  from: number,
  to: number,
  signal: AbortSignal,
): Promise<readonly FontInfo[] | 'cancelled'> {
  const found = new Map<string, FontInfo>();
  for (let index = from; index < to; index++) {
    if (signal.aborted) return 'cancelled';
    for (const font of await fontsOfPage(reader, index)) {
      found.set(fontKey(font), font);
    }
  }
  if (signal.aborted) return 'cancelled';
  return sortFonts([...found.values()]);
}

/** Une dos listas sin repetir fuentes (misma clave) y las ordena por nombre en español. */
export function mergeFonts(a: readonly FontInfo[], b: readonly FontInfo[]): readonly FontInfo[] {
  const merged = new Map<string, FontInfo>();
  for (const font of [...a, ...b]) {
    const key = fontKey(font);
    if (!merged.has(key)) merged.set(key, font);
  }
  return sortFonts([...merged.values()]);
}

function fontKey(font: FontInfo): string {
  return `${font.name}\u0000${font.subtype}\u0000${String(font.embedded)}`;
}

function sortFonts(fonts: FontInfo[]): readonly FontInfo[] {
  return fonts.sort((x, y) =>
    x.name.localeCompare(y.name, 'es') ||
    x.subtype.localeCompare(y.subtype, 'es') ||
    Number(x.embedded) - Number(y.embedded),
  );
}

/** Fuentes de la página `index`: las de sus `/Resources` y las de los Form XObject de primer nivel. */
async function fontsOfPage(reader: ObjectReader, index: number): Promise<readonly FontInfo[]> {
  const pageRef = await reader.pageRef(index);
  const page = await reader.getDict(pageRef);
  if (page === null) return [];
  const resources = await inheritedResources(reader, pageRef, page);
  if (resources === null) return [];

  const fonts: FontInfo[] = [];
  await collectFonts(reader, resources, fonts);

  const xobjects = asDict(await reader.resolve(dictGet(resources, 'XObject')));
  if (xobjects !== null) {
    for (const value of xobjects.entries.values()) {
      if (!isRef(value)) continue;
      const xobject = await reader.getDict(value);
      if (xobject === null || nameOf(await reader.resolve(dictGet(xobject, 'Subtype'))) !== 'Form') continue;
      const formResources = asDict(await reader.resolve(dictGet(xobject, 'Resources')));
      if (formResources !== null) await collectFonts(reader, formResources, fonts);
    }
  }
  return fonts;
}

/** `/Resources` de la página o, si no tiene, el del primer ancestro que lo tenga (`/Pages`). */
async function inheritedResources(reader: ObjectReader, pageRef: PdfRef, page: PdfDict): Promise<PdfDict | null> {
  const visited = new Set<number>([pageRef.num]);
  let node: PdfDict = page;
  for (let depth = 0; depth < MAX_PARENT_DEPTH; depth++) {
    const value = await reader.resolve(dictGet(node, 'Resources'));
    if (value !== undefined && value !== null) return asDict(value);
    const parent = dictGet(node, 'Parent');
    if (!isRef(parent) || visited.has(parent.num)) return null;
    visited.add(parent.num);
    const next = await reader.getDict(parent);
    if (next === null) return null;
    node = next;
  }
  return null;
}

/** Añade las fuentes del diccionario `/Font` de un `/Resources`. */
async function collectFonts(reader: ObjectReader, resources: PdfDict, out: FontInfo[]): Promise<void> {
  const fonts = asDict(await reader.resolve(dictGet(resources, 'Font')));
  if (fonts === null) return;
  for (const value of fonts.entries.values()) {
    const font = await fontAt(reader, value);
    if (font !== null) out.push(font);
  }
}

/** Fuente de un valor del diccionario `/Font`; las referencias se cachean por número de objeto. */
async function fontAt(reader: ObjectReader, value: PdfValue): Promise<FontInfo | null> {
  if (!isRef(value)) {
    const dict = asDict(value);
    return dict === null ? null : describeFont(reader, dict);
  }
  let cache = fontCaches.get(reader);
  if (cache === undefined) {
    cache = new Map<number, FontInfo | null>();
    fontCaches.set(reader, cache);
  }
  const cached = cache.get(value.num);
  if (cached !== undefined) return cached;
  const dict = await reader.getDict(value);
  const font = dict === null ? null : await describeFont(reader, dict);
  cache.set(value.num, font);
  return font;
}

/** Datos de un diccionario de fuente. En Type0 la información de subtipo y descriptor viene de la descendiente. */
async function describeFont(reader: ObjectReader, dict: PdfDict): Promise<FontInfo> {
  const rawSubtype = nameOf(await reader.resolve(dictGet(dict, 'Subtype')));
  let holder = dict;
  let subtype = rawSubtype ?? '';
  let rawBaseFont = nameOf(await reader.resolve(dictGet(dict, 'BaseFont')));

  if (rawSubtype === 'Type0') {
    const descendant = await descendantOf(reader, dict);
    if (descendant !== null) {
      holder = descendant;
      subtype = nameOf(await reader.resolve(dictGet(descendant, 'Subtype'))) ?? subtype;
      rawBaseFont ??= nameOf(await reader.resolve(dictGet(descendant, 'BaseFont')));
    }
  }

  const encodingValue = await reader.resolve(dictGet(dict, 'Encoding'));
  let encoding = '';
  if (typeof encodingValue === 'object' && encodingValue !== null && 'kind' in encodingValue) {
    if (encodingValue.kind === 'name') encoding = encodingValue.value;
    else if (encodingValue.kind === 'dict' || encodingValue.kind === 'stream') encoding = 'Personalizada';
  }

  const descriptor = asDict(await reader.resolve(dictGet(holder, 'FontDescriptor')));
  const embedded = descriptor !== null && ['FontFile', 'FontFile2', 'FontFile3'].some((key) => dictGet(descriptor, key) !== undefined);

  const base = rawBaseFont ?? '';
  return {
    name: base.replace(SUBSET_PREFIX, ''),
    subtype,
    encoding,
    embedded,
    subset: SUBSET_PREFIX.test(base),
  };
}

/** Primera fuente descendiente de un Type0, o `null` si falta. */
async function descendantOf(reader: ObjectReader, type0: PdfDict): Promise<PdfDict | null> {
  const list = await reader.resolve(dictGet(type0, 'DescendantFonts'));
  if (!Array.isArray(list)) return null;
  const first: PdfValue | undefined = list[0];
  if (first === undefined) return null;
  return isRef(first) ? reader.getDict(first) : asDict(first);
}

function isRef(v: PdfValue | undefined): v is PdfRef {
  return typeof v === 'object' && v !== null && 'kind' in v && v.kind === 'ref';
}

/** Diccionario directo (no flujo); cualquier otra cosa → `null`. */
function asDict(v: PdfValue | undefined): PdfDict | null {
  return typeof v === 'object' && v !== null && 'kind' in v && v.kind === 'dict' ? v : null;
}

function nameOf(v: PdfValue | undefined): string | null {
  return typeof v === 'object' && v !== null && 'kind' in v && v.kind === 'name' ? v.value : null;
}
