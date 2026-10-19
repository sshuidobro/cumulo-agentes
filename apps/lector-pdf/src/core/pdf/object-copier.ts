/**
 * Copia de páginas y de los objetos que alcanzan, de un PDF de origen a números nuevos (ISO 32000-1
 * §7.7.3.4, §12.3.2 y §12.5; ADR-0028). Es la base de extraer, dividir, combinar e insertar: nunca arrastra el
 * resto del documento y nunca decodifica flujos (se copian con su `/Filter`).
 */
import type { ObjectReader } from './object-reader';
import { dict, dictGet, PdfSyntaxError, withEntries, type PdfDict, type PdfName, type PdfRef, type PdfStream, type PdfString, type PdfValue } from './objects';
import { resolveNamedDest } from './name-tree';

export interface CopiedPage {
  readonly ref: PdfRef;
  /** Diccionario sin `/Parent`, aún no escrito. */
  readonly dict: PdfDict;
}

export interface CopierOptions {
  readonly from: ObjectReader;
  /** Asigna números nuevos (p. ej. un contador desde 1). */
  readonly alloc: () => PdfRef;
  /**
   * Convierte los destinos con nombre en destinos explícitos (PDF-122): `/Dest` de anotaciones y `/D` de acciones
   * `GoTo`. Por defecto `false`: los valores se copian tal cual.
   */
  readonly resolveNames?: boolean;
}

/** Profundidad máxima de valores directos anidados dentro de un mismo objeto. */
const MAX_DEPTH = 100;
/** Antecesores `/Parent` que se recorren al buscar atributos heredados. */
const MAX_ANCESTORS = 64;
/** Atributos heredables (ISO 32000-1 §7.7.3.4) que se copian explícitamente a la página. */
const INHERITED_KEYS = ['Resources', 'MediaBox', 'CropBox', 'Rotate'] as const;
/** Claves de página que no se copian: el padre se reconstruye al escribir; los artículos y la estructura no. */
const PAGE_OMIT: readonly string[] = ['Parent', 'B', 'StructParents'];

/** `annot`: el diccionario es una anotación (sus `/P` y `/StructParent` se tratan aparte). */
type Role = 'plain' | 'annot';

interface Pending {
  readonly ref: PdfRef;
  /** Valor ya leído del origen (se lee una sola vez, al descubrir la referencia). */
  readonly value: PdfValue;
  readonly role: Role;
}

interface ReservedPage {
  readonly source: PdfRef;
  readonly ref: PdfRef;
}

export class ObjectCopier {
  private readonly from: ObjectReader;
  private readonly alloc: () => PdfRef;
  private readonly resolveNames: boolean;
  /** Páginas reservadas: número de objeto de origen → ref nueva. */
  private readonly reservedNums = new Map<number, PdfRef>();
  /** Páginas reservadas por índice (base 0) del origen. */
  private readonly reservedByIndex = new Map<number, ReservedPage>();
  /** Objetos no página ya descubiertos: número de origen → ref nueva, o `null` si no se copian. */
  private readonly memo = new Map<number, PdfRef | null>();
  /** Pila explícita de objetos indirectos pendientes de transformar. */
  private readonly pending: Pending[] = [];
  private readonly out: (readonly [PdfRef, PdfValue])[] = [];
  private readonly copiedPages = new Map<number, CopiedPage>();

  constructor(o: CopierOptions) {
    this.from = o.from;
    this.alloc = o.alloc;
    this.resolveNames = o.resolveNames === true;
  }

  /**
   * Reserva el número de cada página que se va a copiar (por índice 0-based del origen). Debe llamarse con
   * TODAS las páginas antes de `copyPage`, para que los enlaces entre ellas se remapeen.
   */
  async reservePages(indices: readonly number[]): Promise<ReadonlyMap<number, PdfRef>> {
    const result = new Map<number, PdfRef>();
    for (const index of indices) {
      const existing = this.reservedByIndex.get(index);
      if (existing !== undefined) {
        result.set(index, existing.ref);
        continue;
      }
      const source = await this.from.pageRef(index);
      const ref = this.reservedNums.get(source.num) ?? this.alloc();
      this.reservedNums.set(source.num, ref);
      this.reservedByIndex.set(index, { source, ref });
      result.set(index, ref);
    }
    return result;
  }

  /** Copia la página `index` (ya reservada). Devuelve su diccionario listo para recibir `/Parent`. */
  async copyPage(index: number): Promise<CopiedPage> {
    const cached = this.copiedPages.get(index);
    if (cached !== undefined) return cached;
    const reservation = this.reservedByIndex.get(index);
    if (reservation === undefined) throw new Error(`la página ${index} no está reservada`);

    const page = await this.from.getDict(reservation.source);
    if (page === null) throw new PdfSyntaxError(`página ${index} no legible`, 0);

    const entries = new Map<string, PdfValue>();
    for (const [key, value] of page.entries) {
      if (PAGE_OMIT.includes(key)) continue;
      entries.set(key, key === 'Annots' ? await this.copyAnnots(value) : await this.copyValue(value, 0));
    }

    const ancestors = await this.ancestorsOf(page);
    for (const key of INHERITED_KEYS) {
      if (entries.has(key)) continue;
      const inherited = await this.from.resolve(firstDefined(ancestors, key));
      if (inherited !== undefined) entries.set(key, await this.copyValue(inherited, 0));
    }

    const copied: CopiedPage = { ref: reservation.ref, dict: dict(entries) };
    this.copiedPages.set(index, copied);
    await this.flush();
    return copied;
  }

