/**
 * Lector de objetos PDF por número (ISO 32000-1 §7.3.10, §7.5.7 y §7.7.3) que solo lee los bytes
 * necesarios a través de una caché de bloques (ADR-0014). Localiza la página `i` bajando por el
 * árbol `/Pages` con `/Count` sin leer las hojas hermanas.
 */
import type { ByteSource } from '@suite/platform';
import { BlockCache } from './block-cache';
import { openSecurity, type SecurityHandler } from './crypto';
import { decryptValue, secureRandom, type RandomBytes } from './crypt-rules';
import { decodeStreamData } from './filters';
import { PdfLexer, type Token } from './lexer';
import { Lru } from './lru';
import { dictGet, PdfSyntaxError, ref, type PdfDict, type PdfRef, type PdfStream, type PdfValue } from './objects';
import { parseIndirectObject, parseValue, type LengthResolver } from './parser';
import { readXref, type XrefInfo } from './xref';

export interface ObjectReaderOptions {
  /** Contraseña (de usuario o de propietario). Por defecto, la vacía. */
  readonly password?: string;
  /** Generador de IV para escribir. Por defecto, `crypto.getRandomValues`. */
  readonly random?: RandomBytes;
}

const OBJECT_CACHE_SIZE = 2000;
const OBJECT_STREAM_CACHE_SIZE = 16;
/** Primera ventana para buscar `endobj`; se duplica hasta encontrarlo. */
const FIRST_WINDOW = 4096;
const ENDOBJ = asciiBytes('endobj');

interface ObjectStreamEntry {
  readonly num: number;
  /** Offset relativo a `/First`. */
  readonly offset: number;
}

interface ObjectStreamIndex {
  readonly bytes: Uint8Array;
  readonly first: number;
  readonly entries: readonly ObjectStreamEntry[];
}

export class ObjectReader {
  readonly xref: XrefInfo;
  /** Referencia del diccionario `/Encrypt` del trailer, o `null` si el fichero no está cifrado. */
  readonly encryptRef: PdfRef | null;
  /** Generador de IV que usa la escritura de este fichero. */
  readonly random: RandomBytes;
  private readonly cache: BlockCache;
  private readonly objects = new Lru<number, PdfValue>(OBJECT_CACHE_SIZE);
  private readonly objectStreams = new Lru<number, ObjectStreamIndex>(OBJECT_STREAM_CACHE_SIZE);
  private pagesPromise: Promise<readonly PdfRef[]> | null = null;
  private securityHandler: SecurityHandler | null = null;

  private constructor(cache: BlockCache, xref: XrefInfo, encryptRef: PdfRef | null, random: RandomBytes) {
    this.cache = cache;
    this.xref = xref;
    this.encryptRef = encryptRef;
    this.random = random;
  }

  /**
   * Lee la xref (solo su tabla) y prepara la caché de bloques sobre la fuente. Si el trailer tiene
   * `/Encrypt`, abre el manejador de seguridad con `opts.password`: `PdfSyntaxError('wrong-password')`
   * si la contraseña no vale y `PdfSyntaxError('encryption-unsupported')` si el cifrado no se soporta.
   */
  static async open(src: ByteSource, opts: ObjectReaderOptions = {}): Promise<ObjectReader> {
    const xref = await readXref(src);
    const random = opts.random ?? secureRandom;
    const encrypt = dictGet(xref.trailer, 'Encrypt');
    if (encrypt === undefined) return new ObjectReader(new BlockCache(src), xref, null, random);
    // /Encrypt debe ser una referencia indirecta (ISO 32000-1 §7.5.5); una directa no se soporta.
    if (!isRef(encrypt)) throw new PdfSyntaxError('encryption-unsupported', 0);

    const reader = new ObjectReader(new BlockCache(src), xref, encrypt, random);
    // Aún sin manejador, el diccionario /Encrypt se lee tal cual (nunca se cifra).
    const encDict = await reader.getDict(encrypt);
    if (encDict === null) throw new PdfSyntaxError('estructura no legible: /Encrypt', 0);
    const id0 = firstIdBytes(xref.trailer);
    const opened = openSecurity(encDict, id0, opts.password ?? '');
    if (!opened.ok) {
      throw new PdfSyntaxError(opened.error === 'wrong-password' ? 'wrong-password' : 'encryption-unsupported', 0);
    }
    reader.securityHandler = opened.value;
    return reader;
  }

