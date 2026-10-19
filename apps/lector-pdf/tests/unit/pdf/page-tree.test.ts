/**
 * Reorganización de páginas por actualización incremental (PDF-052, ADR-0028). Cada prueba escribe el
 * incremento sobre un fixture, concatena original + delta y comprueba el resultado con pdf.js (el visor)
 * y con qpdf (lector independiente). Requiere `qpdf` en el PATH.
 */
import { Buffer } from 'node:buffer';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { memorySource } from '@suite/platform';
import { afterAll, describe, expect, it } from 'vitest';
import { loadPdf, type PDFDocumentProxy } from '../../../src/engine';
import { resolveDest } from '../../../src/engine/dest';
import { getOutline } from '../../../src/engine/outline';
import type { OutlineNode } from '../../../src/core/outline';
import { openForSave } from '../../../src/core/pdf/incremental';
import { ObjectReader } from '../../../src/core/pdf/object-reader';
import { dictGet } from '../../../src/core/pdf/objects';
import {
  buildPageTreeUpdate,
  readPageRotations,
  type PageRotation,
  type PageSlot,
} from '../../../src/core/pdf/page-tree';
import { FIXTURES_DIR } from '../../fixtures/paths';
import { PdfBuilder, textPage } from '../../fixtures/pdf-builder';
import { nodeAssetBase } from '../../helpers/pdfjs-node';
import { qpdfCheck, run } from '../../support/qpdf';

const assetBaseUrl = nodeAssetBase();
const NOW = '2026-10-19T10:00:00.000Z';
const tempDirs: string[] = [];

afterAll(() => {
  for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true });
});

function fixture(name: string): Uint8Array {
  return new Uint8Array(readFileSync(join(FIXTURES_DIR, name)));
}

/** Páginas en el orden `sources`, todas con giro 0 salvo que se indique otro. */
function slots(sources: readonly number[], rotate: PageRotation = 0): PageSlot[] {
  return sources.map((source) => ({ source, rotate }));
}

function joined(original: Uint8Array, delta: Uint8Array): Uint8Array {
  const out = new Uint8Array(original.length + delta.length);
  out.set(original, 0);
  out.set(delta, original.length);
  return out;
}

/** Escribe el incremento de `pages` sobre `bytes` y devuelve el fichero resultante junto con el resultado. */
async function organize(bytes: Uint8Array, pages: readonly PageSlot[], password?: string) {
  const source = memorySource(bytes);
  const opened = await openForSave(source, password);
  if (!opened.ok) throw new Error(`openForSave falló: ${opened.error.code}`);
  const result = await buildPageTreeUpdate({ source, reader: opened.value, pages, now: NOW });
  if (!result.ok) throw new Error(`buildPageTreeUpdate falló: ${result.error.code}`);
  const out = joined(bytes, result.value.delta);
  expect(result.value.expectedSize).toBe(out.length);
  return { bytes: out, result: result.value };
}

async function withPdf<T>(bytes: Uint8Array, fn: (doc: PDFDocumentProxy) => Promise<T>, password?: string): Promise<T> {
  const opened = await loadPdf(memorySource(bytes), password === undefined ? { assetBaseUrl } : { assetBaseUrl, password });
  if (!opened.ok) throw new Error(`loadPdf falló: ${opened.error.code}`);
  const loaded = opened.value;
  try {
    return await fn(loaded.doc);
  } finally {
    await loaded.destroy();
  }
}

async function pageText(doc: PDFDocumentProxy, pageNumber: number): Promise<string> {
  const content = await (await doc.getPage(pageNumber)).getTextContent();
  return content.items.map((item) => ('str' in item ? item.str : '')).join('');
}

async function rotationsOf(doc: PDFDocumentProxy): Promise<number[]> {
  const out: number[] = [];
  for (let i = 1; i <= doc.numPages; i++) out.push((await doc.getPage(i)).rotate);
  return out;
}

function tempFile(bytes: Uint8Array): string {
  const dir = mkdtempSync(join(tmpdir(), 'page-tree-'));
  tempDirs.push(dir);
  const file = join(dir, 'out.pdf');
  writeFileSync(file, bytes);
  return file;
}

