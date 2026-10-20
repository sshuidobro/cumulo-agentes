import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildCadesSignature } from '../../../src/core/signature/digital/cms';
import { openP12, type SigningIdentity } from '../../../src/core/signature/digital/p12';
import { certFixtures, TEST_P12_PASSWORD } from '../../support/certs';

const DATA = new TextEncoder().encode('Bloque de datos conocido para la firma CMS.\n');
const OTHER = new TextEncoder().encode('Otro bloque de datos.\n');

let dir = '';

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'cumulo-cms-'));
});

afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

function identityOf(bytes: Uint8Array): SigningIdentity {
  const result = openP12(bytes, TEST_P12_PASSWORD);
  if (!result.ok) throw new Error(result.error.code);
  return result.value;
}

function sha256(bytes: Uint8Array): Uint8Array {
  return new Uint8Array(createHash('sha256').update(bytes).digest());
}

/** Escribe `bytes` con `name` en el directorio de trabajo y devuelve su ruta. */
function put(name: string, bytes: Uint8Array): string {
  const path = join(dir, name);
  writeFileSync(path, bytes);
  return path;
}

/** Ejecuta `openssl` con `args` y devuelve código, stdout y stderr. */
function openssl(args: readonly string[]): { readonly status: number | null; readonly output: string } {
  const result = spawnSync('openssl', [...args], { encoding: 'utf8' });
  if (result.error !== undefined) throw new Error('Instala openssl: apt-get install -y openssl');
  return { status: result.status, output: `${result.stdout}${result.stderr}` };
}

describe('buildCadesSignature', () => {
  it('openssl cms verifica la firma de un bloque de datos conocido', () => {
    const cms = buildCadesSignature(identityOf(certFixtures().rsaAes), sha256(DATA));
    const sig = put('firma.der', cms);
    const content = put('datos.bin', DATA);
    const ok = openssl(['cms', '-verify', '-binary', '-inform', 'DER', '-in', sig, '-content', content, '-noverify', '-out', join(dir, 'salida.bin')]);
    expect(ok.status).toBe(0);
    expect(ok.output).toContain('Verification successful');
  });

  it('openssl rechaza la firma si los datos cambian', () => {
    const cms = buildCadesSignature(identityOf(certFixtures().rsaAes), sha256(DATA));
    const sig = put('firma-otra.der', cms);
    const content = put('otros.bin', OTHER);
    const bad = openssl(['cms', '-verify', '-binary', '-inform', 'DER', '-in', sig, '-content', content, '-noverify', '-out', join(dir, 'salida2.bin')]);
    expect(bad.status).not.toBe(0);
  });

  it('los atributos firmados son contentType, messageDigest y signingCertificateV2, sin signingTime', () => {
    const cms = buildCadesSignature(identityOf(certFixtures().rsaAes), sha256(DATA));
    const sig = put('atributos.der', cms);
    const parsed = openssl(['asn1parse', '-inform', 'DER', '-in', sig, '-i']);
    expect(parsed.status).toBe(0);
    expect(parsed.output).toContain('contentType');
    expect(parsed.output).toContain('messageDigest');
    expect(parsed.output).toContain('signingCertificateV2');
    expect(parsed.output).not.toContain('signingTime');
  });

  it('el hash del certificado en signingCertificateV2 es SHA-256 del DER del firmante', () => {
    const identity = identityOf(certFixtures().rsaAes);
    const cms = buildCadesSignature(identity, sha256(DATA));
    const sig = put('certhash.der', cms);
    const dump = openssl(['asn1parse', '-inform', 'DER', '-in', sig, '-dump']);
    const hex = createHash('sha256').update(identity.certDer).digest('hex');
    expect(hex64(dump.output)).toContain(hex);
  });

  it('incluye el firmante y la cadena como certificados', () => {
    const cms = buildCadesSignature(identityOf(certFixtures().chain), sha256(DATA));
    const sig = put('cadena.der', cms);
    const certs = openssl(['pkcs7', '-inform', 'DER', '-in', sig, '-print_certs']);
    expect(certs.status).toBe(0);
    expect(certs.output.match(/^subject=/gm)).toHaveLength(2);
  });

  it('la versión de SignedData y de SignerInfo es 1', () => {
    const cms = buildCadesSignature(identityOf(certFixtures().rsaAes), sha256(DATA));
    const sig = put('version.der', cms);
    const printed = openssl(['cms', '-cmsout', '-print', '-inform', 'DER', '-in', sig]);
    expect(printed.status).toBe(0);
    // SignedData, SignerInfo y (versión 2 del certificado del firmante, X.509 v3).
    expect(printed.output.match(/^\s*version: \d+$/gm)?.map((line) => line.trim())).toEqual(['version: 1', 'version: 2', 'version: 1']);
  });
});

/** Solo los bytes hexadecimales de un volcado de `asn1parse -dump`, sin desplazamientos ni texto. */
function hex64(dump: string): string {
  return dump
    .split('\n')
    .map((line) => line.replace(/^.*?- /, '').slice(0, 47))
    .join('')
    .replace(/[^0-9a-f]/gi, '')
    .toLowerCase();
}
