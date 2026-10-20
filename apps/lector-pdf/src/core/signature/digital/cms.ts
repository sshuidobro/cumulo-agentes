/**
 * CMS SignedData (RFC 5652) para una firma PAdES B-B (ETSI EN 319 142-1, RFC 5035) (PDF-066, ADR-0040).
 * Sin contenido encapsulado (`ETSI.CAdES.detached`): el resumen de los rangos firmados se pasa ya calculado.
 * Atributos firmados: `contentType`, `messageDigest` y `signingCertificateV2`; sin `signingTime`.
 */
import forge from 'node-forge';
import type { SigningIdentity } from './p12';

const { Class, Type } = forge.asn1;

const OID_SIGNED_DATA = '1.2.840.113549.1.7.2';
const OID_DATA = '1.2.840.113549.1.7.1';
const OID_CONTENT_TYPE = '1.2.840.113549.1.9.3';
const OID_MESSAGE_DIGEST = '1.2.840.113549.1.9.4';
const OID_SIGNING_CERTIFICATE_V2 = '1.2.840.113549.1.9.16.2.47';
const OID_SHA256 = '2.16.840.1.101.3.4.2.1';
const OID_RSA_ENCRYPTION = '1.2.840.113549.1.1.1';

type Node = forge.asn1.Asn1;

/**
 * Construye el `ContentInfo` DER de una firma CMS con `digest` (SHA-256 de los rangos firmados) como
 * `messageDigest`. La firma RSA la hace `identity.sign` sobre el DER de los atributos firmados.
 */
export function buildCadesSignature(identity: SigningIdentity, digest: Uint8Array): Uint8Array {
  const signer = parseDer(identity.certDer);
  const signedAttrs = sortedByDer([
    attribute(OID_CONTENT_TYPE, oid(OID_DATA)),
    attribute(OID_MESSAGE_DIGEST, octets(binaryOf(digest))),
    attribute(OID_SIGNING_CERTIFICATE_V2, signingCertificateV2(identity.certDer)),
  ]);
  const attrsSet = forge.asn1.create(Class.UNIVERSAL, Type.SET, true, signedAttrs);
  const toSign = bytesOf(forge.asn1.toDer(attrsSet).getBytes());
  const signature = identity.sign(toSign);

  const signerInfo = seq([
    integer(1),
    issuerAndSerial(signer),
    digestAlgorithm(),
    forge.asn1.create(Class.CONTEXT_SPECIFIC, 0, true, signedAttrs),
    seq([oid(OID_RSA_ENCRYPTION), nullValue()]),
    octets(binaryOf(signature)),
  ]);
  const certificates = [signer, ...identity.chainDer.map(parseDer)];
  const signedData = seq([
    integer(1),
    set([digestAlgorithm()]),
    seq([oid(OID_DATA)]),
    forge.asn1.create(Class.CONTEXT_SPECIFIC, 0, true, certificates),
    set([signerInfo]),
  ]);
  const contentInfo = seq([oid(OID_SIGNED_DATA), forge.asn1.create(Class.CONTEXT_SPECIFIC, 0, true, [signedData])]);
  return bytesOf(forge.asn1.toDer(contentInfo).getBytes());
}

/** `Attribute ::= SEQUENCE { attrType, attrValues SET { valor } }`. */
function attribute(type: string, value: Node): Node {
  return seq([oid(type), set([value])]);
}

/** `SigningCertificateV2 { certs: [ESSCertIDv2 { certHash: SHA-256(certDer) }] }`; el hash es el SHA-256 por defecto, sin campo. */
function signingCertificateV2(certDer: Uint8Array): Node {
  return seq([seq([seq([octets(sha256Binary(certDer))])])]);
}

/** `IssuerAndSerialNumber` tomado del propio certificado (mismos bytes DER que el emisor y el serial). */
function issuerAndSerial(cert: Node): Node {
  const tbs = cert.value[0] as Node;
  const children = tbs.value as Node[];
  const hasVersion = children[0]?.tagClass === Class.CONTEXT_SPECIFIC;
  const offset = hasVersion ? 1 : 0;
  const serial = children[offset];
  const issuer = children[offset + 2];
  if (serial === undefined || issuer === undefined) throw new RangeError('certificado sin emisor o número de serie');
  return seq([issuer, serial]);
}

function digestAlgorithm(): Node {
  return seq([oid(OID_SHA256)]);
}

function parseDer(der: Uint8Array): Node {
  return forge.asn1.fromDer(binaryOf(der));
}

/** Orden DER de un SET OF: por su codificación, byte a byte. */
function sortedByDer(nodes: readonly Node[]): Node[] {
  return nodes
    .map((node) => ({ node, der: forge.asn1.toDer(node).getBytes() }))
    .sort((a, b) => (a.der < b.der ? -1 : a.der > b.der ? 1 : 0))
    .map((entry) => entry.node);
}

function seq(children: readonly Node[]): Node {
  return forge.asn1.create(Class.UNIVERSAL, Type.SEQUENCE, true, [...children]);
}

function set(children: readonly Node[]): Node {
  return forge.asn1.create(Class.UNIVERSAL, Type.SET, true, [...children]);
}

function oid(dotted: string): Node {
  return forge.asn1.create(Class.UNIVERSAL, Type.OID, false, forge.asn1.oidToDer(dotted).getBytes());
}

function integer(value: number): Node {
  return forge.asn1.create(Class.UNIVERSAL, Type.INTEGER, false, forge.asn1.integerToDer(value).getBytes());
}

function octets(value: string): Node {
  return forge.asn1.create(Class.UNIVERSAL, Type.OCTETSTRING, false, value);
}

function nullValue(): Node {
  return forge.asn1.create(Class.UNIVERSAL, Type.NULL, false, '');
}

function sha256Binary(bytes: Uint8Array): string {
  return forge.md.sha256.create().update(binaryOf(bytes), 'raw').digest().getBytes();
}

function binaryOf(bytes: Uint8Array): string {
  return forge.util.binary.raw.encode(bytes);
}

function bytesOf(binary: string): Uint8Array {
  return forge.util.binary.raw.decode(binary);
}