function expectQpdfOk(bytes: Uint8Array, password?: string): void {
  const check = qpdfCheck(tempFile(bytes), password);
  expect(check.code, check.output).toBe(0);
}

function qpdfPageCount(bytes: Uint8Array): number {
  const { status, stdout, stderr } = run(['--show-npages', tempFile(bytes)]);
  expect(status, stderr).toBe(0);
  return Number(stdout.trim());
}

/**
 * Documento de `pageRotates.length` páginas con `Contents`. La fuente F1 (que usa `textPage`) va en `/Resources`
 * del nodo /Pages raíz, así que las páginas la heredan. `rootAttrs` se añade al mismo nodo.
 */
function treeDocument(pageRotates: readonly (number | null)[], rootAttrs = ''): Uint8Array {
  const b = new PdfBuilder();
  const catalog = b.alloc();
  const pages = b.alloc();
  const font = b.addObject('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>');
  const n = pageRotates.length;
  const kids = pageRotates.map((rotate, i) => {
    const content = b.addStream('<< >>', textPage([`Página ${i + 1} de ${n}`]));
    const rotateEntry = rotate === null ? '' : ` /Rotate ${rotate}`;
    return b.addObject(`<< /Type /Page /Parent ${pages} 0 R /Contents ${content} 0 R${rotateEntry} >>`);
  });
  b.setObject(pages, `<< /Type /Pages /Kids [${kids.map((k) => `${k} 0 R`).join(' ')}] /Count ${n} /MediaBox [0 0 612 792] /Resources << /Font << /F1 ${font} 0 R >> >>${rootAttrs} >>`);
  b.setObject(catalog, `<< /Type /Catalog /Pages ${pages} 0 R >>`);
  return b.build({ root: catalog });
}

/** Títulos y destinos internos de un índice, en orden de recorrido. */
function flatOutline(nodes: readonly OutlineNode[]): OutlineNode[] {
  return nodes.flatMap((node) => [node, ...flatOutline(node.children)]);
}