  /** Manejador de seguridad si el fichero está cifrado y la contraseña es válida; si no, `null`. */
  get security(): SecurityHandler | null {
    return this.securityHandler;
  }

  /** Objeto `r`. Libre, inexistente o con otro `gen` → `null`. */
  get(r: PdfRef): Promise<PdfValue> {
    return this.load(r, []);
  }

  /** Si `v` es una referencia, su objeto; si no, el mismo valor. */
  async resolve(v: PdfValue | undefined): Promise<PdfValue | undefined> {
    return isRef(v) ? this.get(v) : v;
  }

  /** Diccionario del objeto, o el diccionario de un flujo. Cualquier otra cosa → `null`. */
  async getDict(r: PdfRef): Promise<PdfDict | null> {
    return dictOf(await this.get(r));
  }

  /** `/Count` del nodo raíz `/Pages` si es un entero ≥ 0; si no, el número de hojas recorridas. */
  async pageCount(): Promise<number> {
    const root = await this.rootPagesRef();
    if (root !== null) {
      const d = await this.getDict(root);
      const count = d === null ? undefined : await this.resolve(dictGet(d, 'Count'));
      const n = intValue(count);
      if (n !== null) return n;
    }
    return (await this.pageRefs()).length;
  }

  /** Referencia de la página `index` (base 0) bajando por `/Count`. Si no existe → `page-not-found`. */
  async pageRef(index: number): Promise<PdfRef> {
    if (!Number.isSafeInteger(index) || index < 0) throw pageNotFound();
    const root = await this.rootPagesRef();
    if (root === null) return this.fallback(index);

    let node: PdfRef = root;
    let rem = index;
    let mustBeOne = false;
    const visited = new Set<number>();
    for (;;) {
      if (visited.has(node.num)) return this.fallback(index);
      visited.add(node.num);
      const d = await this.getDict(node);
      if (d === null) return this.fallback(index);
      const kids = await this.kidsOf(d);
      if (kids === null) return rem === 0 ? node : this.fallback(index); // hoja

      const count = await this.resolve(dictGet(d, 'Count'));
      if (mustBeOne && count !== 1) return this.fallback(index);
      if (typeof count === 'number' && count === kids.length && kids.every(isRef)) {
        // Atajo: cada hijo cuenta como una página.
        const kid = kids[rem];
        if (!isRef(kid)) return this.fallback(index);
        node = kid;
        rem = 0;
        mustBeOne = true;
        continue;
      }

      mustBeOne = false;
      let chosen: PdfRef | null = null;
      for (const kid of kids) {
        if (!isRef(kid)) continue;
        const kd = await this.getDict(kid);
        if (kd === null) continue;
        let n = 1;
        if ((await this.kidsOf(kd)) !== null) {
          const c = intValue(await this.resolve(dictGet(kd, 'Count')));
          if (c === null) return this.fallback(index);
          n = c;
        }
        if (rem < n) {
          chosen = kid;
          break;
        }
        rem -= n;
      }
      if (chosen === null) return this.fallback(index);
      node = chosen;
    }
  }

  /** Recorrido completo en orden (lee todas las hojas). Cacheado. */
  pageRefs(): Promise<readonly PdfRef[]> {
    if (this.pagesPromise === null) {
      this.pagesPromise = this.collectPages().catch((error: unknown) => {
        this.pagesPromise = null;
        throw error;
      });
    }
    return this.pagesPromise;
  }

