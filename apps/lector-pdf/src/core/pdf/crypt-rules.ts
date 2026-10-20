/**
 * Reglas de cifrado de objetos (ISO 32000-2 §7.6.2) compartidas por la lectura (`ObjectReader`) y la
 * escritura (`encryptValue`). Se cifran las cadenas y los datos de los flujos de los objetos de primer
 * nivel, con el número y la generación del objeto que los contiene. No se cifran: el diccionario
 * `/Encrypt`, los *xref streams*, las cadenas de los objetos comprimidos (van cifrados con el flujo
 * entero), el flujo `/Metadata` si `EncryptMetadata` es `false` y los flujos con el filtro `/Crypt`
 * de nombre `/Identity`.
 */
import { decryptBytes, type SecurityHandler } from './crypto';
import { dictGet, withEntries, type PdfDict, type PdfValue } from './objects';

/** Transformación de los bytes de una cadena (`'string'`) o de los datos de un flujo (`'stream'`). */
export type ByteTransform = (kind: 'string' | 'stream', data: Uint8Array) => Uint8Array;

/** Generador de bytes aleatorios (IV de AES). Debe devolver exactamente los `n` bytes pedidos. */
export type RandomBytes = (n: number) => Uint8Array;

/** Generador criptográfico por defecto. */
export const secureRandom: RandomBytes = (n) => crypto.getRandomValues(new Uint8Array(n));

/** `true` si los datos del flujo `d` no se cifran con `h`. */
export function streamIsPlain(d: PdfDict, h: SecurityHandler): boolean {
  const type = dictGet(d, 'Type');
  if (isNamed(type, 'XRef')) return true;
  if (!h.encryptMetadata && isNamed(type, 'Metadata')) return true;
  return isIdentityCrypt(d);
}

/** Descifra las cadenas y los datos de los flujos de un objeto de primer nivel `num gen`. */
export function decryptValue(h: SecurityHandler, num: number, gen: number, v: PdfValue): PdfValue {
  return transformObject(v, (d) => streamIsPlain(d, h), (kind, data) => decryptBytes(h, kind, num, gen, data));
}

/**
 * Copia de `v` con sus cadenas transformadas. Los datos de los flujos se transforman salvo que
 * `plain(dict)` sea `true`; en los transformados, `/Length` pasa a ser el tamaño de los datos nuevos.
 */
export function transformObject(v: PdfValue, plain: (d: PdfDict) => boolean, transform: ByteTransform): PdfValue {
  if (v === null || typeof v !== 'object') return v;
  if (isArrayValue(v)) return v.map((item) => transformObject(item, plain, transform));
  switch (v.kind) {
    case 'string':
      return { kind: 'string', bytes: transform('string', v.bytes), hex: v.hex };
    case 'dict':
      return transformDict(v, plain, transform);
    case 'stream': {
      const dict = transformDict(v.dict, plain, transform);
      if (plain(v.dict)) return { kind: 'stream', dict, data: v.data };
      const data = transform('stream', v.data);
      return { kind: 'stream', dict: withEntries(dict, { Length: data.length }), data };
    }
    default:
      return v;
  }
}

function transformDict(d: PdfDict, plain: (d: PdfDict) => boolean, transform: ByteTransform): PdfDict {
  const entries = new Map<string, PdfValue>();
  for (const [key, value] of d.entries) entries.set(key, transformObject(value, plain, transform));
  return { kind: 'dict', entries };
}

/** `/Filter /Crypt` (primer filtro) con `/Name /Identity` (o sin nombre, que vale `/Identity`). */
function isIdentityCrypt(d: PdfDict): boolean {
  const filter = dictGet(d, 'Filter');
  const first = isArrayValue(filter) ? filter[0] : filter;
  if (!isNamed(first, 'Crypt')) return false;
  const parms = dictGet(d, 'DecodeParms');
  const p = isArrayValue(parms) ? parms[0] : parms;
  if (typeof p !== 'object' || p === null || !('kind' in p) || p.kind !== 'dict') return true;
  const cryptName = dictGet(p, 'Name');
  return cryptName === undefined || isNamed(cryptName, 'Identity');
}

function isNamed(v: PdfValue | undefined, value: string): boolean {
  return typeof v === 'object' && v !== null && !Array.isArray(v) && 'kind' in v && v.kind === 'name' && v.value === value;
}

function isArrayValue(v: PdfValue | undefined): v is readonly PdfValue[] {
  return Array.isArray(v);
}
