/**
 * Reescritura completa de un PDF (PDF-131, ADR-0037 y ADR-0039): escribe un fichero nuevo con solo los objetos
 * alcanzables desde `/Root` e `/Info` (sin revisiones antiguas ni huérfanos), renumerados 1..N en orden de
 * descubrimiento, y opcionalmente cifrados. Es la base de proteger, quitar la protección y redactar.
 * Nunca lanza: los errores vuelven como `Result`.
 */
import { err, ok, type Result } from '@suite/shared';
import { pdfError } from '../errors';
import { createAes256Security, type NewSecurityInput } from './crypto';
import { writeCompleteFile, type FileEncryption } from './file-writer';
import type { ObjectReader } from './object-reader';
import { dictGet, PdfSyntaxError, ref, withEntries, type PdfDict, type PdfRef, type PdfString, type PdfValue } from './objects';
import { toSaveError } from './save-error';

export interface RewriteInput {
  /** Ya abierto con la contraseña (descifra al leer). */
  readonly reader: ObjectReader;
  /** Cifrado nuevo; `null` = sin cifrar (salvo que `keepEncryption` lo conserve). */
  readonly encryption: NewSecurityInput | null;
  /**
   * Con `encryption: null`: `true` conserva el cifrado del original (mismo manejador y mismo `/Encrypt` tal cual
   * leído, así las contraseñas siguen valiendo). Sin cifrado en el original no tiene efecto. Por defecto `false`.
   */
  readonly keepEncryption?: boolean;
  /** ISO 8601: fechas de `/Info` (ya presentes en el original) y semilla de `/ID` nuevo. */
  readonly now: string;
  readonly signal?: AbortSignal;
  /** Objetos escritos y objetos alcanzados hasta ahora; cada 1 000 objetos y al final. */
  readonly onProgress?: (done: number, total: number) => void;
}

export interface RewriteOutput {
  readonly bytes: Uint8Array;
  /** Número de objetos del fichero escrito (sin contar el `/Encrypt`). */
  readonly objects: number;
}

/** Números fijos de la salida: el catálogo es el primer objeto descubierto desde `/Root`. */
const CATALOG_NUM = 1;
const PROGRESS_EVERY = 1000;
/** Profundidad máxima de valores directos anidados; más de eso es un fichero dañado. */
const MAX_DEPTH = 100;
const FILE_SEED_SUFFIX = 'rewrite';

/** Objeto pendiente de copiar: número nuevo y valor tal cual leído (sin renumerar aún). */
interface Pending {
  readonly num: number;
  readonly value: PdfValue;
}

/** Renumera y copia los objetos alcanzables; cada referencia descubierta se pone en la cola una sola vez. */
class Renumberer {
  /** `"num gen"` del original → número nuevo. */
  private readonly numbers = new Map<string, number>();
  /** `"num gen"` de referencias que no apuntan a ningún objeto (libre, inexistente o de otra generación). */
  private readonly missing = new Set<string>();
  readonly queue: Pending[] = [];
  private nextNum = CATALOG_NUM;
  private readonly reader: ObjectReader;

  constructor(reader: ObjectReader) {
    this.reader = reader;
  }

  /** Objetos reservados hasta ahora. */
  get count(): number {
    return this.nextNum - 1;
  }

  /** Número nuevo de la referencia `r`, o `null` si es `/Encrypt` o no apunta a un objeto. */
  async refTo(r: PdfRef): Promise<PdfRef | null> {
    if (r.num === this.reader.encryptRef?.num) return null;
    const key = `${r.num} ${r.gen}`;
    const known = this.numbers.get(key);
    if (known !== undefined) return ref(known);
    if (this.missing.has(key)) return null;
    const value = await this.reader.get(r);
    if (value === null) {
      this.missing.add(key);
      return null;
    }
    const num = this.allocate(value);
    this.numbers.set(key, num);
    return ref(num);
  }

  /** Reserva un número nuevo para `value` y lo pone en la cola. */
  private allocate(value: PdfValue): number {
    const num = this.nextNum;
    this.nextNum += 1;
    this.queue.push({ num, value });
    return num;
  }

  /** Copia de `v` con sus referencias renumeradas. Los flujos reciben `/Length` = tamaño de sus datos. */
  async remap(v: PdfValue, depth = 0): Promise<PdfValue> {
    if (depth > MAX_DEPTH) throw new PdfSyntaxError('nesting-too-deep', 0);
    if (v === null || typeof v !== 'object') return v;
    if (isArrayValue(v)) {
      const items: PdfValue[] = [];
      for (const item of v) items.push(await this.remap(item, depth + 1));
      return items;
    }
    switch (v.kind) {
      case 'ref':
        return this.refTo(v);
      case 'dict':
        return this.remapDict(v, depth);
      case 'stream': {
        const dict = await this.remapDict(withEntries(v.dict, { Length: undefined }), depth);
        return { kind: 'stream', dict: withEntries(dict, { Length: v.data.length }), data: v.data };
      }
      case 'string':
      case 'name':
        return v;
    }
  }

