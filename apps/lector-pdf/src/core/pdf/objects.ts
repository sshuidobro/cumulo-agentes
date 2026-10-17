/**
 * Objetos PDF (ISO 32000-1 §7.3). Estructuras inmutables sin lógica de E/S.
 */

export interface PdfName {
  readonly kind: 'name';
  /** Sin la barra y ya decodificado (`#20` → espacio). */
  readonly value: string;
}

export interface PdfString {
  readonly kind: 'string';
  readonly bytes: Uint8Array;
  /** `true` si se escribe en hexadecimal (`<...>`), `false` si es literal (`(...)`). */
  readonly hex: boolean;
}

export interface PdfRef {
  readonly kind: 'ref';
  readonly num: number;
  readonly gen: number;
}

export interface PdfDict {
  readonly kind: 'dict';
  /** Claves sin barra, en orden de inserción. */
  readonly entries: ReadonlyMap<string, PdfValue>;
}

export interface PdfStream {
  readonly kind: 'stream';
  readonly dict: PdfDict;
  /** Datos tal cual están en el fichero (sin decodificar). */
  readonly data: Uint8Array;
}

export type PdfValue =
  | null
  | boolean
  | number
  | PdfName
  | PdfString
  | PdfRef
  | PdfDict
  | PdfStream
  | readonly PdfValue[];

/** Error de sintaxis al leer bytes. Es interno: el borde lo convierte en `AppError`. */
export class PdfSyntaxError extends Error {
  readonly offset: number;

  constructor(message: string, offset: number) {
    super(message);
    this.name = 'PdfSyntaxError';
    this.offset = offset;
  }
}

export function name(v: string): PdfName {
  return { kind: 'name', value: v };
}

export function ref(num: number, gen = 0): PdfRef {
  if (!Number.isInteger(num) || num < 0 || !Number.isInteger(gen) || gen < 0) {
    throw new RangeError(`referencia no válida: ${num} ${gen}`);
  }
  return { kind: 'ref', num, gen };
}

function isReadonlyMap(x: Record<string, PdfValue> | ReadonlyMap<string, PdfValue>): x is ReadonlyMap<string, PdfValue> {
  return x instanceof Map;
}

export function dict(entries: Record<string, PdfValue> | ReadonlyMap<string, PdfValue>): PdfDict {
  const map = isReadonlyMap(entries) ? new Map(entries) : new Map<string, PdfValue>(Object.entries(entries));
  return { kind: 'dict', entries: map };
}

/** Flujo cuyo `/Length` se fija a `data.length`. */
export function stream(d: Record<string, PdfValue>, data: Uint8Array): PdfStream {
  const entries = new Map<string, PdfValue>(Object.entries(d));
  entries.set('Length', data.length);
  return { kind: 'stream', dict: { kind: 'dict', entries }, data };
}

/** Cadena de bytes (copia los bytes). */
export function bytesString(bytes: Uint8Array, hex = false): PdfString {
  return { kind: 'string', bytes: bytes.slice(), hex };
}

export function dictGet(d: PdfDict, key: string): PdfValue | undefined {
  return d.entries.get(key);
}

/**
 * Devuelve un diccionario con los cambios aplicados. `undefined` borra la clave.
 * Las claves existentes conservan su posición; las nuevas se añaden al final.
 */
export function withEntries(d: PdfDict, changes: Record<string, PdfValue | undefined>): PdfDict {
  const entries = new Map<string, PdfValue>(d.entries);
  for (const [key, value] of Object.entries(changes)) {
    if (value === undefined) entries.delete(key);
    else entries.set(key, value);
  }
  return { kind: 'dict', entries };
}
