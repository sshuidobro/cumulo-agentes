import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { memorySource } from '@suite/platform';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { openForSave } from '../../../src/core/pdf/incremental';
import type { ObjectReader } from '../../../src/core/pdf/object-reader';
import { dictGet, type PdfRef, type PdfValue } from '../../../src/core/pdf/objects';
import { buildSignatureUpdate, SIGNATURE_CONTENTS_BYTES, type SignInput } from '../../../src/core/signature/digital/sign-pdf';
import { openP12, type SigningIdentity } from '../../../src/core/signature/digital/p12';
import { loadPdf } from '../../../src/engine';
import { PdfBuilder } from '../../fixtures/pdf-builder';
import { FIXTURES_DIR } from '../../fixtures/paths';
import { nodeAssetBase } from '../../helpers/pdfjs-node';
import { certFixtures, TEST_P12_PASSWORD } from '../../support/certs';
import { pdfsig } from '../../support/pdfsig';
import { qpdfCheck } from '../../support/qpdf';

const NOW = '2026-10-19T10:15:00.000Z';
const assetBaseUrl = nodeAssetBase();

let dir = '';

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'cumulo-sign-'));
});

afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

function identity(bytes: Uint8Array = certFixtures().rsaAes): SigningIdentity {
  const result = openP12(bytes, TEST_P12_PASSWORD);
  if (!result.ok) throw new Error(result.error.code);
  return result.value;
}

type Options = Partial<Omit<SignInput, 'source' | 'reader'>>;

/** Firma `source` (bytes del PDF) y devuelve el PDF resultante, o el código de error. */
async function sign(
  data: Uint8Array,
  options: Options = {},
  id: SigningIdentity = identity(),
  password?: string,
): Promise<{ readonly ok: true; readonly pdf: Uint8Array } | { readonly ok: false; readonly code: string }> {
  const source = memorySource(data);
  const opened = await openForSave(source, password);
  if (!opened.ok) throw new Error(`openForSave: ${opened.error.code}`);
  const result = await buildSignatureUpdate({
    source,
    reader: opened.value,
    identity: id,
    pageIndex: 0,
    rect: null,
    reason: '',
    location: '',
    now: NOW,
    ...options,
  });
  if (!result.ok) return { ok: false, code: result.error.code };
  expect(result.value.expectedSize).toBe(data.length + result.value.delta.length);
  return { ok: true, pdf: concat(data, result.value.delta) };
}

function concat(a: Uint8Array, b: Uint8Array): Uint8Array {
  const out = new Uint8Array(a.length + b.length);
  out.set(a, 0);
  out.set(b, a.length);
  return out;
}

function fixture(name: string): Uint8Array {
  return new Uint8Array(readFileSync(join(FIXTURES_DIR, name)));
}

/** Escribe el PDF en el directorio temporal y devuelve su ruta (para `qpdf` y `pdfsig`). */
function save(name: string, bytes: Uint8Array): string {
  const path = join(dir, name);
  writeFileSync(path, bytes);
  return path;
}

async function open(data: Uint8Array): Promise<ObjectReader> {
  const opened = await openForSave(memorySource(data));
  if (!opened.ok) throw new Error(opened.error.code);
  return opened.value;
}


