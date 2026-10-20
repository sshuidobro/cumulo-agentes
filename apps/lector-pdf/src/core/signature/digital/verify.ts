/**
 * Validación de las firmas digitales de un PDF (PDF-138, ADR-0040). Por cada campo `/FT /Sig` con `/V`:
 * comprueba que el `/ByteRange` cubre el documento, que el resumen de los rangos firmados coincide con el
 * `messageDigest` (o con la firma, sin atributos firmados) y que la firma matemática es correcta (RSA con
 * node-forge, ECDSA con WebCrypto). Sin red y sin lista de confianza: la identidad es «no verificada».
 * Lee el original por bloques. Una firma rota no hace fallar el resultado: queda `unknown` con su motivo.
 */
import type { ByteSource } from '@suite/platform';
import { err, ok, type Result } from '@suite/shared';
import { sha1 } from '@noble/hashes/legacy.js';
import { sha256, sha384, sha512 } from '@noble/hashes/sha2.js';
import forge from 'node-forge';
import { pdfError } from '../../errors';
import { parsePdfDate } from '../../pdf-date';
import type { ObjectReader } from '../../pdf/object-reader';
import { dictGet, type PdfDict, type PdfRef, type PdfValue } from '../../pdf/objects';
import { decodeTextString } from '../../pdf/text-string';
import type { CertificateInfo } from './p12';

export type SignatureVerdict = 'valid' | 'invalid' | 'unknown';

export interface SignatureStatus {
  readonly fieldName: string;
  readonly pageIndex: number | null;
  readonly signer: CertificateInfo | null;
  readonly signedAt: string | null;
  readonly reason: string | null;
  readonly location: string | null;
  readonly subFilter: string;
  readonly verdict: SignatureVerdict;
  /** Motivo en español si no es 'valid'. */
  readonly problem: string | null;
  /** Hay bytes después del final del rango firmado (revisiones posteriores). */
  readonly changedAfter: boolean;
}

type Node = forge.asn1.Asn1;

const MSG_RANGE = 'La firma no cubre el documento correctamente.';
const MSG_UNSUPPORTED = 'Tipo de firma no admitido para validar.';
const MSG_MODIFIED = 'El documento se ha modificado después de firmarlo.';
const MSG_INVALID = 'La firma no es válida.';
const MSG_UNREADABLE = 'La estructura de la firma no se puede leer.';
const MSG_NO_CERT = 'No se encuentra el certificado del firmante.';

/** Subfiltros que se validan; el resto (p. ej. `adbe.pkcs7.sha1`) queda `unknown`. */
const VALIDATED_SUBFILTERS: ReadonlySet<string> = new Set(['adbe.pkcs7.detached', 'ETSI.CAdES.detached']);

/** Bytes de blanco que se ignoran al final del fichero (ISO 32000 §7.2.2). */
const PDF_WHITESPACE: ReadonlySet<number> = new Set([0x00, 0x09, 0x0a, 0x0c, 0x0d, 0x20]);

/** Tamaño de cada lectura del original. */
const READ_BLOCK_BYTES = 1024 * 1024;
/** Profundidad máxima del árbol de campos. */
const MAX_FIELD_DEPTH = 32;

const OID_SIGNED_DATA = '1.2.840.113549.1.7.2';
const OID_MESSAGE_DIGEST = '1.2.840.113549.1.9.4';
const OID_EC_PUBLIC_KEY = '1.2.840.10045.2.1';
const OID_COMMON_NAME = '2.5.4.3';
/** Nombres cortos de los atributos del DN (como los da forge en p12.ts). */
const SHORT_NAMES: Readonly<Record<string, string>> = {
  '2.5.4.3': 'CN',
  '2.5.4.4': 'SN',
  '2.5.4.5': 'serialNumber',
  '2.5.4.6': 'C',
  '2.5.4.7': 'L',
  '2.5.4.8': 'ST',
  '2.5.4.10': 'O',
  '2.5.4.11': 'OU',
  '1.2.840.113549.1.9.1': 'emailAddress',
};

interface Hasher {
  update(data: Uint8Array): unknown;
  digest(): Uint8Array;
}

interface HashSpec {
  /** Nombre en WebCrypto (solo ECDSA). */
  readonly subtle: 'SHA-1' | 'SHA-256' | 'SHA-384' | 'SHA-512';
  readonly create: () => Hasher;
}