describe('reordenar, borrar y girar páginas (PDF-052)', () => {
  it('basic-5.pdf con pages = [4,3,2,1,0]: pdf.js lee el orden invertido y qpdf valida', async () => {
    const { bytes } = await organize(fixture('basic-5.pdf'), slots([4, 3, 2, 1, 0]));
    await withPdf(bytes, async (doc) => {
      expect(doc.numPages).toBe(5);
      for (let i = 0; i < 5; i++) {
        expect(await pageText(doc, i + 1)).toContain(`Página ${5 - i} de 5`);
      }
    });
    expectQpdfOk(bytes);
  });

  it('basic-5.pdf borrando la página 2: pdf.js y qpdf ven 4 páginas', async () => {
    const { bytes } = await organize(fixture('basic-5.pdf'), slots([0, 2, 3, 4]));
    await withPdf(bytes, async (doc) => {
      expect(doc.numPages).toBe(4);
      expect(await pageText(doc, 2)).toContain('Página 3 de 5');
    });
    expectQpdfOk(bytes);
    expect(qpdfPageCount(bytes)).toBe(4);
  });

  it('basic-5.pdf girando solo la página 3 a 90: reescribe una página y se deshace dejando /Rotate fuera', async () => {
    const original = fixture('basic-5.pdf');
    const turned = slots([0, 1, 2, 3, 4]).map((slot) => (slot.source === 2 ? { ...slot, rotate: 90 as const } : slot));
    const first = await organize(original, turned);
    expect(first.result.rewrittenPages).toBe(1);
    await withPdf(first.bytes, async (doc) => {
      expect(await rotationsOf(doc)).toEqual([0, 0, 90, 0, 0]);
    });
    expectQpdfOk(first.bytes);

    const back = await organize(first.bytes, slots([0, 1, 2, 3, 4]));
    expect(back.result.rewrittenPages).toBe(1);
    await withPdf(back.bytes, async (doc) => {
      expect(await rotationsOf(doc)).toEqual([0, 0, 0, 0, 0]);
    });
    const source = memorySource(back.bytes);
    const opened = await ObjectReader.open(source);
    const page3 = await opened.getDict(await opened.pageRef(2));
    expect(page3 === null ? undefined : dictGet(page3, 'Rotate')).toBeUndefined();
  });

  it('sin cambios de giro, el incremento está vacío', async () => {
    const original = fixture('basic-5.pdf');
    const source = memorySource(original);
    const opened = await openForSave(source);
    if (!opened.ok) throw new Error(opened.error.code);
    const rotations = await readPageRotations(opened.value);
    if (!rotations.ok) throw new Error(rotations.error.code);
    const pages = rotations.value.map((rotate, index) => ({ source: index, rotate }));
    const result = await buildPageTreeUpdate({ source, reader: opened.value, pages, now: NOW });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.delta.length).toBe(0);
    expect(result.value.expectedSize).toBe(original.length);
    expect(result.value.rewrittenPages).toBe(0);
  });

  it('readPageRotations normaliza el giro propio a 0, 90, 180 o 270', async () => {
    const source = memorySource(treeDocument([-90, 450, 45, 350, 180]));
    const opened = await ObjectReader.open(source);
    const rotations = await readPageRotations(opened);
    expect(rotations).toEqual({ ok: true, value: [270, 90, 90, 0, 180] });
  });

  it('giro heredado de /Pages: readPageRotations lo lee y se conserva en pdf.js al reordenar', async () => {
    const original = treeDocument([null, null], ' /Rotate 90');
    const opened = await ObjectReader.open(memorySource(original));
    expect(await readPageRotations(opened)).toEqual({ ok: true, value: [90, 90] });

    const turned = await organize(original, slots([1, 0], 90));
    await withPdf(turned.bytes, async (doc) => {
      expect(await rotationsOf(doc)).toEqual([90, 90]);
      expect(await pageText(doc, 1)).toContain('Página 2 de 2');
    });
    expectQpdfOk(turned.bytes);

    const unturned = await organize(original, slots([1, 0], 0));
    await withPdf(unturned.bytes, async (doc) => {
      expect(await rotationsOf(doc)).toEqual([0, 0]);
    });
  });

  it('outline.pdf borrando la página 2: el índice conserva sus títulos y resuelve a los nuevos índices', async () => {
    const original = fixture('outline.pdf');
    const before = await withPdf(original, async (doc) => {
      const nodes = flatOutline(await getOutline(doc));
      const targets: (number | null)[] = [];
      for (const node of nodes) targets.push(node.target.kind === 'internal' ? (await resolveDest(doc, node.target.dest))?.pageIndex ?? null : null);
      return { titles: nodes.map((n) => n.title), targets };
    });
    const { bytes } = await organize(original, slots(Array.from({ length: 30 }, (_, i) => i).filter((i) => i !== 1)));

    await withPdf(bytes, async (doc) => {
      const nodes = flatOutline(await getOutline(doc));
      expect(nodes.map((n) => n.title)).toEqual(before.titles);
      for (const [i, node] of nodes.entries()) {
        const old = before.targets[i] ?? null;
        const resolved = node.target.kind === 'internal' ? await resolveDest(doc, node.target.dest) : null;
        const expected = old === null ? null : old === 1 ? null : old > 1 ? old - 1 : old;
        expect(resolved?.pageIndex ?? null, node.title).toBe(expected);
      }
    });
    expectQpdfOk(bytes);
  });

  it('outline.pdf borrando la página 3 (con destino en el índice): ese destino devuelve null sin lanzar', async () => {
    const original = fixture('outline.pdf');
    const { bytes } = await organize(original, slots(Array.from({ length: 30 }, (_, i) => i).filter((i) => i !== 2)));
    await withPdf(bytes, async (doc) => {
      const nodes = flatOutline(await getOutline(doc));
      const sectionOne = nodes.find((n) => n.title === 'Sección 1.1');
      expect(sectionOne).toBeDefined();
      if (sectionOne === undefined || sectionOne.target.kind !== 'internal') throw new Error('destino no interno');
      expect(await resolveDest(doc, sectionOne.target.dest)).toBeNull();
    });
  });

  it('links.pdf reordenando [1,0,…]: cada enlace sigue en su página y apunta al nuevo índice correcto', async () => {
    const original = fixture('links.pdf');
    const { bytes } = await organize(original, slots([1, 0, 2, 3, 4]));
    await withPdf(bytes, async (doc) => {
      expect(await pageText(doc, 2)).toContain('Enlaces de prueba');
      const page = await doc.getPage(2);
      const annotations = await page.getAnnotations({ intent: 'display' });
      const links = annotations.filter((a) => a.subtype === 'Link');
      expect(links).toHaveLength(8);
      const targets: number[] = [];
      for (const link of links) {
        if (link.dest === undefined || link.dest === null) continue;
        const resolved = await resolveDest(doc, link.dest);
        if (resolved !== null) targets.push(resolved.pageIndex);
      }
      // (a) página 3 → índice 2; (b) «destino-final» = página 5 → índice 4; (c) GoTo página 2 → índice 0.
      expect(targets.sort((x, y) => x - y)).toEqual([0, 2, 4]);
    });
    expectQpdfOk(bytes);
  });

  it('annotated.pdf reordenando y girando: subtipos, contenidos y autores siguen en su página', async () => {
    const original = fixture('annotated.pdf');
    type Summary = readonly { readonly subtype: string | undefined; readonly contents: string | undefined; readonly title: string | undefined }[];
    const summarize = (annotations: readonly unknown[]): Summary =>
      annotations.map((raw) => {
        const a = raw as { readonly subtype?: string; readonly contentsObj?: { readonly str?: string }; readonly titleObj?: { readonly str?: string } };
        return { subtype: a.subtype, contents: a.contentsObj?.str, title: a.titleObj?.str };
      });
    const before = await withPdf(original, async (doc) => {
      const out: Summary[] = [];
      for (let i = 1; i <= doc.numPages; i++) out.push(summarize(await (await doc.getPage(i)).getAnnotations({ intent: 'display' })));
      return out;
    });
    expect(before[0]?.some((a) => a.subtype === 'Highlight' && a.contents === 'Comentario previo')).toBe(true);

    const order = [2, 0, 1];
    const plan = order.map((source, i) => ({ source, rotate: (i === 0 ? 90 : 0) as PageRotation }));
    const { bytes } = await organize(original, plan);
    await withPdf(bytes, async (doc) => {
      for (const [i, source] of order.entries()) {
        const now = summarize(await (await doc.getPage(i + 1)).getAnnotations({ intent: 'display' }));
        expect(now).toEqual(before[source]);
      }
      expect(await rotationsOf(doc)).toEqual([90, 0, 0]);
    });
    expectQpdfOk(bytes);
  });

  it('encrypted-aes-256.pdf con contraseña «usuario»: borrar la página 1 deja 4 páginas legibles', async () => {
    const original = fixture('encrypted-aes-256.pdf');
    const { bytes } = await organize(original, slots([1, 2, 3, 4]), 'usuario');
    await withPdf(bytes, async (doc) => {
      expect(doc.numPages).toBe(4);
      expect(await pageText(doc, 1)).toContain('Página 2 de 5');
    }, 'usuario');
    expectQpdfOk(bytes, 'usuario');
  });

  it('compressed.pdf (xref en stream y object streams): borrar una página deja un fichero válido', async () => {
    const { bytes } = await organize(fixture('compressed.pdf'), slots(Array.from({ length: 50 }, (_, i) => i).filter((i) => i !== 1)));
    await withPdf(bytes, async (doc) => {
      expect(doc.numPages).toBe(49);
      expect(await pageText(doc, 2)).toContain('Página 3 de 50');
    });
    expectQpdfOk(bytes);
  });

  it('pages-5000.pdf borrando la página 2: 4 999 páginas, la última es la 5000', async () => {
    const { bytes } = await organize(fixture('pages-5000.pdf'), slots(Array.from({ length: 5000 }, (_, i) => i).filter((i) => i !== 1)));
    await withPdf(bytes, async (doc) => {
      expect(doc.numPages).toBe(4999);
      expect(await pageText(doc, 4999)).toContain('Página 5000');
    });
    expectQpdfOk(bytes);
  });

  it('un documento con más de 32 páginas se reorganiza en árbol: el resultado conserva el orden', async () => {
    const bytes = treeDocument(Array.from({ length: 40 }, () => null));
    const order = Array.from({ length: 40 }, (_, i) => 39 - i);
    const { bytes: out } = await organize(bytes, slots(order));
    await withPdf(out, async (doc) => {
      expect(doc.numPages).toBe(40);
      expect(await pageText(doc, 1)).toContain('Página 40 de 40');
      expect(await pageText(doc, 40)).toContain('Página 1 de 40');
    });
    expectQpdfOk(out);
  });

  it('entradas no válidas devuelven organize-invalid', async () => {
    const source = memorySource(fixture('basic-5.pdf'));
    const opened = await openForSave(source);
    if (!opened.ok) throw new Error(opened.error.code);
    const invalid: readonly (readonly PageSlot[])[] = [
      [],
      [{ source: 0, rotate: 0 }, { source: 0, rotate: 0 }],
      [{ source: -1, rotate: 0 }],
      [{ source: 5, rotate: 0 }],
      [{ source: 0, rotate: 45 as PageRotation }],
    ];
    for (const pages of invalid) {
      const result = await buildPageTreeUpdate({ source, reader: opened.value, pages, now: NOW });
      expect(result.ok ? 'ok' : result.error.code).toBe('organize-invalid');
    }
  });

  it('una señal abortada devuelve cancelled, tanto en solo giros como en reordenación', async () => {
    const source = memorySource(fixture('basic-5.pdf'));
    const opened = await openForSave(source);
    if (!opened.ok) throw new Error(opened.error.code);
    const controller = new AbortController();
    controller.abort();
    const turned = await buildPageTreeUpdate({ source, reader: opened.value, pages: slots([0, 1, 2, 3, 4], 90), now: NOW, signal: controller.signal });
    expect(turned.ok ? 'ok' : turned.error.code).toBe('cancelled');
    const reordered = await buildPageTreeUpdate({ source, reader: opened.value, pages: slots([4, 3, 2, 1, 0]), now: NOW, signal: controller.signal });
    expect(reordered.ok ? 'ok' : reordered.error.code).toBe('cancelled');
  });

  it('onProgress informa con total = pages.length y termina en done === total', async () => {
    const calls: [number, number][] = [];
    const source = memorySource(fixture('pages-5000.pdf'));
    const opened = await openForSave(source);
    if (!opened.ok) throw new Error(opened.error.code);
    const pages = slots(Array.from({ length: 5000 }, (_, i) => i).filter((i) => i !== 1));
    const result = await buildPageTreeUpdate({ source, reader: opened.value, pages, now: NOW, onProgress: (done, total) => calls.push([done, total]) });
    expect(result.ok).toBe(true);
    expect(calls.every(([, total]) => total === pages.length)).toBe(true);
    expect(calls.at(-1)).toEqual([pages.length, pages.length]);
    expect(calls.slice(0, -1).every(([done]) => done % 1000 === 0)).toBe(true);
    expect(calls.length).toBe(Math.floor(pages.length / 1000) + 1);
  });

  it('un catálogo que no es una referencia indirecta devuelve save-unreadable', async () => {
    const raw = Buffer.from(treeDocument([null, null, null])).toString('latin1');
    const direct = raw.replace('/Root 1 0 R', '/Root << /Type /Catalog /Pages 2 0 R >>');
    expect(direct).not.toBe(raw);
    const bytes = new Uint8Array(Buffer.from(direct, 'latin1'));
    const source = memorySource(bytes);
    const opened = await openForSave(source);
    if (!opened.ok) throw new Error(opened.error.code);
    const result = await buildPageTreeUpdate({ source, reader: opened.value, pages: slots([2, 1, 0]), now: NOW });
    expect(result.ok ? 'ok' : result.error.code).toBe('save-unreadable');
  });
});