describe('buildSignatureUpdate', () => {
  it('firma invisible de basic-5.pdf: pdfsig la da por válida y qpdf no encuentra errores', async () => {
    const signed = await sign(fixture('basic-5.pdf'));
    if (!signed.ok) throw new Error(signed.code);
    const path = save('invisible.pdf', signed.pdf);
    const check = pdfsig(signed.pdf);
    expect(check.output).toContain('Signature Validation: Signature is Valid.');
    expect(check.output).toContain('ETSI.CAdES.detached');
    expect(qpdfCheck(path).code).toBe(0);
  });

  it('firma visible en la página 2: el widget con apariencia aparece en esa página', async () => {
    const signed = await sign(fixture('basic-5.pdf'), { pageIndex: 1, rect: [72, 72, 272, 122] });
    if (!signed.ok) throw new Error(signed.code);
    expect(pdfsig(signed.pdf).output).toContain('Signature Validation: Signature is Valid.');
    const loaded = await loadPdf(memorySource(signed.pdf), { assetBaseUrl });
    if (!loaded.ok) throw new Error(loaded.error.code);
    const page = await loaded.value.doc.getPage(2);
    const annotations: readonly { readonly subtype?: string; readonly fieldType?: string; readonly fieldName?: string; readonly hasAppearance?: boolean }[] =
      await page.getAnnotations({ intent: 'display' });
    const widget = annotations.find((a) => a.subtype === 'Widget' && a.fieldType === 'Sig');
    expect(widget?.fieldName).toBe('Firma 1');
    expect(widget?.hasAppearance).toBe(true);
    await loaded.value.destroy();
  });

  it('firmar dos veces: pdfsig ve dos firmas válidas y la primera no cubre todo el documento', async () => {
    const first = await sign(fixture('basic-5.pdf'));
    if (!first.ok) throw new Error(first.code);
    const second = await sign(first.pdf, { now: '2026-10-19T11:00:00.000Z', reason: 'Segunda firma', location: 'Madrid' }, identity(certFixtures().chain));
    if (!second.ok) throw new Error(second.code);
    const check = pdfsig(second.pdf);
    expect(check.output.match(/Signature Validation: Signature is Valid\./g)).toHaveLength(2);
    expect(check.output).toContain('Not total document signed');
    expect(check.output).toContain('Firma 2');
    expect(qpdfCheck(save('dos.pdf', second.pdf)).code).toBe(0);
  });

  it('form-full.pdf: los campos existentes siguen y el de firma queda en /Fields', async () => {
    const original = fixture('form-full.pdf');
    const before = await fieldCount(await open(original));
    const signed = await sign(original, { pageIndex: 0, rect: [40, 40, 240, 90] });
    if (!signed.ok) throw new Error(signed.code);
    expect(pdfsig(signed.pdf).output).toContain('Signature Validation: Signature is Valid.');
    const after = await open(signed.pdf);
    expect(await fieldCount(after)).toBe(before + 1);
    expect(qpdfCheck(save('form-full-firmado.pdf', signed.pdf)).code).toBe(0);
  });

  it('compressed.pdf (xref de flujo) → pdfsig válido', async () => {
    const signed = await sign(fixture('compressed.pdf'));
    if (!signed.ok) throw new Error(signed.code);
    expect(pdfsig(signed.pdf).output).toContain('Signature Validation: Signature is Valid.');
  });

  it('un original de varios bloques de lectura (1,5 MB) se firma y valida', async () => {
    const signed = await sign(fixture('pages-5000.pdf'));
    if (!signed.ok) throw new Error(signed.code);
    expect(pdfsig(signed.pdf).output).toContain('Signature Validation: Signature is Valid.');
  });

  it('PDF cifrado → sign-encrypted', async () => {
    expect(await sign(fixture('encrypted-aes-256.pdf'), {}, identity(), 'usuario')).toEqual({ ok: false, code: 'sign-encrypted' });
  });

  it('motivo y lugar solo se escriben si no están vacíos', async () => {
    const plain = await sign(fixture('basic-5.pdf'));
    const full = await sign(fixture('basic-5.pdf'), { reason: 'Aprobado', location: 'Sevilla' });
    if (!plain.ok || !full.ok) throw new Error('firma fallida');
    const plainText = latin1(plain.pdf);
    const fullText = latin1(full.pdf);
    expect(plainText).not.toContain('/Reason');
    expect(plainText).not.toContain('/Location');
    expect(fullText).toContain('/Reason');
    expect(fullText).toContain('/Location');
    expect(fullText).toContain('/Name');
  });

  it('/AcroForm, /Fields y /Annots indirectos: el campo nuevo se numera tras los existentes y pdfsig valida', async () => {
    const original = acroPdf('indirect');
    const signed = await sign(original, { rect: [20, 20, 120, 60] });
    if (!signed.ok) throw new Error(signed.code);
    expect(pdfsig(signed.pdf).output).toContain('Signature Validation: Signature is Valid.');
    expect(pdfsig(signed.pdf).output).toContain('Firma 2');
    expect(await fieldCount(await open(signed.pdf))).toBe(3);
    expect(qpdfCheck(save('acro-indirecto.pdf', signed.pdf)).code).toBe(0);
  });

  it('/Annots directo en la página: el widget se añade a ese array', async () => {
    const signed = await sign(acroPdf('direct'), { rect: [20, 20, 120, 60] });
    if (!signed.ok) throw new Error(signed.code);
    expect(pdfsig(signed.pdf).output).toContain('Signature Validation: Signature is Valid.');
  });

  it('/Annots que no es array → save-unreadable', async () => {
    expect(await sign(acroPdf('invalid'))).toEqual({ ok: false, code: 'save-unreadable' });
  });

  it('página que no existe → save-unreadable', async () => {
    expect(await sign(fixture('basic-5.pdf'), { pageIndex: 999 })).toEqual({ ok: false, code: 'save-unreadable' });
  });

  it('firma con /Contents mayor que el hueco → sign-too-big', async () => {
    const id = identity();
    const big: SigningIdentity = { ...id, chainDer: Array.from({ length: 40 }, () => id.certDer) };
    expect(await sign(fixture('basic-5.pdf'), {}, big)).toEqual({ ok: false, code: 'sign-too-big' });
    expect(SIGNATURE_CONTENTS_BYTES).toBe(16384);
  });
});