const HASHES: Readonly<Record<string, HashSpec>> = {
  '1.3.14.3.2.26': { subtle: 'SHA-1', create: () => sha1.create() },
  '2.16.840.1.101.3.4.2.1': { subtle: 'SHA-256', create: () => sha256.create() },
  '2.16.840.1.101.3.4.2.2': { subtle: 'SHA-384', create: () => sha384.create() },
  '2.16.840.1.101.3.4.2.3': { subtle: 'SHA-512', create: () => sha512.create() },
};

const OID_SHA1 = '1.3.14.3.2.26';
const OID_SHA256 = '2.16.840.1.101.3.4.2.1';
const OID_SHA384 = '2.16.840.1.101.3.4.2.2';
const OID_SHA512 = '2.16.840.1.101.3.4.2.3';

/** Algoritmo de firma: `hash` = `null` significa «el del resumen del SignerInfo». */
interface SignatureAlgorithm {
  readonly kind: 'rsa' | 'ecdsa';
  readonly hash: string | null;
}

const SIGNATURE_ALGORITHMS: Readonly<Record<string, SignatureAlgorithm>> = {
  '1.2.840.113549.1.1.1': { kind: 'rsa', hash: null },
  '1.2.840.113549.1.1.5': { kind: 'rsa', hash: OID_SHA1 },
  '1.2.840.113549.1.1.11': { kind: 'rsa', hash: OID_SHA256 },
  '1.2.840.113549.1.1.12': { kind: 'rsa', hash: OID_SHA384 },
  '1.2.840.113549.1.1.13': { kind: 'rsa', hash: OID_SHA512 },
  '1.2.840.10045.4.3.2': { kind: 'ecdsa', hash: OID_SHA256 },
  '1.2.840.10045.4.3.3': { kind: 'ecdsa', hash: OID_SHA384 },
  '1.2.840.10045.4.3.4': { kind: 'ecdsa', hash: OID_SHA512 },
};

/** Curvas EC: nombre WebCrypto y tamaño de cada coordenada en bytes. */
const CURVES: Readonly<Record<string, { readonly name: 'P-256' | 'P-384' | 'P-521'; readonly size: number }>> = {
  '1.2.840.10045.3.1.7': { name: 'P-256', size: 32 },
  '1.3.132.0.34': { name: 'P-384', size: 48 },
  '1.3.132.0.35': { name: 'P-521', size: 66 },
};

/** Campo de firma ya localizado en el árbol: nombre completo, diccionario `/V` y página del widget. */
interface SigField {
  readonly fieldName: string;
  readonly value: PdfDict;
  readonly pageRef: PdfRef | null;
}

/** Firma que no podemos validar por tipo (no por estar rota). Su texto es el motivo para el usuario. */
class UnsupportedSignature extends Error {}

/** Valida todas las firmas del PDF. Devuelve `[]` si no hay firmas. Solo falla si el documento no se puede leer. */
export async function verifySignatures(source: ByteSource, reader: ObjectReader): Promise<Result<readonly SignatureStatus[]>> {
  let fields: readonly SigField[];
  try {
    fields = await signatureFields(reader);
  } catch (error: unknown) {
    return err(pdfError('corrupt', error));
  }
  if (fields.length === 0) return ok([]);
  const pages = await pageIndexes(reader, fields);
  const statuses: SignatureStatus[] = [];
  for (const field of fields) {
    statuses.push(await statusOf(source, reader, field, pages));
  }
  return ok(statuses);
}

async function statusOf(source: ByteSource, reader: ObjectReader, field: SigField, pages: ReadonlyMap<number, number>): Promise<SignatureStatus> {
  const pageIndex = field.pageRef === null ? null : (pages.get(field.pageRef.num) ?? null);
  const signedAt = parsePdfDate(stringOf(dictGet(field.value, 'M')));
  const reason = stringOf(dictGet(field.value, 'Reason'));
  const location = stringOf(dictGet(field.value, 'Location'));
  const subFilter = nameOf(dictGet(field.value, 'SubFilter')) ?? '';
  const base = { fieldName: field.fieldName, pageIndex, signedAt, reason, location, subFilter };
  try {
    const check = await checkSignature(source, reader, field.value);
    return { ...base, ...check };
  } catch (error: unknown) {
    // Una firma ilegible no tumba la lista: se marca como no verificable.
    const problem = error instanceof UnsupportedSignature ? error.message : MSG_UNREADABLE;
    return { ...base, signer: null, verdict: 'unknown', problem, changedAfter: false };
  }
}