  private async collectPages(): Promise<readonly PdfRef[]> {
    const root = await this.rootPagesRef();
    if (root === null) return [];
    const pages: PdfRef[] = [];
    const visited = new Set<number>();
    const stack: PdfRef[] = [root];
    for (let node = stack.pop(); node !== undefined; node = stack.pop()) {
      if (visited.has(node.num)) continue;
      visited.add(node.num);
      const d = await this.getDict(node);
      if (d === null) continue;
      const kids = await this.kidsOf(d);
      if (kids === null) {
        pages.push(node);
        continue;
      }
      // Se apilan al revés para que salgan en el orden de /Kids.
      for (let i = kids.length - 1; i >= 0; i--) {
        const kid = kids[i];
        if (isRef(kid)) stack.push(kid);
      }
    }
    return pages;
  }

  private async fallback(index: number): Promise<PdfRef> {
    const page = (await this.pageRefs())[index];
    if (page === undefined) throw pageNotFound();
    return page;
  }

  private async rootPagesRef(): Promise<PdfRef | null> {
    const catalog = dictOf(await this.resolve(dictGet(this.xref.trailer, 'Root')));
    if (catalog === null) return null;
    const pages = dictGet(catalog, 'Pages');
    return isRef(pages) ? pages : null;
  }

  /** `/Kids` resuelto como array; `null` si el nodo es hoja. */
  private async kidsOf(d: PdfDict): Promise<readonly PdfValue[] | null> {
    const kids = await this.resolve(dictGet(d, 'Kids'));
    return Array.isArray(kids) ? kids : null;
  }

  /** `chain` son los números de objeto que se están cargando (corta los ciclos de `/Length`). */
  private async load(r: PdfRef, chain: readonly number[]): Promise<PdfValue> {
    if (chain.includes(r.num)) return null;
    const entry = this.xref.entries.get(r.num);
    if (entry === undefined || entry.type === 'free') return null;
    if (entry.type === 'offset' && entry.gen !== r.gen) return null;
    if (entry.type === 'compressed' && r.gen !== 0) return null;

    const cached = this.objects.get(r.num);
    if (cached !== undefined) return cached;

    const inner = [...chain, r.num];
    const value = entry.type === 'offset'
      ? await this.readAt(entry.offset, r, inner)
      : await this.readCompressed(entry.objStm, entry.index, r.num, inner);
    this.objects.set(r.num, value);
    return value;
  }

  private async readAt(offset: number, r: PdfRef, chain: readonly number[]): Promise<PdfValue> {
    const bytes = await this.window(offset);
    const lexer = new PdfLexer(bytes, 0);
    const numTok = lexer.next();
    const genTok = lexer.next();
    const objTok = lexer.next();
    if (tokenInt(numTok) !== r.num || tokenInt(genTok) !== r.gen || objTok.kind !== 'keyword' || objTok.value !== 'obj') {
      throw new PdfSyntaxError('object-mismatch', offset);
    }

    // Primero el diccionario: si su /Length es indirecto hay que resolverlo antes de cortar el flujo.
    const probe = parseValue(bytes, objTok.end).value;
    let resolveLength: LengthResolver | undefined;
    if (isStream(probe)) {
      const lengthRef = dictGet(probe.dict, 'Length');
      if (isRef(lengthRef)) {
        const length = await this.load(lengthRef, chain);
        const n = intValue(length);
        resolveLength = () => n;
      }
    }
    const value = parseIndirectObject(bytes, 0, resolveLength).value;
    // El diccionario /Encrypt nunca está cifrado; el resto de objetos de primer nivel sí (ISO 32000-2 §7.6.2).
    const h = this.securityHandler;
    if (h === null || r.num === this.encryptRef?.num) return value;
    return decryptValue(h, r.num, r.gen, value);
  }