  /** Objetos copiados (no páginas) en orden de copia: [ref, valor]. Se vacía con `drain()`. */
  drain(): readonly (readonly [PdfRef, PdfValue])[] {
    return this.out.splice(0);
  }

  /** Número nuevo reservado con el mismo asignador que las copias (p. ej. para nodos de índice). */
  allocRef(): PdfRef {
    return this.alloc();
  }

  /**
   * Copia un valor directo (con las referencias que alcance) y vacía los objetos pendientes. Lo usan el índice y
   * otros valores que no son páginas: los objetos que salen quedan en `drain()`.
   */
  async copyDirect(value: PdfValue): Promise<PdfValue> {
    const copied = await this.copyValue(value, 0);
    await this.flush();
    return copied;
  }

  /**
   * Destino con nombre del origen como destino explícito con la página remapeada: `undefined` si el nombre no
   * existe; `null` en la primera posición si la página no se copió.
   */
  async namedDestValue(key: PdfString | PdfName): Promise<PdfValue | undefined> {
    const dest = await resolveNamedDest(this.from, key);
    if (dest === null || dest.length === 0) return undefined;
    const [page, ...rest] = dest;
    const copied: PdfValue[] = [this.remapPage(page)];
    for (const item of rest) copied.push(await this.copyValue(item, 0));
    await this.flush();
    return copied;
  }

  /** Ref nueva de un objeto ya copiado del origen (por número), o undefined. */
  mapped(sourceNum: number): PdfRef | undefined {
    return this.memo.get(sourceNum) ?? undefined;
  }

  /** `/Annots` de la página: cada elemento es una anotación. Se devuelve como array directo. */
  private async copyAnnots(value: PdfValue): Promise<PdfValue> {
    const list = await this.from.resolve(value);
    if (!Array.isArray(list)) return this.copyValue(value, 0);
    const out: PdfValue[] = [];
    for (const item of list) out.push(await this.copyRoleValue(item, 1, 'annot'));
    return out;
  }

  /** Antecesores de la página por `/Parent`, del más cercano a la raíz (máximo 64). */
  private async ancestorsOf(page: PdfDict): Promise<readonly PdfDict[]> {
    const chain: PdfDict[] = [];
    const seen = new Set<number>();
    let parent = dictGet(page, 'Parent');
    while (isRef(parent) && chain.length < MAX_ANCESTORS && !seen.has(parent.num)) {
      seen.add(parent.num);
      const node = await this.from.getDict(parent);
      if (node === null) break;
      chain.push(node);
      parent = dictGet(node, 'Parent');
    }
    return chain;
  }

  /** Página del destino explícito: su ref nueva si se copió; `null` si no. */
  private remapPage(v: PdfValue | undefined): PdfValue {
    if (isRef(v)) {
      const mapped = this.reservedNums.get(v.num);
      if (mapped !== undefined) return mapped;
    }
    return null;
  }

  private copyValue(v: PdfValue, depth: number): Promise<PdfValue> {
    return this.copyRoleValue(v, depth, 'plain');
  }

  /** Copia un valor directo o una referencia; `role` solo aplica al propio valor. */
  private async copyRoleValue(v: PdfValue, depth: number, role: Role): Promise<PdfValue> {
    if (depth > MAX_DEPTH) throw new PdfSyntaxError('demasiados niveles de anidamiento', 0);
    if (isRef(v)) return this.copyRef(v, role);
    if (Array.isArray(v)) {
      const out: PdfValue[] = [];
      for (const item of v) out.push(await this.copyRoleValue(item, depth + 1, 'plain'));
      return out;
    }
    if (isDict(v)) return this.copyDict(v, depth, role, []);
    return v;
  }

  /** Copia un valor referenciado: páginas, referencias a objetos inexistentes y `null` según la regla. */
  private async copyRef(r: PdfRef, role: Role): Promise<PdfValue> {
    const reserved = this.reservedNums.get(r.num);
    if (reserved !== undefined) return reserved;
    const known = this.memo.get(r.num);
    if (known !== undefined) return known;

    const value = await this.from.get(r);
    if (value === null || isPageLike(value)) {
      this.memo.set(r.num, null);
      return null;
    }
    const ref = this.alloc();
    this.memo.set(r.num, ref);
    this.pending.push({ ref, value, role: role === 'annot' || isAnnotation(value) ? 'annot' : 'plain' });
    return ref;
  }