interface Check {
  readonly verdict: SignatureVerdict;
  readonly problem: string | null;
  readonly signer: CertificateInfo | null;
  readonly changedAfter: boolean;
}

/** Validación completa de una firma. Puede lanzar: `statusOf` lo convierte en `unknown`. */
async function checkSignature(source: ByteSource, reader: ObjectReader, sig: PdfDict): Promise<Check> {
  const range = await byteRangeOf(reader, sig, source.size);
  if (range === null) return { verdict: 'invalid', problem: MSG_RANGE, signer: null, changedAfter: false };
  const [, b, c, d] = range;
  const changedAfter = await changedAfterSigning(source, c + d);
  const subFilter = nameOf(dictGet(sig, 'SubFilter')) ?? '';
  if (!VALIDATED_SUBFILTERS.has(subFilter)) return { verdict: 'unknown', problem: MSG_UNSUPPORTED, signer: null, changedAfter };

  const contents = await reader.resolve(dictGet(sig, 'Contents'));
  if (!isString(contents)) throw new UnsupportedSignature(MSG_UNREADABLE);
  const cms = parseCms(derPrefix(contents.bytes));
  const signer = findSigner(cms.certificates, cms.sid);
  if (signer === null) return { verdict: 'unknown', problem: MSG_NO_CERT, signer: null, changedAfter };
  const signerInfo = certificateInfoOf(signer);

  const digestHash = HASHES[cms.digestOid];
  if (digestHash === undefined) throw new UnsupportedSignature(MSG_UNSUPPORTED);
  const sigAlgorithm = SIGNATURE_ALGORITHMS[cms.signatureOid];
  if (sigAlgorithm === undefined) throw new UnsupportedSignature(MSG_UNSUPPORTED);
  const sigHash = HASHES[sigAlgorithm.hash ?? cms.digestOid];
  if (sigHash === undefined) throw new UnsupportedSignature(MSG_UNSUPPORTED);
  const spki = publicKeyInfo(signer);

  let intact: boolean;
  if (cms.signedAttrs !== null) {
    const messageDigest = messageDigestOf(cms.signedAttrs);
    const actual = await digestOfRanges(source, b, c, d, digestHash);
    if (!sameBytes(messageDigest, actual)) {
      return { verdict: 'invalid', problem: MSG_MODIFIED, signer: signerInfo, changedAfter };
    }
    intact = await verifyWith(sigAlgorithm, sigHash, spki, cms.signature, { attributes: signedAttributesDer(cms.signedAttrs) });
  } else {
    // Sin atributos firmados, la firma cubre directamente el resumen de los rangos.
    const digest = await digestOfRanges(source, b, c, d, sigHash);
    intact = await verifyWith(sigAlgorithm, sigHash, spki, cms.signature, { digest });
  }
  if (!intact) return { verdict: 'invalid', problem: MSG_INVALID, signer: signerInfo, changedAfter };
  return { verdict: 'valid', problem: null, signer: signerInfo, changedAfter };
}

/** `[0 b c d]` válido: `0 < b < c`, `d ≥ 0` y `c + d ≤ tamaño`. `null` si no cumple. */
async function byteRangeOf(reader: ObjectReader, sig: PdfDict, size: number): Promise<readonly [number, number, number, number] | null> {
  const raw = await reader.resolve(dictGet(sig, 'ByteRange'));
  if (!Array.isArray(raw) || raw.length !== 4) return null;
  const numbers = raw.map((v: PdfValue) => (typeof v === 'number' && Number.isSafeInteger(v) ? v : NaN));
  const [a, b, c, d] = numbers as [number, number, number, number];
  if (![a, b, c, d].every(Number.isFinite)) return null;
  if (a !== 0 || b <= 0 || c <= b || d < 0 || c + d > size) return null;
  return [a, b, c, d];
}

