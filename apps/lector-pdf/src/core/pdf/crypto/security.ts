/**
 * Manejador de seguridad estándar de PDF (ISO 32000-1 §7.6 y ISO 32000-2 §7.6.4): obtiene la clave
 * del fichero a partir de `/Encrypt`, `/ID` y una contraseña, y cifra o descifra cadenas y flujos.
 * Cubre RC4 de 40 a 128 bits (R2-R3), RC4 y AES-128 (R4, `/V 4`) y AES-256 (R5 y R6, `/V 5`).
 * Nunca lanza por datos del fichero: lo que no se entiende se devuelve como `unsupported`.
 */
import { cbc } from '@noble/ciphers/aes.js';
import { md5 } from '@noble/hashes/legacy.js';
import { sha256, sha384, sha512 } from '@noble/hashes/sha2.js';
import { dictGet, type PdfDict, type PdfName, type PdfString, type PdfValue } from '../objects';
import { rc4 } from './rc4';

export type CryptMethod = 'none' | 'rc4' | 'aes128' | 'aes256';

export interface SecurityHandler {
  readonly revision: 2 | 3 | 4 | 5 | 6;
  readonly fileKey: Uint8Array;
  readonly stringMethod: CryptMethod;
  readonly streamMethod: CryptMethod;
  readonly encryptMetadata: boolean;
  /** `/P` como entero con signo. */
  readonly permissions: number;
  readonly authenticatedAs: 'user' | 'owner';
}

export type SecurityError = 'unsupported' | 'wrong-password';

/** Relleno de contraseña estándar (ISO 32000-1 §7.6.3.3, alg. 2 paso a). */
const PAD = Uint8Array.from([
  0x28, 0xbf, 0x4e, 0x5e, 0x4e, 0x75, 0x8a, 0x41, 0x64, 0x00, 0x4e, 0x56, 0xff, 0xfa, 0x01, 0x08, 0x2e, 0x2e, 0x00, 0xb6, 0xd0, 0x68,
  0x3e, 0x80, 0x2f, 0x0c, 0xa9, 0xfe, 0x64, 0x53, 0x69, 0x7a,
]);
/** Sal que AES-128 añade a la clave por objeto (alg. 1). */
const AES_SALT = Uint8Array.from([0x73, 0x41, 0x6c, 0x54]);
const AES_BLOCK = 16;
const EMPTY = new Uint8Array(0);

/** Parámetros del diccionario `/Encrypt` ya validados. */
interface EncryptParams {
  readonly revision: 2 | 3 | 4 | 5 | 6;
  /** Longitud de la clave del fichero en bytes. */
  readonly keyLength: number;
  readonly o: Uint8Array;
  readonly u: Uint8Array;
  readonly oe: Uint8Array;
  readonly ue: Uint8Array;
  readonly p: number;
  readonly stringMethod: CryptMethod;
  readonly streamMethod: CryptMethod;
  readonly encryptMetadata: boolean;
}

interface Authentication {
  readonly key: Uint8Array;
  readonly as: 'user' | 'owner';
}

/**
 * Prueba la contraseña como usuario y, si falla, como propietario.
 * `unsupported` si el diccionario usa un filtro, versión o método que no implementamos.
 */
export function openSecurity(
  encrypt: PdfDict,
  id0: Uint8Array,
  password: string,
): { ok: true; value: SecurityHandler } | { ok: false; error: SecurityError } {
  const params = readParams(encrypt);
  if (params === null) return { ok: false, error: 'unsupported' };
  const auth = authenticate(params, id0, password);
  if (auth === null) return { ok: false, error: 'wrong-password' };
  return {
    ok: true,
    value: {
      revision: params.revision,
      fileKey: auth.key,
      stringMethod: params.stringMethod,
      streamMethod: params.streamMethod,
      encryptMetadata: params.encryptMetadata,
      permissions: params.p,
      authenticatedAs: auth.as,
    },
  };
}

/** Descifra una cadena (`kind: 'string'`) o un flujo (`'stream'`) del objeto `num gen`. */
export function decryptBytes(h: SecurityHandler, kind: 'string' | 'stream', num: number, gen: number, data: Uint8Array): Uint8Array {
  const method = kind === 'string' ? h.stringMethod : h.streamMethod;
  if (method === 'none') return data.slice();
  if (method === 'rc4') return rc4(objectKey(h, method, num, gen), data);
  return aesDecrypt(objectKey(h, method, num, gen), data);
}

/**
 * Cifra una cadena o un flujo del objeto `num gen`. Con AES, el IV de 16 bytes sale de `random`
 * (debe devolver exactamente 16 bytes); con el mismo `random`, el resultado es determinista.
 */
