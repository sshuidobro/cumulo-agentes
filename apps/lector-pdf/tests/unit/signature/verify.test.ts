import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { memorySource } from '@suite/platform';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { verifySignaturesOp } from '../../../src/core/doc-ops/ops/signature';
import { openP12, type SigningIdentity } from '../../../src/core/signature/digital/p12';
import { buildSignatureUpdate } from '../../../src/core/signature/digital/sign-pdf';
import { verifySignatures, type SignatureStatus } from '../../../src/core/signature/digital/verify';
import { openForSave } from '../../../src/core/pdf/incremental';
import type { ObjectReader } from '../../../src/core/pdf/object-reader';
import { FIXTURES_DIR } from '../../fixtures/paths';
import { certFixtures, TEST_P12_PASSWORD } from '../../support/certs';
import { pdfsig } from '../../support/pdfsig';
import { additionsDiff, concat, saveAnnotations } from '../../support/save-annotations';

const NOW = '2026-10-19T10:15:00.000Z';
const MSG_MODIFIED = 'El documento se ha modificado después de firmarlo.';
const MSG_INVALID = 'La firma no es válida.';
const MSG_RANGE = 'La firma no cubre el documento correctamente.';
const MSG_UNSUPPORTED = 'Tipo de firma no admitido para validar.';
const MSG_UNREADABLE = 'La estructura de la firma no se puede leer.';
const MSG_NO_CERT = 'No se encuentra el certificado del firmante.';

/** `/ByteRange [0 b c d]` tal como lo escribe sign-pdf: cada número en un hueco de 10 caracteres. */
const BYTE_RANGE = /\/ByteRange \[0\s+(\d+)\s+(\d+)\s+(\d+)\s*\]/;
const CONTENTS = /\/Contents <([0-9a-f]+)>/g;

let dir = '';

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'cumulo-verify-'));
  const certs = certFixtures();
  writeFileSync(join(dir, 'rsa-cert.pem'), certs.rsaCertPem);
  writeFileSync(join(dir, 'rsa-key.pem'), certs.rsaKeyPem);
  writeFileSync(join(dir, 'ec-cert.pem'), certs.ecCertPem);
  writeFileSync(join(dir, 'ec-key.pem'), certs.ecKeyPem);
});

afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

function identity(bytes: Uint8Array = certFixtures().rsaAes): SigningIdentity {
  const result = openP12(bytes, TEST_P12_PASSWORD);
  if (!result.ok) throw new Error(result.error.code);
  return result.value;
}

function fixture(name: string): Uint8Array {
  return new Uint8Array(readFileSync(join(FIXTURES_DIR, name)));
}

function latin1(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('latin1');
}

function fromLatin1(text: string): Uint8Array {
  return new Uint8Array(Buffer.from(text, 'latin1'));
}

/** Firma `data` con `id` (PDF-066) y devuelve el PDF completo. */
async function signed(data: Uint8Array, id: SigningIdentity = identity(), now = NOW): Promise<Uint8Array> {
  const source = memorySource(data);
  const opened = await openForSave(source);
  if (!opened.ok) throw new Error(opened.error.code);
  const built = await buildSignatureUpdate({
    source,
    reader: opened.value,
    identity: id,
    pageIndex: 0,
    rect: null,
    reason: '',
    location: '',
    now,
  });
  if (!built.ok) throw new Error(built.error.code);
  return concat(data, built.value.delta);
}

async function verify(data: Uint8Array): Promise<readonly SignatureStatus[]> {
  const source = memorySource(data);
  const opened = await openForSave(source);
  if (!opened.ok) throw new Error(opened.error.code);
  const result = await verifySignatures(source, opened.value);
  if (!result.ok) throw new Error(result.error.code);
  return result.value;
}

/** Bytes que cubre la firma más reciente: `[0, b)` y `[c, c + d)`. */
function signedRangesOf(pdf: Uint8Array): Uint8Array {
  const m = BYTE_RANGE.exec(latin1(pdf));
  if (m === null) throw new Error('sin /ByteRange');
  const b = Number(m[1]);
  const c = Number(m[2]);
  const d = Number(m[3]);
  return concat(pdf.subarray(0, b), pdf.subarray(c, c + d));
}