/** `true` si hay algún byte que no sea blanco después de `end` (otra revisión del documento). */
async function changedAfterSigning(source: ByteSource, end: number): Promise<boolean> {
  for (let at = end; at < source.size; at += READ_BLOCK_BYTES) {
    const chunk = await source.read(at, Math.min(source.size, at + READ_BLOCK_BYTES));
    for (const byte of chunk) {
      if (!PDF_WHITESPACE.has(byte)) return true;
    }
  }
  return false;
}

/** Resumen de `[0, b)` y `[c, c + d)` del original, leído por bloques. */
async function digestOfRanges(source: ByteSource, b: number, c: number, d: number, spec: HashSpec): Promise<Uint8Array> {
  const hash = spec.create();
  await feed(hash, source, 0, b);
  await feed(hash, source, c, c + d);
  return hash.digest();
}

async function feed(hash: Hasher, source: ByteSource, begin: number, end: number): Promise<void> {
  for (let at = begin; at < end; at += READ_BLOCK_BYTES) {
    hash.update(await source.read(at, Math.min(end, at + READ_BLOCK_BYTES)));
  }
}

/** Lo que firma la firma: los atributos firmados (DER como SET) o, sin ellos, el resumen de los rangos. */
type Signed = { readonly attributes: Uint8Array } | { readonly digest: Uint8Array };

/** Comprueba la firma matemática. Devuelve `false` si la firma no casa con la clave pública del firmante. */
async function verifyWith(algorithm: SignatureAlgorithm, hash: HashSpec, spki: Node, signature: Uint8Array, signed: Signed): Promise<boolean> {
  if (algorithm.kind === 'rsa') {
    const key = forge.pki.publicKeyFromAsn1(spki);
    if (!isRsaKey(key)) return false;
    const digest = 'digest' in signed ? signed.digest : await hashOf(hash, signed.attributes);
    return key.verify(forge.util.binary.raw.encode(digest), forge.util.binary.raw.encode(signature));
  }
  // WebCrypto solo verifica datos (los resume él), no resúmenes ya calculados.
  if (!('attributes' in signed)) throw new UnsupportedSignature(MSG_UNSUPPORTED);
  return verifyEcdsa(spki, hash, signature, signed.attributes);
}

async function hashOf(spec: HashSpec, data: Uint8Array): Promise<Uint8Array> {
  const hasher = spec.create();
  hasher.update(data);
  return hasher.digest();
}

/** ECDSA con WebCrypto: la firma DER `(r, s)` pasa a formato P1363 y la clave a SPKI. */
async function verifyEcdsa(spki: Node, hash: HashSpec, signature: Uint8Array, data: Uint8Array): Promise<boolean> {
  const algorithm = children(children(spki)[0] as Node);
  if (oidOf(algorithm[0] as Node) !== OID_EC_PUBLIC_KEY) throw new UnsupportedSignature(MSG_UNSUPPORTED);
  const curve = CURVES[oidOf(algorithm[1] as Node)];
  if (curve === undefined) throw new UnsupportedSignature(MSG_UNSUPPORTED);
  const key = await globalThis.crypto.subtle.importKey(
    'spki',
    new Uint8Array(bytesOf(forge.asn1.toDer(spki).getBytes())),
    { name: 'ECDSA', namedCurve: curve.name },
    false,
    ['verify'],
  );
  const p1363 = derEcdsaToP1363(signature, curve.size);
  if (p1363 === null) return false;
  return globalThis.crypto.subtle.verify({ name: 'ECDSA', hash: hash.subtle }, key, new Uint8Array(p1363), new Uint8Array(data));
}

/** `ECDSA-Sig-Value ::= SEQUENCE { r INTEGER, s INTEGER }` → `r || s` de `size` bytes cada uno. */
function derEcdsaToP1363(der: Uint8Array, size: number): Uint8Array | null {
  const [r, s] = children(forge.asn1.fromDer(forge.util.binary.raw.encode(der)));
  if (r === undefined || s === undefined) return null;
  const out = new Uint8Array(2 * size);
  for (const [index, value] of [r, s].entries()) {
    const raw = bytesOf(typeof value.value === 'string' ? value.value : '');
    const trimmed = raw.length > size && raw[0] === 0 ? raw.subarray(raw.length - size) : raw;
    if (trimmed.length > size) return null;
    out.set(trimmed, index * size + size - trimmed.length);
  }
  return out;
}