export function encryptBytes(
  h: SecurityHandler,
  kind: 'string' | 'stream',
  num: number,
  gen: number,
  data: Uint8Array,
  random: (n: number) => Uint8Array,
): Uint8Array {
  const method = kind === 'string' ? h.stringMethod : h.streamMethod;
  if (method === 'none') return data.slice();
  if (method === 'rc4') return rc4(objectKey(h, method, num, gen), data);
  const iv = random(AES_BLOCK);
  if (iv.length !== AES_BLOCK) throw new RangeError(`encryptBytes: el IV debe tener ${AES_BLOCK} bytes (tiene ${iv.length})`);
  const padLength = AES_BLOCK - (data.length % AES_BLOCK);
  const padded = concat(data, new Uint8Array(padLength).fill(padLength));
  const body = cbc(objectKey(h, method, num, gen), iv, { disablePadding: true }).encrypt(padded);
  return concat(iv, body);
}

// ---------------------------------------------------------------------------------------------
// Lectura de /Encrypt
// ---------------------------------------------------------------------------------------------

function readParams(encrypt: PdfDict): EncryptParams | null {
  if (getName(encrypt, 'Filter') !== 'Standard') return null;
  const version = getNumber(encrypt, 'V') ?? 0;
  const revision = getNumber(encrypt, 'R');
  const o = getBytes(encrypt, 'O');
  const u = getBytes(encrypt, 'U');
  const p = getNumber(encrypt, 'P');
  if (revision === undefined || !isRevision(revision) || o === undefined || u === undefined || p === undefined) return null;
  const encryptMetadata = getBoolean(encrypt, 'EncryptMetadata') ?? true;
  const common = { p: p | 0, encryptMetadata };

  if (revision >= 5) {
    const oe = getBytes(encrypt, 'OE');
    const ue = getBytes(encrypt, 'UE');
    if (version !== 5 || oe === undefined || ue === undefined) return null;
    if (o.length < 48 || u.length < 48 || oe.length !== 32 || ue.length !== 32) return null;
    return withMethods(encrypt, { ...common, revision, keyLength: 32, o, u, oe, ue }, 5);
  }

  if (o.length < 32 || u.length < 32) return null;
  if (version === 1 || version === 2) {
    if (version === 1 && revision !== 2) return null;
    if (version === 2 && revision !== 2 && revision !== 3) return null;
    const bits = getNumber(encrypt, 'Length') ?? 40;
    if (!Number.isInteger(bits) || bits % 8 !== 0 || bits < 40 || bits > 128) return null;
    return { ...common, revision, keyLength: bits / 8, o, u, oe: EMPTY, ue: EMPTY, stringMethod: 'rc4', streamMethod: 'rc4' };
  }
  if (version === 4 && revision === 4) {
    return withMethods(encrypt, { ...common, revision, keyLength: 16, o, u, oe: EMPTY, ue: EMPTY }, 4);
  }
  return null;
}

/** Añade los métodos de `/StmF` y `/StrF` (por defecto `Identity`). `null` si alguno no se soporta. */
function withMethods(
  encrypt: PdfDict,
  base: Omit<EncryptParams, 'stringMethod' | 'streamMethod'>,
  version: 4 | 5,
): EncryptParams | null {
  const streamMethod = cryptMethodOf(encrypt, getName(encrypt, 'StmF') ?? 'Identity', version);
  const stringMethod = cryptMethodOf(encrypt, getName(encrypt, 'StrF') ?? 'Identity', version);
  if (streamMethod === null || stringMethod === null) return null;
  return { ...base, stringMethod, streamMethod };
}

/** Método de un filtro de `/CF`. `Identity` no cifra. `null` si no lo soportamos. */
function cryptMethodOf(encrypt: PdfDict, filter: string, version: 4 | 5): CryptMethod | null {
  if (filter === 'Identity') return 'none';
  const cf = getDict(encrypt, 'CF');
  const entry = cf === undefined ? undefined : getDict(cf, filter);
  const cfm = entry === undefined ? undefined : getName(entry, 'CFM');
  if (version === 4 && cfm === 'V2') return 'rc4';
  if (version === 4 && cfm === 'AESV2') return 'aes128';
  if (version === 5 && cfm === 'AESV3') return 'aes256';
  return null;
}

function isRevision(r: number): r is 2 | 3 | 4 | 5 | 6 {
  return r === 2 || r === 3 || r === 4 || r === 5 || r === 6;
}

function getName(d: PdfDict, key: string): string | undefined {
  const v = dictGet(d, key);
  return isNameValue(v) ? v.value : undefined;
}