  private async readCompressed(objStmNum: number, index: number, num: number, chain: readonly number[]): Promise<PdfValue> {
    const stream = await this.objectStream(objStmNum, chain);
    if (stream === null) return null;
    const entry = stream.entries[index];
    if (entry === undefined) return null;
    if (entry.num !== num) throw new PdfSyntaxError('object-mismatch', 0);
    return parseValue(stream.bytes, stream.first + entry.offset).value;
  }

  private async objectStream(num: number, chain: readonly number[]): Promise<ObjectStreamIndex | null> {
    const cached = this.objectStreams.get(num);
    if (cached !== undefined) return cached;

    const s = await this.load(ref(num), chain);
    if (!isStream(s)) return null;
    const n = intValue(await this.resolve(dictGet(s.dict, 'N')));
    const first = intValue(await this.resolve(dictGet(s.dict, 'First')));
    if (n === null || first === null) return null;

    const bytes = decodeStreamData(s);
    const lexer = new PdfLexer(bytes, 0);
    const entries: ObjectStreamEntry[] = [];
    for (let i = 0; i < n; i++) {
      const objNum = tokenInt(lexer.next());
      const offset = tokenInt(lexer.next());
      if (objNum === null || offset === null) throw new PdfSyntaxError('object-stream-header', lexer.offset);
      entries.push({ num: objNum, offset });
    }
    const index: ObjectStreamIndex = { bytes, first, entries };
    this.objectStreams.set(num, index);
    return index;
  }

  /**
   * Bytes desde `offset` hasta que aparezca `endobj` (o el final del fichero). Empieza con 4 KB
   * y duplica la ventana, así que un objeto pequeño cuesta un solo bloque.
   */
  private async window(offset: number): Promise<Uint8Array> {
    const size = this.cache.size;
    let length = FIRST_WINDOW;
    for (;;) {
      const end = Math.min(size, offset + length);
      const bytes = await this.cache.read(offset, end);
      if (end >= size || indexOfAscii(bytes, ENDOBJ) >= 0) return bytes;
      length *= 2;
    }
  }
}

/** Primer identificador de `/ID` del trailer como bytes; vacío si falta. */
function firstIdBytes(trailer: PdfDict): Uint8Array {
  const id = dictGet(trailer, 'ID');
  const first = Array.isArray(id) ? id[0] : undefined;
  return typeof first === 'object' && first !== null && !Array.isArray(first) && 'kind' in first && first.kind === 'string'
    ? first.bytes
    : new Uint8Array(0);
}

function pageNotFound(): PdfSyntaxError {
  return new PdfSyntaxError('page-not-found', 0);
}

function asciiBytes(text: string): Uint8Array {
  return Uint8Array.from(text, (ch) => ch.charCodeAt(0));
}

function indexOfAscii(bytes: Uint8Array, pattern: Uint8Array): number {
  const last = bytes.length - pattern.length;
  for (let i = 0; i <= last; i++) {
    let k = 0;
    while (k < pattern.length && bytes[i + k] === pattern[k]) k++;
    if (k === pattern.length) return i;
  }
  return -1;
}

/** Valor de un token entero no negativo, o `null`. */
function tokenInt(t: Token): number | null {
  return t.kind === 'number' && t.integer && t.value >= 0 ? t.value : null;
}

function intValue(v: PdfValue | undefined): number | null {
  return typeof v === 'number' && Number.isSafeInteger(v) && v >= 0 ? v : null;
}

function isRef(v: PdfValue | undefined): v is PdfRef {
  return typeof v === 'object' && v !== null && 'kind' in v && v.kind === 'ref';
}

function isStream(v: PdfValue | undefined): v is PdfStream {
  return typeof v === 'object' && v !== null && 'kind' in v && v.kind === 'stream';
}

/** Diccionario de un valor, o el diccionario de un flujo; cualquier otra cosa → `null`. */
function dictOf(v: PdfValue | undefined): PdfDict | null {
  if (typeof v !== 'object' || v === null || !('kind' in v)) return null;
  if (v.kind === 'dict') return v;
  if (v.kind === 'stream') return v.dict;
  return null;
}