interface CmsParts {
  readonly certificates: readonly Node[];
  readonly sid: Node;
  readonly digestOid: string;
  readonly signedAttrs: Node | null;
  readonly signatureOid: string;
  readonly signature: Uint8Array;
}

/** Lee `ContentInfo → SignedData → SignerInfo` (primer firmante). Lanza si la estructura no es la esperada. */
function parseCms(der: Uint8Array): CmsParts {
  const contentInfo = children(forge.asn1.fromDer(forge.util.binary.raw.encode(der)));
  if (oidOf(at(contentInfo, 0)) !== OID_SIGNED_DATA) throw new UnsupportedSignature(MSG_UNSUPPORTED);
  const signedData = children(children(at(contentInfo, 1))[0] as Node);
  const certsNode = signedData.find((n) => n.tagClass === forge.asn1.Class.CONTEXT_SPECIFIC && n.type === 0);
  const signerInfos = children(at(signedData, signedData.length - 1));
  const info = children(at(signerInfos, 0));
  const sid = at(info, 1);
  if (sid.tagClass !== forge.asn1.Class.UNIVERSAL || sid.type !== forge.asn1.Type.SEQUENCE) {
    throw new UnsupportedSignature(MSG_UNSUPPORTED);
  }
  let index = 3;
  let signedAttrs: Node | null = null;
  const maybeAttrs = at(info, index);
  if (maybeAttrs.tagClass === forge.asn1.Class.CONTEXT_SPECIFIC && maybeAttrs.type === 0) {
    signedAttrs = maybeAttrs;
    index++;
  }
  const signatureAlgorithm = children(at(info, index));
  const signature = octetsOf(at(info, index + 1));
  return {
    certificates: certsNode === undefined ? [] : children(certsNode),
    sid,
    digestOid: oidOf(at(children(at(info, 2)), 0)),
    signedAttrs,
    signatureOid: oidOf(at(signatureAlgorithm, 0)),
    signature,
  };
}

/** Certificado del firmante: el que coincide con `IssuerAndSerialNumber` del SignerInfo. */
function findSigner(certificates: readonly Node[], sid: Node): Node | null {
  const [issuer, serial] = children(sid);
  if (issuer === undefined || serial === undefined) return null;
  const issuerDer = forge.asn1.toDer(issuer).getBytes();
  for (const cert of certificates) {
    const tbs = children(children(cert)[0] as Node);
    const offset = tbs[0]?.tagClass === forge.asn1.Class.CONTEXT_SPECIFIC ? 1 : 0;
    const certSerial = tbs[offset];
    const certIssuer = tbs[offset + 2];
    if (certSerial === undefined || certIssuer === undefined) continue;
    if (certSerial.value === serial.value && forge.asn1.toDer(certIssuer).getBytes() === issuerDer) return cert;
  }
  return null;
}

/**
 * Datos del certificado leídos del ASN.1 (sin `forge.pki.certificateFromAsn1`, que no admite claves EC).
 * Mismo criterio que `certificateInfo` de p12.ts: CN del titular y emisor, o el DN completo si no hay CN.
 */
function certificateInfoOf(cert: Node): CertificateInfo {
  const tbs = children(children(cert)[0] as Node);
  const offset = tbs[0]?.tagClass === forge.asn1.Class.CONTEXT_SPECIFIC ? 1 : 0;
  const serial = at(tbs, offset);
  const validity = children(at(tbs, offset + 3));
  return {
    subject: displayNameOf(at(tbs, offset + 4)),
    issuer: displayNameOf(at(tbs, offset + 2)),
    serial: forge.util.bytesToHex(typeof serial.value === 'string' ? serial.value : ''),
    validFrom: timeOf(at(validity, 0)).toISOString(),
    validTo: timeOf(at(validity, 1)).toISOString(),
  };
}

function displayNameOf(name: Node): string {
  const attributes = children(name).flatMap((rdn) =>
    children(rdn).map((attribute) => {
      const [type, value] = children(attribute);
      return { type: type === undefined ? '' : oidOf(type), value: typeof value?.value === 'string' ? value.value : '' };
    }),
  );
  const cn = attributes.find((attribute) => attribute.type === OID_COMMON_NAME);
  if (cn !== undefined) return utf8(cn.value);
  return attributes.map((a) => `${SHORT_NAMES[a.type] ?? a.type}=${utf8(a.value)}`).join(', ');
}