function getNumber(d: PdfDict, key: string): number | undefined {
  const v = dictGet(d, key);
  return typeof v === 'number' ? v : undefined;
}

function getBoolean(d: PdfDict, key: string): boolean | undefined {
  const v = dictGet(d, key);
  return typeof v === 'boolean' ? v : undefined;
}

function getBytes(d: PdfDict, key: string): Uint8Array | undefined {
  const v = dictGet(d, key);
  return isStringValue(v) ? v.bytes : undefined;
}

function getDict(d: PdfDict, key: string): PdfDict | undefined {
  const v = dictGet(d, key);
  return isDictValue(v) ? v : undefined;
}

function isNameValue(v: PdfValue | undefined): v is PdfName {
  return typeof v === 'object' && v !== null && !Array.isArray(v) && 'kind' in v && v.kind === 'name';
}

function isStringValue(v: PdfValue | undefined): v is PdfString {
  return typeof v === 'object' && v !== null && !Array.isArray(v) && 'kind' in v && v.kind === 'string';
}

function isDictValue(v: PdfValue | undefined): v is PdfDict {
  return typeof v === 'object' && v !== null && !Array.isArray(v) && 'kind' in v && v.kind === 'dict';
}

// ---------------------------------------------------------------------------------------------
// Autenticación
// ---------------------------------------------------------------------------------------------

function authenticate(p: EncryptParams, id0: Uint8Array, password: string): Authentication | null {
  if (p.revision >= 5) return authenticateAes256(p, password);
  const pad = padPassword(password);
  const direct = legacyFileKey(p, id0, pad);
  if (checkLegacyUser(p, id0, direct)) return { key: direct, as: 'user' };
  const recovered = recoverUserPasswordLegacy(p, pad);
  const viaOwner = legacyFileKey(p, id0, recovered);
  if (checkLegacyUser(p, id0, viaOwner)) return { key: viaOwner, as: 'owner' };
  return null;
}

/** Contraseña en Latin-1 (los caracteres fuera de Latin-1 pasan a `?`), cortada a 32 y completada con `PAD`. */
function padPassword(password: string): Uint8Array {
  const out = new Uint8Array(32);
  const n = Math.min(password.length, 32);
  for (let i = 0; i < n; i++) {
    const code = password.charCodeAt(i);
    out[i] = code > 0xff ? 0x3f : code;
  }
  out.set(PAD.subarray(0, 32 - n), n);
  return out;
}

/** Clave del fichero desde la contraseña ya rellenada (ISO 32000-1 alg. 2). */
function legacyFileKey(p: EncryptParams, id0: Uint8Array, padded: Uint8Array): Uint8Array {
  const pBytes = new Uint8Array(4);
  new DataView(pBytes.buffer).setInt32(0, p.p, true);
  const parts: Uint8Array[] = [padded, p.o.subarray(0, 32), pBytes, id0];
  if (p.revision >= 4 && !p.encryptMetadata) parts.push(Uint8Array.from([0xff, 0xff, 0xff, 0xff]));
  let h = md5(concat(...parts));
  if (p.revision >= 3) {
    for (let i = 0; i < 50; i++) h = md5(h.subarray(0, p.keyLength));
  }
  return h.slice(0, p.keyLength);
}

/** Comprueba la clave contra `/U` (alg. 4 para R2, alg. 5 para R3-R4). */
function checkLegacyUser(p: EncryptParams, id0: Uint8Array, key: Uint8Array): boolean {
  if (p.revision === 2) return equalBytes(rc4(key, PAD), p.u.subarray(0, 32));
  let x = rc4(key, md5(concat(PAD, id0)));
  for (let i = 1; i <= 19; i++) x = rc4(xorKey(key, i), x);
  return equalBytes(x.subarray(0, 16), p.u.subarray(0, 16));
}

/** Recupera la contraseña de usuario (32 bytes rellenos) desde la de propietario (alg. 7). */
function recoverUserPasswordLegacy(p: EncryptParams, ownerPadded: Uint8Array): Uint8Array {
  let h = md5(ownerPadded);
  if (p.revision >= 3) {
    for (let i = 0; i < 50; i++) h = md5(h.subarray(0, p.keyLength));
  }
  const okey = h.slice(0, p.keyLength);
  if (p.revision === 2) return rc4(okey, p.o.subarray(0, 32));
  let x: Uint8Array = p.o.slice(0, 32);
  for (let i = 19; i >= 0; i--) x = rc4(xorKey(okey, i), x);
  return x;
}

