/**
 * Certificados de prueba para la firma digital (PDF-066). Se generan con `openssl` en un directorio temporal al
 * vuelo y se borran al terminar: nada se versiona. Si `openssl` no está en el PATH, falla con la instrucción de
 * instalación (los tests que lo usan fallan, nunca se saltan).
 */
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/** Contraseña de todos los `.p12` de prueba. */
export const TEST_P12_PASSWORD = 'clave-prueba';
/** CN del certificado RSA de prueba. */
export const TEST_CN = 'Prueba Cúmulo';

export interface CertFixtures {
  /** RSA 2048 autofirmado, PKCS#12 con AES (el de por defecto de openssl). */
  readonly rsaAes: Uint8Array;
  /** Certificado RSA de `rsaAes` en PEM. */
  readonly rsaCertPem: string;
  /** Clave privada RSA de `rsaAes` en PEM. */
  readonly rsaKeyPem: string;
  /** Mismo certificado con 3DES y MAC SHA-1: formato heredado de Windows y de la FNMT. */
  readonly rsa3des: Uint8Array;
  /** Clave EC P-256 en PKCS#12: `openP12` la rechaza (no soportada para firmar). */
  readonly ec: Uint8Array;
  /** Certificado EC P-256 autofirmado en PEM (para firmar con `openssl cms` en las pruebas de validación). */
  readonly ecCertPem: string;
  /** Clave privada EC P-256 en PEM. */
  readonly ecKeyPem: string;
  /** Certificado de hoja firmado por una CA, con la CA en el mismo `.p12` (cadena de un elemento). */
  readonly chain: Uint8Array;
  /** Certificado RSA sin CN (solo O y C): el nombre que se muestra es el DN completo. */
  readonly noCn: Uint8Array;
  /** Certificado sin clave privada. */
  readonly certOnly: Uint8Array;
}

let cached: CertFixtures | null = null;

/** Genera los certificados una vez por proceso de test. */
export function certFixtures(): CertFixtures {
  cached ??= makeCertFixtures();
  return cached;
}

function makeCertFixtures(): CertFixtures {
  const dir = mkdtempSync(join(tmpdir(), 'cumulo-cert-'));
  try {
    const openssl = (args: readonly string[]): void => {
      const result = spawnSync('openssl', [...args], { cwd: dir, encoding: 'utf8' });
      if (result.error !== undefined) {
        throw new Error('Instala openssl: apt-get install -y openssl');
      }
      if (result.status !== 0) throw new Error(`openssl ${args.join(' ')}: ${result.stderr}`);
    };
    const p12 = (out: string, args: readonly string[]): Uint8Array => {
      openssl(['pkcs12', '-export', ...args, '-out', out, '-passout', `pass:${TEST_P12_PASSWORD}`]);
      return new Uint8Array(readFileSync(join(dir, out)));
    };

    openssl(['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', 'k.pem', '-out', 'c.pem', '-days', '3650', '-subj', `/CN=${TEST_CN}`, '-utf8']);
    const rsaAes = p12('aes.p12', ['-inkey', 'k.pem', '-in', 'c.pem']);
    const rsaCertPem = readFileSync(join(dir, 'c.pem'), 'utf8');
    const rsaKeyPem = readFileSync(join(dir, 'k.pem'), 'utf8');
    const rsa3des = p12('3des.p12', ['-inkey', 'k.pem', '-in', 'c.pem', '-certpbe', 'PBE-SHA1-3DES', '-keypbe', 'PBE-SHA1-3DES', '-macalg', 'sha1']);
    const certOnly = p12('nokey.p12', ['-nokeys', '-in', 'c.pem']);

    openssl(['ecparam', '-name', 'prime256v1', '-genkey', '-noout', '-out', 'ec.pem']);
    openssl(['req', '-x509', '-new', '-key', 'ec.pem', '-out', 'ecc.pem', '-days', '3650', '-subj', '/CN=Prueba EC']);
    const ec = p12('ec.p12', ['-inkey', 'ec.pem', '-in', 'ecc.pem']);
    const ecCertPem = readFileSync(join(dir, 'ecc.pem'), 'utf8');
    const ecKeyPem = readFileSync(join(dir, 'ec.pem'), 'utf8');

    openssl(['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', 'ca.key', '-out', 'ca.pem', '-days', '3650', '-subj', '/CN=Prueba CA']);
    openssl(['req', '-newkey', 'rsa:2048', '-nodes', '-keyout', 'leaf.key', '-out', 'leaf.csr', '-subj', `/CN=${TEST_CN}`, '-utf8']);
    openssl(['x509', '-req', '-in', 'leaf.csr', '-CA', 'ca.pem', '-CAkey', 'ca.key', '-CAcreateserial', '-out', 'leaf.pem', '-days', '365']);
    const chain = p12('chain.p12', ['-inkey', 'leaf.key', '-in', 'leaf.pem', '-certfile', 'ca.pem']);

    openssl(['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', 'n.key', '-out', 'n.pem', '-days', '3650', '-subj', '/O=Prueba/C=ES']);
    const noCn = p12('nocn.p12', ['-inkey', 'n.key', '-in', 'n.pem']);

    return { rsaAes, rsaCertPem, rsaKeyPem, rsa3des, ec, ecCertPem, ecKeyPem, chain, noCn, certOnly };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