/**
 * PDF de una página con `/AcroForm` indirecto, `/Fields` indirecto (un campo directo «Firma 1» y un nodo que se
 * referencia a sí mismo) y `/Annots` como array indirecto, directo o inválido (`mode`).
 */
function acroPdf(mode: 'indirect' | 'direct' | 'invalid'): Uint8Array {
  const b = new PdfBuilder();
  const catalog = b.alloc();
  const pages = b.alloc();
  const page = b.alloc();
  const content = b.addStream('<< >>', 'BT ET');
  const acro = b.alloc();
  const fields = b.alloc();
  const cyclic = b.alloc();
  const annotList = b.alloc();
  const note = b.alloc();
  const annots = mode === 'indirect' ? `${annotList} 0 R` : mode === 'direct' ? `[ ${note} 0 R ]` : '5';
  b.setObject(catalog, `<< /Type /Catalog /Pages ${pages} 0 R /AcroForm ${acro} 0 R >>`);
  b.setObject(pages, `<< /Type /Pages /Kids [${page} 0 R] /Count 1 >>`);
  b.setObject(page, `<< /Type /Page /Parent ${pages} 0 R /MediaBox [0 0 300 300] /Contents ${content} 0 R /Annots ${annots} >>`);
  b.setObject(acro, `<< /Fields ${fields} 0 R >>`);
  b.setObject(fields, `[ << /T (Firma 1) /FT /Tx >> ${cyclic} 0 R ]`);
  b.setObject(cyclic, `<< /T (Nombre) /Kids [${cyclic} 0 R] >>`);
  b.setObject(annotList, `[ ${note} 0 R ]`);
  b.setObject(note, '<< /Type /Annot /Subtype /Text /Rect [10 10 20 20] /Contents (Nota) >>');
  return b.build({ root: catalog });
}

/** Número de campos de primer nivel de `/AcroForm /Fields`, o 0 si no hay. */
async function fieldCount(reader: ObjectReader): Promise<number> {
  const catalog = await reader.getDict(dictGet(reader.xref.trailer, 'Root') as PdfRef);
  const acro = catalog === null ? undefined : await reader.resolve(dictGet(catalog, 'AcroForm'));
  if (acro === undefined || acro === null || typeof acro !== 'object' || !('kind' in acro) || acro.kind !== 'dict') return 0;
  const fields: PdfValue | undefined = await reader.resolve(dictGet(acro, 'Fields'));
  return Array.isArray(fields) ? fields.length : 0;
}

function latin1(bytes: Uint8Array): string {
  let out = '';
  for (const b of bytes) out += String.fromCharCode(b);
  return out;
}