/** Sustituye el hueco `/Contents` de la última firma por `cms` (mismo tamaño: el hueco es fijo). */
function withCms(pdf: Uint8Array, cms: Uint8Array): Uint8Array {
  const text = latin1(pdf);
  const last = [...text.matchAll(CONTENTS)].at(-1);
  if (last === undefined || last.index === undefined) throw new Error('sin /Contents');
  const hex = Buffer.from(cms).toString('hex');
  const hole = last[1] ?? '';
  if (hex.length > hole.length) throw new Error('CMS mayor que el hueco');
  const start = last.index + '/Contents <'.length;
  return fromLatin1(text.slice(0, start) + hex.padEnd(hole.length, '0') + text.slice(start + hole.length));
}

/** Cambia el texto de la última firma (mismo tamaño) y devuelve el PDF. */
function replaceLastSignatureText(pdf: Uint8Array, from: string, to: string): Uint8Array {
  const text = latin1(pdf);
  const at = text.lastIndexOf(from);
  if (at < 0 || to.length !== from.length) throw new Error(`no encuentro «${from}»`);
  return fromLatin1(text.slice(0, at) + to + text.slice(at + from.length));
}

interface OpensslOptions {
  readonly key: 'rsa' | 'ec';
  readonly md: 'sha1' | 'sha256' | 'sha384' | 'sha512';
  readonly noAttr?: boolean;
  readonly noCerts?: boolean;
}

/** CMS DER firmado con `openssl cms -sign` sobre `ranges` (firma separada, como ETSI.CAdES.detached). */
function opensslCms(ranges: Uint8Array, options: OpensslOptions): Uint8Array {
  const work = mkdtempSync(join(dir, 'cms-'));
  const prefix = options.key === 'rsa' ? 'rsa' : 'ec';
  writeFileSync(join(work, 'in.bin'), ranges);
  const args = [
    'cms', '-sign', '-binary', '-outform', 'DER', '-md', options.md,
    '-signer', join(dir, `${prefix}-cert.pem`), '-inkey', join(dir, `${prefix}-key.pem`),
    '-in', join(work, 'in.bin'), '-out', join(work, 'sig.der'),
  ];
  if (options.noAttr === true) args.push('-noattr');
  if (options.noCerts === true) args.push('-nocerts');
  const result = spawnSync('openssl', args, { encoding: 'utf8' });
  if (result.status !== 0) throw new Error(`openssl cms: ${result.stderr}`);
  return new Uint8Array(readFileSync(join(work, 'sig.der')));
}

/** PDF firmado con `openssl` como CMS: el RSA del hueco se sustituye por el de openssl (los rangos no cambian). */
async function signedWithOpenssl(options: OpensslOptions): Promise<Uint8Array> {
  const base = await signed(fixture('basic-5.pdf'));
  return withCms(base, opensslCms(signedRangesOf(base), options));
}