  private async copyDict(d: PdfDict, depth: number, role: Role, omit: readonly string[]): Promise<PdfDict> {
    const entries = new Map<string, PdfValue>();
    for (const [key, value] of d.entries) {
      if (omit.includes(key)) continue;
      if (role === 'annot') {
        if (key === 'StructParent') continue;
        if (key === 'P') {
          // La página de la anotación solo se conserva si es una página copiada.
          if (isRef(value) && this.reservedNums.has(value.num)) entries.set(key, await this.copyRef(value, 'plain'));
          continue;
        }
      }
      if (this.resolveNames) {
        if (role === 'annot' && key === 'Dest' && isNamedKey(value)) {
          const named = await this.namedDestValue(value);
          if (named !== undefined) entries.set(key, named);
          continue;
        }
        if (key === 'A') {
          const action = await this.copyAction(value, depth);
          if (action !== undefined) entries.set(key, action);
          continue;
        }
      }
      entries.set(key, await this.copyRoleValue(value, depth + 1, 'plain'));
    }
    return dict(entries);
  }

  /**
   * Acción `GoTo` con destino con nombre → la misma acción con destino explícito; si el nombre no existe,
   * `undefined` (la acción se quita). El resto de acciones se copian tal cual.
   */
  private async copyAction(value: PdfValue, depth: number): Promise<PdfValue | undefined> {
    const action = await this.from.resolve(value);
    if (action === undefined || !isDict(action)) return this.copyRoleValue(value, depth + 1, 'plain');
    const target = dictGet(action, 'D');
    if (typeNameOf(dictGet(action, 'S')) !== 'GoTo' || !isNamedKey(target)) return this.copyRoleValue(value, depth + 1, 'plain');
    const named = await this.namedDestValue(target);
    if (named === undefined) return undefined;
    return withEntries(await this.copyDict(action, depth + 1, 'plain', ['D']), { D: named });
  }

  /** Transforma un objeto indirecto ya leído (su `/Length` pasa a ser directo). */
  private async copyIndirect(value: PdfValue, role: Role): Promise<PdfValue> {
    if (isStream(value)) return this.copyStream(value, role);
    if (isDict(value)) return this.copyDict(value, 0, role, []);
    return this.copyValue(value, 0);
  }

  private async copyStream(s: PdfStream, role: Role): Promise<PdfStream> {
    const d = await this.copyDict(s.dict, 0, role, ['Length']);
    return { kind: 'stream', dict: withEntries(d, { Length: s.data.length }), data: s.data };
  }

  /** Vacía la pila de objetos pendientes: cada objeto se copia una sola vez. */
  private async flush(): Promise<void> {
    for (let job = this.pending.pop(); job !== undefined; job = this.pending.pop()) {
      this.out.push([job.ref, await this.copyIndirect(job.value, job.role)]);
    }
  }
}

function firstDefined(ancestors: readonly PdfDict[], key: string): PdfValue | undefined {
  for (const node of ancestors) {
    const value = dictGet(node, key);
    if (value !== undefined) return value;
  }
  return undefined;
}

function isRef(v: PdfValue | undefined): v is PdfRef {
  return typeof v === 'object' && v !== null && !Array.isArray(v) && 'kind' in v && v.kind === 'ref';
}

function isDict(v: PdfValue): v is PdfDict {
  return typeof v === 'object' && v !== null && !Array.isArray(v) && 'kind' in v && v.kind === 'dict';
}

/** Cadena o nombre PDF: clave de un destino con nombre. */
function isNamedKey(v: PdfValue | undefined): v is PdfString | PdfName {
  return typeof v === 'object' && v !== null && !Array.isArray(v) && 'kind' in v && (v.kind === 'name' || v.kind === 'string');
}

/** Valor de un nombre PDF (`/S /GoTo`), o `null` si no es un nombre. */
function typeNameOf(v: PdfValue | undefined): string | null {
  return typeof v === 'object' && v !== null && !Array.isArray(v) && 'kind' in v && v.kind === 'name' ? v.value : null;
}

function isStream(v: PdfValue): v is PdfStream {
  return typeof v === 'object' && v !== null && !Array.isArray(v) && 'kind' in v && v.kind === 'stream';
}

/** Tipo (`/Type`) del diccionario o del diccionario de un flujo, o `null`. */
function typeOf(v: PdfValue): string | null {
  const d = isDict(v) ? v : isStream(v) ? v.dict : null;
  if (d === null) return null;
  const t = dictGet(d, 'Type');
  return typeof t === 'object' && t !== null && !Array.isArray(t) && 'kind' in t && t.kind === 'name' ? t.value : null;
}

function isPageLike(v: PdfValue): boolean {
  const t = typeOf(v);
  return t === 'Page' || t === 'Pages';
}

function isAnnotation(v: PdfValue): boolean {
  return typeOf(v) === 'Annot';
}