function utf8(value: string): string {
  try {
    return forge.util.decodeUtf8(value);
  } catch {
    return value;
  }
}

function timeOf(node: Node): Date {
  if (typeof node.value !== 'string') throw new UnsupportedSignature(MSG_UNREADABLE);
  return node.type === forge.asn1.Type.UTCTIME ? forge.asn1.utcTimeToDate(node.value) : forge.asn1.generalizedTimeToDate(node.value);
}

/** SubjectPublicKeyInfo del certificado (campo 7 del TBSCertificate, sin la versión opcional). */
function publicKeyInfo(cert: Node): Node {
  const tbs = children(children(cert)[0] as Node);
  const offset = tbs[0]?.tagClass === forge.asn1.Class.CONTEXT_SPECIFIC ? 1 : 0;
  const spki = tbs[offset + 5];
  if (spki === undefined) throw new RangeError('certificado sin clave pública');
  return spki;
}

/** `messageDigest` de los atributos firmados. Sin él, el SignerInfo no es válido. */
function messageDigestOf(signedAttrs: Node): Uint8Array {
  for (const attribute of children(signedAttrs)) {
    const [type, values] = children(attribute);
    if (type === undefined || values === undefined || oidOf(type) !== OID_MESSAGE_DIGEST) continue;
    return octetsOf(at(children(values), 0));
  }
  throw new UnsupportedSignature(MSG_UNREADABLE);
}

/** DER de los atributos firmados con la etiqueta `SET` (0x31), que es lo que se firma (RFC 5652 §5.4). */
function signedAttributesDer(signedAttrs: Node): Uint8Array {
  const der = bytesOf(forge.asn1.toDer(signedAttrs).getBytes());
  der[0] = 0x31;
  return der;
}

/** TLV DER completo al principio de `bytes` (sin el relleno de ceros del hueco `/Contents`). */
function derPrefix(bytes: Uint8Array): Uint8Array {
  if (bytes[0] !== 0x30) throw new UnsupportedSignature(MSG_UNREADABLE);
  const first = bytes[1];
  if (first === undefined) throw new UnsupportedSignature(MSG_UNREADABLE);
  let headerLength = 2;
  let length = first;
  if (first >= 0x80) {
    const count = first & 0x7f;
    if (count === 0 || count > 4) throw new UnsupportedSignature(MSG_UNREADABLE);
    length = 0;
    for (let i = 0; i < count; i++) {
      length = length * 256 + (bytes[2 + i] ?? 0);
    }
    headerLength = 2 + count;
  }
  const total = headerLength + length;
  if (total > bytes.length) throw new UnsupportedSignature(MSG_UNREADABLE);
  return bytes.subarray(0, total);
}

/** Campos `/FT /Sig` con `/V` diccionario, con el FT y el V heredados de los padres. */
async function signatureFields(reader: ObjectReader): Promise<SigField[]> {
  const catalog = dictOf(await reader.resolve(dictGet(reader.xref.trailer, 'Root')));
  if (catalog === null) return [];
  const acro = dictOf(await reader.resolve(dictGet(catalog, 'AcroForm')));
  if (acro === null) return [];
  const fields = await reader.resolve(dictGet(acro, 'Fields'));
  if (!Array.isArray(fields)) return [];

  const found: SigField[] = [];
  const seen = new Set<number>();
  interface Pending {
    readonly node: PdfValue;
    readonly parentName: string;
    readonly parentType: string | null;
    readonly parentValue: PdfValue | undefined;
    readonly depth: number;
  }
  const pending: Pending[] = fields.map((node) => ({ node, parentName: '', parentType: null, parentValue: undefined, depth: 0 }));
  for (let next = pending.shift(); next !== undefined; next = pending.shift()) {
    if (next.depth > MAX_FIELD_DEPTH) continue;
    let dict: PdfDict | null;
    if (isRef(next.node)) {
      if (seen.has(next.node.num)) continue;
      seen.add(next.node.num);
      dict = await reader.getDict(next.node);
    } else {
      dict = dictOf(next.node);
    }
    if (dict === null) continue;

    const title = await reader.resolve(dictGet(dict, 'T'));
    const name = isString(title)
      ? (next.parentName === '' ? decodeTextString(title) : `${next.parentName}.${decodeTextString(title)}`)
      : next.parentName;
    const type = nameOf(await reader.resolve(dictGet(dict, 'FT'))) ?? next.parentType;
    const ownValue = await reader.resolve(dictGet(dict, 'V'));
    const value = ownValue ?? next.parentValue;
    const own = dictOf(ownValue);
    if (type === 'Sig' && own !== null) {
      found.push({ fieldName: name, value: own, pageRef: await pageRefOf(reader, dict) });
    }

    const kids = await reader.resolve(dictGet(dict, 'Kids'));
    if (Array.isArray(kids)) {
      for (const kid of kids) {
        pending.push({ node: kid, parentName: name, parentType: type, parentValue: value, depth: next.depth + 1 });
      }
    }
  }
  return found;
}

