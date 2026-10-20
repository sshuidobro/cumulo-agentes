/**
 * Identidad de firma desde un certificado personal PKCS#12 (.p12/.pfx) (PDF-066, ADR-0040). Usa node-forge,
 * que abre también los cifrados heredados (3DES, RC2). Solo claves RSA. Nunca lanza: los errores vuelven
 * como `Result`.
 */
import { err, ok, type Result } from '@suite/shared';
import forge from 'node-forge';
import { pdfError } from '../../errors';

export interface CertificateInfo {
  /** CN del titular (o el DN completo si no tiene CN). */
  readonly subject: string;
  /** CN del emisor (o el DN completo si no tiene CN). */
  readonly issuer: string;
  /** Número de serie en hexadecimal. */
  readonly serial: string;
  /** ISO 8601. */
  readonly validFrom: string;
  /** ISO 8601. */
  readonly validTo: string;
}

export interface SigningIdentity {
  readonly info: CertificateInfo;
  /** DER del certificado del firmante. */
  readonly certDer: Uint8Array;
  /** DER de los demás certificados del fichero (la cadena). */
  readonly chainDer: readonly Uint8Array[];
  /** Firma RSA PKCS#1 v1.5 con SHA-256 sobre `data`. */
  sign(data: Uint8Array): Uint8Array;
}

type RsaPrivateKey = forge.pki.rsa.PrivateKey;
type CertificateFieldSet = forge.pki.Certificate['subject'];

const OID_PKCS8_KEY_BAG = '1.2.840.113549.1.12.10.1.2';
const OID_KEY_BAG = '1.2.840.113549.1.12.10.1.1';
const OID_CERT_BAG = '1.2.840.113549.1.12.10.1.3';

/** Abre el .p12 con su contraseña y devuelve la identidad de firma (certificado + clave RSA + cadena). */
export function openP12(bytes: Uint8Array, password: string): Result<SigningIdentity> {
  let pfx: forge.pkcs12.Pkcs12Pfx;
  try {
    pfx = forge.pkcs12.pkcs12FromAsn1(forge.asn1.fromDer(bufferOf(bytes)), password);
  } catch (error: unknown) {
    return err(pdfError(isPasswordError(error) ? 'p12-wrong-password' : 'p12-invalid', error));
  }

  const keyBags = [...bagsOf(pfx, OID_PKCS8_KEY_BAG), ...bagsOf(pfx, OID_KEY_BAG)];
  if (keyBags.length === 0) return err(pdfError('p12-no-key'));
  const keys = keyBags.flatMap((bag) => (isRsaKey(bag.key) ? [bag.key] : []));
  if (keys.length === 0) return err(pdfError('p12-unsupported-key'));

  const certs = bagsOf(pfx, OID_CERT_BAG).flatMap((bag) => (bag.cert === undefined ? [] : [bag.cert]));
  for (const key of keys) {
    const signer = certs.find((cert) => matches(cert.publicKey, key));
    if (signer !== undefined) return ok(identityOf(signer, certs, key));
  }
  return err(pdfError('p12-invalid', new Error('ningún certificado corresponde a la clave privada')));
}

function identityOf(signer: forge.pki.Certificate, certs: readonly forge.pki.Certificate[], key: RsaPrivateKey): SigningIdentity {
  const chain = certs.filter((cert) => cert !== signer);
  return {
    info: {
      subject: displayName(signer.subject),
      issuer: displayName(signer.issuer),
      serial: signer.serialNumber,
      validFrom: signer.validity.notBefore.toISOString(),
      validTo: signer.validity.notAfter.toISOString(),
    },
    certDer: derOf(signer),
    chainDer: chain.map(derOf),
    sign(data: Uint8Array): Uint8Array {
      const md = forge.md.sha256.create();
      md.update(forge.util.binary.raw.encode(data), 'raw');
      return forge.util.binary.raw.decode(key.sign(md));
    },
  };
}

/** CN si lo hay; si no, el DN completo. Los CN en UTF-8 llegan como bytes: se decodifican. */
function displayName(subject: CertificateFieldSet): string {
  const cn = subject.getField('CN');
  if (cn !== null && typeof cn.value === 'string') return utf8(cn.value);
  return subject.attributes.map((a) => `${a.shortName ?? a.name ?? '?'}=${utf8(String(a.value))}`).join(', ');
}

function utf8(value: string): string {
  try {
    return forge.util.decodeUtf8(value);
  } catch {
    return value;
  }
}

function bagsOf(pfx: forge.pkcs12.Pkcs12Pfx, oid: string): forge.pkcs12.Bag[] {
  return pfx.getBags({ bagType: oid })[oid] ?? [];
}

function derOf(cert: forge.pki.Certificate): Uint8Array {
  return forge.util.binary.raw.decode(forge.asn1.toDer(forge.pki.certificateToAsn1(cert)).getBytes());
}

function isRsaKey(key: unknown): key is RsaPrivateKey {
  return typeof key === 'object' && key !== null && 'n' in key && 'e' in key;
}

function matches(publicKey: forge.pki.PublicKey, key: RsaPrivateKey): boolean {
  if (!isRsaKey(publicKey)) return false;
  return publicKey.n.compareTo(key.n) === 0 && publicKey.e.compareTo(key.e) === 0;
}

/** Contraseña incorrecta: forge lo dice en el mensaje (MAC o descifrado). Lo demás es un fichero no válido. */
function isPasswordError(error: unknown): boolean {
  return error instanceof Error && /password|MAC/i.test(error.message);
}

function bufferOf(bytes: Uint8Array): forge.util.ByteStringBuffer {
  return forge.util.createBuffer(forge.util.binary.raw.encode(bytes));
}
