import { createHash } from 'node:crypto';
import { readFileSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { memorySource } from '@suite/platform';
import { describe, expect, it } from 'vitest';
import {
  diffAnnotations,
  type Annotation,
  type AnnotationDiff,
  type AnnotationEdits,
} from '../../src/core/annotations';
import { decryptValue, type RandomBytes } from '../../src/core/pdf/crypt-rules';
import { encryptValue } from '../../src/core/pdf/encrypt-value';
import { buildIncrementalUpdate, openForSave } from '../../src/core/pdf/incremental';
import { ObjectReader } from '../../src/core/pdf/object-reader';
import type { SecurityHandler } from '../../src/core/pdf/crypto';
import { bytesString, dict, dictGet, name, ref, stream, type PdfDict, type PdfString, type PdfValue } from '../../src/core/pdf/objects';
import { loadPdf } from '../../src/engine';
import { readPageAnnotations } from '../../src/engine/annotations-import';
import { appendIncrementalUpdate } from '../fixtures/pdf-builder';
import { FIXTURES_DIR } from '../fixtures/paths';
import { run } from '../support/qpdf';
import { nodeAssetBase } from '../helpers/pdfjs-node';
import { newAnnotation, T0 } from './annotations/factories';

const assetBaseUrl = nodeAssetBase();
const NOW = '2026-10-18T09:30:00.000Z';
const USER = 'usuario';
const OWNER = 'propietario';

/** Cifrados que se abren con la contraseña de usuario. */
const WITH_PASSWORD = [
  'encrypted-rc4-40.pdf',
  'encrypted-rc4-128.pdf',
  'encrypted-aes-128.pdf',
  'encrypted-aes-256.pdf',
  'encrypted-aes-256-objstm.pdf',
  'encrypted-annotated-aes-128.pdf',
] as const;
/** Cifrado solo de propietario: se abre con la contraseña de usuario vacía. */
const OWNER_ONLY = 'encrypted-owner-only.pdf';

const CASES: ReadonlyArray<{ readonly file: string; readonly password: string }> = [
  ...WITH_PASSWORD.map((file) => ({ file, password: USER })),
  { file: OWNER_ONLY, password: '' },
];

function fixtureBytes(file: string): Uint8Array {
  return new Uint8Array(readFileSync(join(FIXTURES_DIR, file)));
}

function concat(a: Uint8Array, b: Uint8Array): Uint8Array {
  const out = new Uint8Array(a.length + b.length);
  out.set(a, 0);
  out.set(b, a.length);
  return out;
}

/** Generador de IV determinista: la misma secuencia en cada guardado. */
function counterRandom(): RandomBytes {
  let next = 1;
  return (n) => Uint8Array.from({ length: n }, () => (next = (next * 73 + 41) & 0xff));
}

/** Diferencia entre una línea base y unos cambios (sin pasar por la UI). */
function diffOf(
  baseline: readonly Annotation[],
  upserts: readonly Annotation[],
  removed: readonly Annotation[] = [],
): AnnotationDiff {
  const edits: AnnotationEdits = {
    upserts: new Map(upserts.map((a) => [a.id, a] as const)),
    removed: new Set(removed.map((a) => a.id)),
    fields: new Map(),
  };
  return diffAnnotations(new Map(baseline.map((a) => [a.id, a] as const)), edits);
}

/** Anotaciones que pdf.js ve en todas las páginas (las que la app importa). */
async function annotationsOf(data: Uint8Array, password: string): Promise<Annotation[]> {
  const result = await loadPdf(memorySource(data), {
    assetBaseUrl,
    ...(password === '' ? {} : { password }),
  });
  if (!result.ok) throw new Error(`pdf.js no abre el documento: ${result.error.code}`);
  const loaded = result.value;
  try {
    const all: Annotation[] = [];
    for (let p = 1; p <= loaded.numPages; p++) {
      const page = await loaded.doc.getPage(p);
      all.push(...(await readPageAnnotations(page, T0)).supported);
    }
    return all;
  } finally {
    await loaded.destroy();
  }
}

/** Valida con qpdf (con la contraseña de usuario si la hay) y devuelve el código de salida. */
function qpdfCheck(data: Uint8Array, password: string): number | null {
  const dir = mkdtempSync(join(tmpdir(), 'suite-pdf-cifrado-'));
  const file = join(dir, 'salida.pdf');
  try {
    writeFileSync(file, data);
    const args = ['--check', ...(password === '' ? [] : [`--password=${password}`]), file];
    return run(args).status;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** Primer elemento de `/ID` del trailer en hexadecimal, o `null` si falta. */
function firstIdString(trailer: PdfDict): string | null {
  const id = dictGet(trailer, 'ID');
  const first: PdfValue | undefined = Array.isArray(id) ? id[0] : undefined;
  if (typeof first !== 'object' || first === null || !('kind' in first) || first.kind !== 'string') return null;
  const str: PdfString = first;
  return Buffer.from(str.bytes).toString('hex');
}

/** Contenidos (bytes en hexadecimal, tal cual están en el fichero) de las anotaciones de una página (base 0). */
async function rawContentsOfPage(reader: ObjectReader, index: number): Promise<string[]> {
  const page = await reader.getDict(await reader.pageRef(index));
  if (page === null) throw new Error(`la página ${index + 1} no tiene diccionario`);
  const annots = await reader.resolve(dictGet(page, 'Annots'));
  if (!Array.isArray(annots)) return [];
  const out: string[] = [];
  for (const item of annots) {
    if (typeof item !== 'object' || item === null || !('kind' in item) || item.kind !== 'ref') continue;
    const annot = await reader.getDict(item);
    const contents = annot === null ? undefined : dictGet(annot, 'Contents');
    if (typeof contents === 'object' && contents !== null && 'kind' in contents && contents.kind === 'string') {
      out.push(Buffer.from(contents.bytes).toString('hex'));
    }
  }
  return out;
}

describe('ObjectReader sobre PDFs cifrados', () => {
  it('encrypted-annotated-aes-128.pdf con usuario: los contenidos de la p2 se leen en claro, igual que en annotated.pdf', async () => {
    const plain = await ObjectReader.open(memorySource(fixtureBytes('annotated.pdf')));
    const encrypted = await ObjectReader.open(memorySource(fixtureBytes('encrypted-annotated-aes-128.pdf')), { password: USER });
    const expected = await rawContentsOfPage(plain, 1);
    expect(expected.length).toBeGreaterThan(0);
    expect(await rawContentsOfPage(encrypted, 1)).toEqual(expected);
    expect(encrypted.security?.authenticatedAs).toBe('user');
  });

  it('encrypted-aes-256-objstm.pdf con usuario: lee los objetos comprimidos y localiza las 50 páginas', async () => {
    const reader = await ObjectReader.open(memorySource(fixtureBytes('encrypted-aes-256-objstm.pdf')), { password: USER });
    expect(await reader.pageCount()).toBe(50);
    for (const index of [0, 24, 49]) {
      const page = await reader.getDict(await reader.pageRef(index));
      expect(page).not.toBeNull();
      expect(dictGet(page ?? dict({}), 'Type')).toEqual(name('Page'));
    }
  });

  it('el diccionario /Encrypt no se descifra y el trailer apunta a él', async () => {
    const reader = await ObjectReader.open(memorySource(fixtureBytes('encrypted-aes-128.pdf')), { password: USER });
    expect(reader.encryptRef).not.toBeNull();
    const encrypt = reader.encryptRef === null ? null : await reader.getDict(reader.encryptRef);
    expect(encrypt === null ? undefined : dictGet(encrypt, 'Filter')).toEqual(name('Standard'));
  });

  it('un PDF sin cifrar no tiene manejador de seguridad', async () => {
    const reader = await ObjectReader.open(memorySource(fixtureBytes('basic-5.pdf')));
    expect(reader.security).toBeNull();
    expect(reader.encryptRef).toBeNull();
  });

  it('contraseña incorrecta al abrir → wrong-password (de usuario o de propietario sin acierto)', async () => {
    await expect(
      ObjectReader.open(memorySource(fixtureBytes('encrypted-aes-128.pdf')), { password: 'mal' }),
    ).rejects.toMatchObject({ message: 'wrong-password' });
    await expect(ObjectReader.open(memorySource(fixtureBytes('encrypted-aes-128.pdf')))).rejects.toMatchObject({
      message: 'wrong-password',
    });
  });

  it('encrypted-owner-only.pdf: con vacía entra como usuario; con la de propietario, como propietario', async () => {
    const asUser = await ObjectReader.open(memorySource(fixtureBytes(OWNER_ONLY)));
    expect(asUser.security?.authenticatedAs).toBe('user');
    const asOwner = await ObjectReader.open(memorySource(fixtureBytes(OWNER_ONLY)), { password: OWNER });
    expect(asOwner.security?.authenticatedAs).toBe('owner');
    expect(asOwner.security?.fileKey).toEqual(asUser.security?.fileKey);
  });

  it('usa el generador de IV que se le pasa', async () => {
    const reader = await ObjectReader.open(memorySource(fixtureBytes('basic-5.pdf')), { random: counterRandom() });
    expect(reader.random(4)).toEqual(counterRandom()(4));
  });
});

describe('escritura sin cifrar (regresión)', () => {
  it('basic-5.pdf con un resaltado y now fijo: el delta es byte a byte el de antes de PDF-093', async () => {
    const data = fixtureBytes('basic-5.pdf');
    const source = memorySource(data);
    const opened = await openForSave(source);
    if (!opened.ok) throw new Error(`openForSave: ${opened.error.code}`);
    const highlight = { ...newAnnotation('suite-hl', 'highlight', 0), contents: 'Resaltado', author: 'Ana Pérez' };
    const diff = diffOf([], [highlight]);
    const result = await buildIncrementalUpdate({ source, reader: opened.value, diff, now: NOW });
    if (!result.ok) throw new Error(`buildIncrementalUpdate: ${result.error.code}`);
    expect(result.value.delta.length).toBe(874);
    expect(createHash('sha256').update(result.value.delta).digest('hex')).toBe(
      '9fe763487ed6bceb164725822676d16b6ebaaab854bed29f1f207ac25010ed86',
    );
  });
});

describe('openForSave sobre PDFs cifrados', () => {
  it('contraseña incorrecta → save-wrong-password y el fichero de entrada no cambia', async () => {
    const data = fixtureBytes('encrypted-aes-128.pdf');
    const before = data.slice();
    const result = await openForSave(memorySource(data), 'mal');
    expect(result).toEqual({ ok: false, error: expect.objectContaining({ code: 'save-wrong-password' }) });
    expect(data).toEqual(before);
  });

  it('sin contraseña en un PDF de usuario → save-wrong-password', async () => {
    const result = await openForSave(memorySource(fixtureBytes('encrypted-rc4-128.pdf')));
    expect(result).toEqual({ ok: false, error: expect.objectContaining({ code: 'save-wrong-password' }) });
  });

  it('/Filter /FooBar → save-encryption-unsupported, sin excepción', async () => {
    const data = appendIncrementalUpdate(fixtureBytes('basic-5.pdf'), new Map([[9, '<< /Filter /FooBar >>']]), '/Encrypt 9 0 R');
    const result = await openForSave(memorySource(data), '');
    expect(result).toEqual({ ok: false, error: expect.objectContaining({ code: 'save-encryption-unsupported' }) });
  });
});

describe('escritura incremental sobre PDFs cifrados', () => {
  it.each(CASES)('$file: resaltado y nota «Cifrado ñ €» se leen con pdf.js y qpdf valida el resultado', async ({ file, password }) => {
    const data = fixtureBytes(file);
    const source = memorySource(data);
    const opened = await openForSave(source, password);
    if (!opened.ok) throw new Error(`openForSave: ${opened.error.code}`);
    const baseline = await annotationsOf(data, password);

    const highlight = { ...newAnnotation('suite-hl', 'highlight', 0), contents: '' };
    const note = { ...newAnnotation('suite-note', 'note', 0), contents: 'Cifrado ñ €', author: 'Ana' };
    const removed = file === 'encrypted-annotated-aes-128.pdf' ? baseline.filter((a) => a.pageIndex === 1).slice(0, 1) : [];
    const modified = file === 'encrypted-annotated-aes-128.pdf' ? baseline.filter((a) => a.pageIndex === 0).slice(0, 1) : [];
    const edited = modified.map((a) => ({ ...a, contents: 'Modificado ñ €' }));
    const diff = diffOf(baseline, [highlight, note, ...edited], removed);

    const result = await buildIncrementalUpdate({ source, reader: opened.value, diff, now: NOW });
    if (!result.ok) throw new Error(`buildIncrementalUpdate: ${result.error.code}`);
    const out = concat(data, result.value.delta);

    const after = await annotationsOf(out, password);
    const highlights = (list: readonly Annotation[]): number => list.filter((a) => a.type === 'highlight').length;
    expect(after.length).toBe(baseline.length - removed.length + 2);
    expect(highlights(after)).toBe(highlights(baseline) + 1);
    expect(after.some((a) => a.type === 'note' && a.contents === 'Cifrado ñ €')).toBe(true);
    for (const a of edited) expect(after.find((x) => x.id === a.id)?.contents).toBe('Modificado ñ €');
    for (const a of removed) expect(after.some((x) => x.id === a.id)).toBe(false);

    expect(qpdfCheck(out, password)).toBe(0);
  });

  it('el trailer del incremento lleva /Encrypt con la misma referencia y /ID[0] original', async () => {
    const data = fixtureBytes('encrypted-annotated-aes-128.pdf');
    const source = memorySource(data);
    const opened = await openForSave(source, USER);
    if (!opened.ok) throw new Error(`openForSave: ${opened.error.code}`);
    const result = await buildIncrementalUpdate({
      source,
      reader: opened.value,
      diff: diffOf([], [{ ...newAnnotation('suite-hl', 'highlight', 0), contents: '' }]),
      now: NOW,
    });
    if (!result.ok) throw new Error(`buildIncrementalUpdate: ${result.error.code}`);
    const out = concat(data, result.value.delta);

    const written = await ObjectReader.open(memorySource(out), { password: USER });
    expect(written.encryptRef).toEqual(opened.value.encryptRef);
    const originalFirst = firstIdString(opened.value.xref.trailer);
    expect(originalFirst).not.toBeNull();
    expect(firstIdString(written.xref.trailer)).toEqual(originalFirst);
  });

  it('con IV fijo el delta es determinista; con IV aleatorio, dos guardados difieren y ambos son válidos', async () => {
    const data = fixtureBytes('encrypted-aes-128.pdf');
    const save = async (random?: RandomBytes): Promise<Uint8Array> => {
      const source = memorySource(data);
      const opened = await openForSave(source, USER);
      if (!opened.ok) throw new Error(`openForSave: ${opened.error.code}`);
      const diff = diffOf([], [{ ...newAnnotation('suite-hl', 'highlight', 0), contents: '' }]);
      const result = await buildIncrementalUpdate({
        source,
        reader: opened.value,
        diff,
        now: NOW,
        ...(random === undefined ? {} : { random }),
      });
      if (!result.ok) throw new Error(`buildIncrementalUpdate: ${result.error.code}`);
      return result.value.delta;
    };

    expect(await save(counterRandom())).toEqual(await save(counterRandom()));
    const first = concat(data, await save());
    const second = concat(data, await save());
    expect(first).not.toEqual(second);
    expect(qpdfCheck(first, USER)).toBe(0);
    expect(qpdfCheck(second, USER)).toBe(0);
  });
});

describe('encryptValue y decryptValue', () => {
  const handler: SecurityHandler = {
    revision: 4,
    fileKey: Uint8Array.from({ length: 16 }, (_, i) => i + 1),
    stringMethod: 'aes128',
    streamMethod: 'aes128',
    encryptMetadata: true,
    permissions: -4,
    authenticatedAs: 'user',
  };
  const random = counterRandom();
  const body = new Uint8Array([72, 111, 108, 97, 32, 1, 2, 3]);

  it('ida y vuelta: cadenas y datos de flujo recuperan el original', () => {
    const value = dict({
      Contents: bytesString(new Uint8Array([0xc3, 0xb1, 0x20, 0xe2, 0x82, 0xac])),
      Obj: stream({ Type: name('Foo'), Length: 8 }, body),
    });
    const encrypted = encryptValue(handler, 5, 0, value, random);
    expect(decryptValue(handler, 5, 0, encrypted)).toEqual(value);
  });

  it('el flujo cifrado tiene /Length igual al tamaño de sus datos, aunque /Length fuera una referencia', () => {
    const value = stream({ Length: ref(7) }, body);
    const encrypted = encryptValue(handler, 5, 0, value, random);
    if (typeof encrypted !== 'object' || encrypted === null || !('kind' in encrypted) || encrypted.kind !== 'stream') {
      throw new Error('se esperaba un flujo');
    }
    expect(dictGet(encrypted.dict, 'Length')).toBe(encrypted.data.length);
    expect(encrypted.data.length).toBe(16 + 16);
  });

  it('los flujos /XRef no se cifran', () => {
    const value = stream({ Type: name('XRef') }, body);
    expect(encryptValue(handler, 5, 0, value, random)).toEqual(value);
  });

  it('el flujo /Metadata no se cifra si EncryptMetadata es false', () => {
    const value = stream({ Type: name('Metadata') }, body);
    const plain = { ...handler, encryptMetadata: false };
    expect(encryptValue(plain, 5, 0, value, random)).toEqual(value);
    expect(encryptValue(handler, 5, 0, value, random)).not.toEqual(value);
  });

  it('los flujos con /Filter /Crypt /Name /Identity no se cifran; con otro nombre sí', () => {
    const identity = stream({ Filter: name('Crypt'), DecodeParms: dict({ Name: name('Identity') }) }, body);
    expect(encryptValue(handler, 5, 0, identity, random)).toEqual(identity);
    const other = stream({ Filter: name('Crypt'), DecodeParms: dict({ Name: name('StdCF') }) }, body);
    expect(encryptValue(handler, 5, 0, other, random)).not.toEqual(other);
  });

  it('un diccionario sin cadenas ni flujos pasa intacto', () => {
    const value: PdfDict = dict({ Count: 3, Kids: [ref(2)], Flag: true, Nothing: null });
    expect(encryptValue(handler, 5, 0, value, random)).toEqual(value);
  });

  it('valores no cifrables (números, arrays de números) pasan intactos', () => {
    const value: PdfValue = [1, 2.5, false];
    expect(encryptValue(handler, 5, 0, value, random)).toEqual(value);
  });
});