/** Página del widget: la del propio nodo o la del primer hijo que la tenga. */
async function pageRefOf(reader: ObjectReader, dict: PdfDict): Promise<PdfRef | null> {
  const own = dictGet(dict, 'P');
  if (isRef(own)) return own;
  const kids = await reader.resolve(dictGet(dict, 'Kids'));
  if (!Array.isArray(kids)) return null;
  for (const kid of kids) {
    const kidDict = dictOf(isRef(kid) ? await reader.get(kid) : kid);
    const page = kidDict === null ? undefined : dictGet(kidDict, 'P');
    if (isRef(page)) return page;
  }
  return null;
}

/** Número de página (0-based) de cada referencia de página, para los campos que la tienen. */
async function pageIndexes(reader: ObjectReader, fields: readonly SigField[]): Promise<ReadonlyMap<number, number>> {
  if (!fields.some((f) => f.pageRef !== null)) return new Map();
  const indexes = new Map<number, number>();
  try {
    const count = await reader.pageCount();
    for (let i = 0; i < count; i++) {
      indexes.set((await reader.pageRef(i)).num, i);
    }
  } catch {
    // Sin páginas legibles, la firma se muestra sin número de página.
  }
  return indexes;
}

/* Utilidades ASN.1 y de tipos. */

function children(node: Node): Node[] {
  if (!Array.isArray(node.value)) throw new UnsupportedSignature(MSG_UNREADABLE);
  return node.value;
}

function at(list: readonly Node[], index: number): Node {
  const node = list[index];
  if (node === undefined) throw new UnsupportedSignature(MSG_UNREADABLE);
  return node;
}

function oidOf(node: Node): string {
  if (node.type !== forge.asn1.Type.OID || typeof node.value !== 'string') throw new UnsupportedSignature(MSG_UNREADABLE);
  return forge.asn1.derToOid(node.value);
}

function octetsOf(node: Node): Uint8Array {
  if (node.type !== forge.asn1.Type.OCTETSTRING || typeof node.value !== 'string') throw new UnsupportedSignature(MSG_UNREADABLE);
  return bytesOf(node.value);
}

function bytesOf(binary: string): Uint8Array {
  return forge.util.binary.raw.decode(binary);
}

function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  return a.length === b.length && a.every((byte, i) => byte === b[i]);
}

function isRsaKey(key: unknown): key is forge.pki.rsa.PublicKey {
  return typeof key === 'object' && key !== null && 'n' in key && 'e' in key && 'verify' in key;
}

function dictOf(v: PdfValue | undefined): PdfDict | null {
  return typeof v === 'object' && v !== null && !Array.isArray(v) && 'kind' in v && v.kind === 'dict' ? v : null;
}

function isRef(v: PdfValue | undefined): v is PdfRef {
  return typeof v === 'object' && v !== null && !Array.isArray(v) && 'kind' in v && v.kind === 'ref';
}

function isString(v: PdfValue | undefined): v is { readonly kind: 'string'; readonly bytes: Uint8Array; readonly hex: boolean } {
  return typeof v === 'object' && v !== null && !Array.isArray(v) && 'kind' in v && v.kind === 'string';
}

function nameOf(v: PdfValue | undefined): string | null {
  return typeof v === 'object' && v !== null && !Array.isArray(v) && 'kind' in v && v.kind === 'name' ? v.value : null;
}

/** Texto de una cadena PDF (`/M`, `/Reason`, `/Location`), o `null` si no es cadena. */
function stringOf(v: PdfValue | undefined): string | null {
  return isString(v) ? decodeTextString(v) : null;
}