describe('verifySignatures', () => {
  it('PDF firmado con buildSignatureUpdate: válida, sin cambios posteriores, firmante y fecha', async () => {
    const pdf = await signed(fixture('basic-5.pdf'));
    const statuses = await verify(pdf);
    expect(statuses).toHaveLength(1);
    const [status] = statuses;
    expect(status).toMatchObject({
      fieldName: 'Firma 1',
      pageIndex: 0,
      signedAt: NOW,
      reason: null,
      location: null,
      subFilter: 'ETSI.CAdES.detached',
      verdict: 'valid',
      problem: null,
      changedAfter: false,
    });
    // Los datos del firmante salen del ASN.1 del CMS: deben coincidir con los del .p12 (PDF-066).
    expect(status?.signer).toEqual(identity().info);
    expect(pdfsig(pdf).output).toContain('Signature Validation: Signature is Valid.');
  });

  it('un byte cambiado dentro del rango firmado → invalid (documento modificado)', async () => {
    const pdf = await signed(fixture('basic-5.pdf'));
    // Byte 12: dentro del comentario binario de la cabecera, dentro del rango firmado y sin efecto en la estructura.
    const tampered = new Uint8Array(pdf);
    tampered[12] = (tampered[12] ?? 0) ^ 0x01;
    const [status] = await verify(tampered);
    expect(status).toMatchObject({ verdict: 'invalid', problem: MSG_MODIFIED, changedAfter: false });
    expect(status?.signer).not.toBeNull();
    expect(pdfsig(tampered).output).not.toContain('Signature Validation: Signature is Valid.');
  });

  it('incremento de anotaciones posterior → valid con changedAfter true', async () => {
    const pdf = await signed(fixture('basic-5.pdf'));
    const square = {
      id: 'suite-test-cuadro',
      type: 'square' as const,
      pageIndex: 0,
      rect: [72, 500, 172, 560] as const,
      color: [1, 0, 0] as const,
      opacity: 1,
      contents: '',
      author: '',
      modified: NOW,
      created: null,
      origin: { kind: 'new' as const },
      width: 1,
      interior: null,
    };
    const { data } = await saveAnnotations(pdf, additionsDiff([square]));
    const [status] = await verify(data);
    expect(status).toMatchObject({ verdict: 'valid', problem: null, changedAfter: true });
  });

  it('bytes en blanco después del rango firmado no cuentan como cambio', async () => {
    const pdf = concat(await signed(fixture('basic-5.pdf')), fromLatin1('\r\n \n'));
    const [status] = await verify(pdf);
    expect(status).toMatchObject({ verdict: 'valid', changedAfter: false });
  });

  it('dos firmas (la segunda con certificado de cadena): ambas válidas y la primera con cambios posteriores', async () => {
    const first = await signed(fixture('basic-5.pdf'));
    const second = await signed(first, identity(certFixtures().chain), '2026-10-19T11:00:00.000Z');
    const statuses = await verify(second);
    expect(statuses.map((s) => [s.fieldName, s.verdict, s.changedAfter])).toEqual([
      ['Firma 1', 'valid', true],
      ['Firma 2', 'valid', false],
    ]);
    expect(pdfsig(second).output.match(/Signature Validation: Signature is Valid\./g)).toHaveLength(2);
  });

  it('una firma ilegible no tumba la lista: queda unknown y la otra se valida', async () => {
    const first = await signed(fixture('basic-5.pdf'));
    const second = await signed(first, identity(certFixtures().chain), '2026-10-19T11:00:00.000Z');
    // El CMS de la segunda firma empieza por 00 en vez de SEQUENCE: estructura ilegible.
    const broken = withCms(second, new Uint8Array([0x00, 0x00, 0x00]));
    const statuses = await verify(broken);
    expect(statuses.map((s) => [s.fieldName, s.verdict, s.problem])).toEqual([
      ['Firma 1', 'valid', null],
      ['Firma 2', 'unknown', MSG_UNREADABLE],
    ]);
  });

  it('firma con ECDSA P-256 hecha con openssl (atributos firmados) → valid, y pdfsig la confirma', async () => {
    const pdf = await signedWithOpenssl({ key: 'ec', md: 'sha256' });
    const [status] = await verify(pdf);
    expect(status).toMatchObject({ verdict: 'valid', problem: null, changedAfter: false });
    expect(status?.signer?.subject).toBe('Prueba EC');
    expect(pdfsig(pdf).output).toContain('Signature Validation: Signature is Valid.');
  });

  it('firma ECDSA con el último byte alterado → invalid (la firma no es válida)', async () => {
    const pdf = await signedWithOpenssl({ key: 'ec', md: 'sha256' });
    const cms = opensslCms(signedRangesOf(pdf), { key: 'ec', md: 'sha256' });
    const tampered = new Uint8Array(cms);
    tampered[tampered.length - 1] = (tampered[tampered.length - 1] ?? 0) ^ 0x01;
    const [status] = await verify(withCms(pdf, tampered));
    expect(status).toMatchObject({ verdict: 'invalid', problem: MSG_INVALID });
  });

  it.each([
    { key: 'rsa', md: 'sha1' },
    { key: 'rsa', md: 'sha256' },
    { key: 'rsa', md: 'sha384' },
    { key: 'rsa', md: 'sha512' },
    { key: 'ec', md: 'sha256' },
    { key: 'ec', md: 'sha384' },
    { key: 'ec', md: 'sha512' },
  ] as const)('openssl $key con $md: valid', async (options) => {
    const [status] = await verify(await signedWithOpenssl(options));
    expect(status).toMatchObject({ verdict: 'valid', problem: null });
  });

  it('firma RSA sin atributos firmados (-noattr): se valida contra el resumen de los rangos', async () => {
    const [status] = await verify(await signedWithOpenssl({ key: 'rsa', md: 'sha256', noAttr: true }));
    expect(status).toMatchObject({ verdict: 'valid', problem: null });
  });

  it('firma ECDSA sin atributos firmados → unknown (WebCrypto no verifica resúmenes precalculados)', async () => {
    const [status] = await verify(await signedWithOpenssl({ key: 'ec', md: 'sha256', noAttr: true }));
    expect(status).toMatchObject({ verdict: 'unknown', problem: MSG_UNSUPPORTED });
  });

  it('firma sin el certificado del firmante en el CMS → unknown', async () => {
    const [status] = await verify(await signedWithOpenssl({ key: 'rsa', md: 'sha256', noCerts: true }));
    expect(status).toMatchObject({ verdict: 'unknown', problem: MSG_NO_CERT, signer: null });
  });

  it('subfiltro adbe.pkcs7.sha1 → unknown (tipo no admitido), sin cambios posteriores', async () => {
    const pdf = replaceLastSignatureText(await signed(fixture('basic-5.pdf')), '/ETSI.CAdES.detached', '/adbe.pkcs7.sha1    ');
    const [status] = await verify(pdf);
    expect(status).toMatchObject({ subFilter: 'adbe.pkcs7.sha1', verdict: 'unknown', problem: MSG_UNSUPPORTED, changedAfter: false });
  });

  it('/ByteRange que se sale del fichero → invalid (no cubre el documento)', async () => {
    const pdf = await signed(fixture('basic-5.pdf'));
    const text = latin1(pdf);
    const m = BYTE_RANGE.exec(text);
    if (m === null || m.index === undefined) throw new Error('sin /ByteRange');
    const replacement = `/ByteRange [0 ${m[1]?.padEnd(10)} ${m[2]?.padEnd(10)} ${'9999999999'}]`;
    expect(replacement).toHaveLength(m[0].length);
    const broken = fromLatin1(text.slice(0, m.index) + replacement + text.slice(m.index + m[0].length));
    const [status] = await verify(broken);
    expect(status).toMatchObject({ verdict: 'invalid', problem: MSG_RANGE, changedAfter: false });
  });

  it('firmante sin CN: el nombre es el DN completo, igual que en p12.ts', async () => {
    const [status] = await verify(await signed(fixture('basic-5.pdf'), identity(certFixtures().noCn)));
    expect(status?.signer).toEqual(identity(certFixtures().noCn).info);
    expect(status?.signer?.subject).toBe('O=Prueba, C=ES');
  });

  it('PDF sin firmas → ok([])', async () => {
    expect(await verify(fixture('basic-5.pdf'))).toEqual([]);
  });

  it('form-full.pdf (campos sin firmar) → ok([])', async () => {
    expect(await verify(fixture('form-full.pdf'))).toEqual([]);
  });

  it('un documento cuya raíz no se puede leer → error corrupt', async () => {
    const broken = {
      xref: { trailer: new Map() },
      resolve: async () => {
        throw new Error('raíz ilegible');
      },
    } as unknown as ObjectReader;
    const result = await verifySignatures(memorySource(fixture('basic-5.pdf')), broken);
    expect(result).toMatchObject({ ok: false, error: { code: 'corrupt' } });
  });
});

describe('operación verify-signatures', () => {
  const context = (data: Uint8Array) => ({
    sources: [memorySource(data)],
    signal: new AbortController().signal,
    progress: () => undefined,
  });

  it('devuelve el estado de cada firma del PDF', async () => {
    const pdf = await signed(fixture('basic-5.pdf'));
    const result = await verifySignaturesOp({ password: null }, context(pdf));
    expect(result).toMatchObject({ ok: true, value: [{ fieldName: 'Firma 1', verdict: 'valid' }] });
  });

  it('argumentos no válidos → TypeError (es un bug del código que llama)', async () => {
    await expect(verifySignaturesOp({ password: 7 }, context(fixture('basic-5.pdf')))).rejects.toThrow(TypeError);
  });
});