/** AES-256 (R5 y R6): usuario primero, después propietario (ISO 32000-2 alg. 2.A). */
function authenticateAes256(p: EncryptParams, password: string): Authentication | null {
  const pw = saslPrep(password);
  const u = p.u;
  const o = p.o;
  if (equalBytes(hashAes256(p.revision, pw, u.subarray(32, 40), EMPTY), u.subarray(0, 32))) {
    const ik = hashAes256(p.revision, pw, u.subarray(40, 48), EMPTY);
    return { key: decryptFileKey(ik, p.ue), as: 'user' };
  }
  const udata = u.subarray(0, 48);
  if (equalBytes(hashAes256(p.revision, pw, o.subarray(32, 40), udata), o.subarray(0, 32))) {
    const ik = hashAes256(p.revision, pw, o.subarray(40, 48), udata);
    return { key: decryptFileKey(ik, p.oe), as: 'owner' };
  }
  return null;
}

/** Contraseña UTF-8 (NFKC como aproximación de SASLprep), máximo 127 bytes. */
export function saslPrep(password: string): Uint8Array {
  return new TextEncoder().encode(password.normalize('NFKC')).slice(0, 127);
}

function decryptFileKey(ik: Uint8Array, encrypted: Uint8Array): Uint8Array {
  return cbc(ik, new Uint8Array(AES_BLOCK), { disablePadding: true }).decrypt(encrypted);
}

/** Hash de R5 (SHA-256) o R6 (alg. 2.B). Devuelve 32 bytes. */
export function hashAes256(revision: 2 | 3 | 4 | 5 | 6, password: Uint8Array, salt: Uint8Array, udata: Uint8Array): Uint8Array {
  if (revision === 5) return sha256(concat(password, salt, udata));
  let k = sha256(concat(password, salt, udata));
  for (let round = 1; ; round++) {
    const unit = concat(password, k, udata);
    const k1 = new Uint8Array(unit.length * 64);
    for (let i = 0; i < 64; i++) k1.set(unit, i * unit.length);
    const e = cbc(k.subarray(0, 16), k.subarray(16, 32), { disablePadding: true }).encrypt(k1);
    // Los 16 primeros bytes como entero sin signo módulo 3 equivale a su suma módulo 3 (256 ≡ 1).
    let sum = 0;
    for (let i = 0; i < 16; i++) sum += e[i] ?? 0;
    const m = sum % 3;
    k = m === 0 ? sha256(e) : m === 1 ? sha384(e) : sha512(e);
    if (round >= 64 && (e[e.length - 1] ?? 0) <= round - 32) return k.slice(0, 32);
  }
}

// ---------------------------------------------------------------------------------------------
// Claves por objeto y AES
// ---------------------------------------------------------------------------------------------

/** Clave de cada objeto (alg. 1). AES-256 usa la clave del fichero tal cual. */
function objectKey(h: SecurityHandler, method: CryptMethod, num: number, gen: number): Uint8Array {
  if (method === 'aes256') return h.fileKey;
  const material = concat(
    h.fileKey,
    Uint8Array.from([num & 0xff, (num >> 8) & 0xff, (num >> 16) & 0xff, gen & 0xff, (gen >> 8) & 0xff]),
    method === 'aes128' ? AES_SALT : EMPTY,
  );
  return md5(material).slice(0, Math.min(h.fileKey.length + 5, 16));
}

/** IV de 16 bytes al principio; relleno PKCS#7 que, si es inválido, se deja tal cual (los visores son tolerantes). */
function aesDecrypt(key: Uint8Array, data: Uint8Array): Uint8Array {
  if (data.length < 2 * AES_BLOCK) return new Uint8Array(0);
  const iv = data.subarray(0, AES_BLOCK);
  const usable = Math.floor((data.length - AES_BLOCK) / AES_BLOCK) * AES_BLOCK;
  const plain = cbc(key, iv, { disablePadding: true }).decrypt(data.subarray(AES_BLOCK, AES_BLOCK + usable));
  return removePadding(plain);
}

function removePadding(plain: Uint8Array): Uint8Array {
  const last = plain[plain.length - 1] ?? 0;
  if (last < 1 || last > AES_BLOCK || last > plain.length) return plain;
  for (let i = plain.length - last; i < plain.length; i++) {
    if (plain[i] !== last) return plain;
  }
  return plain.subarray(0, plain.length - last);
}

// ---------------------------------------------------------------------------------------------
// Utilidades de bytes
// ---------------------------------------------------------------------------------------------

function concat(...parts: readonly Uint8Array[]): Uint8Array {
  const total = parts.reduce((n, part) => n + part.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

function xorKey(key: Uint8Array, i: number): Uint8Array {
  return key.map((b) => b ^ i);
}

function equalBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}