  private async remapDict(d: PdfDict, depth: number): Promise<PdfDict> {
    const entries = new Map<string, PdfValue>();
    for (const [key, value] of d.entries) entries.set(key, await this.remap(value, depth + 1));
    return { kind: 'dict', entries };
  }
}

/** Escribe un PDF nuevo con solo los objetos alcanzables desde `/Root` e `/Info`. Un único fichero completo. */
export async function rewriteDocument(input: RewriteInput): Promise<Result<RewriteOutput>> {
  try {
    return await writeRewritten(input);
  } catch (error: unknown) {
    return err(toSaveError(error));
  }
}

async function writeRewritten(input: RewriteInput): Promise<Result<RewriteOutput>> {
  const { reader, signal, onProgress } = input;
  // Función: TypeScript no sigue `signal.aborted` a través de los `await` (estrechamiento obsoleto).
  const aborted = (): boolean => signal?.aborted === true;
  if (aborted()) return err(pdfError('cancelled'));
  const trailer = reader.xref.trailer;
  const rootOriginal = dictGet(trailer, 'Root');
  if (!isRef(rootOriginal)) return err(pdfError('save-unreadable'));

  const renum = new Renumberer(reader);
  const root = await renum.refTo(rootOriginal);
  if (root === null) return err(pdfError('save-unreadable'));
  const infoOriginal = dictGet(trailer, 'Info');
  const info = isRef(infoOriginal) ? await renum.refTo(infoOriginal) : null;

  const encryption = await encryptionFor(input);
  if (!encryption.ok) return encryption;

  const objects: (readonly [number, PdfValue])[] = [];
  for (let i = 0; i < renum.queue.length; i++) {
    if (aborted()) return err(pdfError('cancelled'));
    const pending = queueAt(renum.queue, i);
    const original = pending.num === CATALOG_NUM ? withoutPerms(pending.value) : pending.value;
    objects.push([pending.num, await renum.remap(original)]);
    if (onProgress !== undefined && objects.length % PROGRESS_EVERY === 0) onProgress(objects.length, renum.count);
  }
  onProgress?.(objects.length, renum.count);

  const seed = `${input.now}|${FILE_SEED_SUFFIX}|${renum.count}`;
  const id0 = originalId0(trailer);
  const bytes = writeCompleteFile({
    objects,
    root: ref(root.num),
    ...(info === null ? {} : { info }),
    ...(id0 === undefined ? {} : { id0 }),
    seed,
    ...(encryption.value === null ? {} : { encryption: encryption.value }),
  });
  return ok({ bytes, objects: renum.count });
}

/** Cifrado de la salida: el nuevo, el del original si se conserva, o ninguno. */
async function encryptionFor(input: RewriteInput): Promise<Result<FileEncryption | null>> {
  const { reader, encryption } = input;
  if (encryption !== null) {
    const created = createAes256Security(encryption);
    return ok({ handler: created.handler, encrypt: created.encrypt, random: encryption.random });
  }
  const handler = reader.security;
  const encryptRef = reader.encryptRef;
  if (input.keepEncryption !== true || handler === null || encryptRef === null) return ok(null);
  const encrypt = await reader.get(encryptRef);
  if (!isDict(encrypt)) return err(pdfError('save-unreadable'));
  return ok({ handler, encrypt, random: reader.random });
}

/** Elemento `i` de la cola, que existe por construcción (lanza si no: bug). */
function queueAt(queue: readonly Pending[], i: number): Pending {
  const item = queue[i];
  if (item === undefined) throw new RangeError(`cola de reescritura: índice ${i} fuera de rango (bug)`);
  return item;
}

/** Catálogo sin `/Perms`: los permisos de uso (`UR3`) y la certificación (`DocMDP`) dejan de valer al reescribir. */
function withoutPerms(value: PdfValue): PdfValue {
  return isDict(value) ? withEntries(value, { Perms: undefined }) : value;
}

/** `/ID` original: su primer elemento como bytes, si existe. */
function originalId0(trailer: PdfDict): Uint8Array | undefined {
  const id = dictGet(trailer, 'ID');
  if (!isArrayValue(id)) return undefined;
  const first = id[0];
  return isString(first) ? first.bytes : undefined;
}

function isArrayValue(v: PdfValue | undefined): v is readonly PdfValue[] {
  return Array.isArray(v);
}

function isRef(v: PdfValue | undefined): v is PdfRef {
  return typeof v === 'object' && v !== null && 'kind' in v && v.kind === 'ref';
}

function isString(v: PdfValue | undefined): v is PdfString {
  return typeof v === 'object' && v !== null && 'kind' in v && v.kind === 'string';
}

function isDict(v: PdfValue | undefined): v is PdfDict {
  return typeof v === 'object' && v !== null && 'kind' in v && v.kind === 'dict';
}
