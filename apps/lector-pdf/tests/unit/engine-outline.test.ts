import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { memorySource } from '@suite/platform';
import { afterAll, describe, expect, it } from 'vitest';
import type { OutlineNode } from '../../src/core/outline';
import { getOutline } from '../../src/engine/outline';
import { loadPdf, type LoadedPdf } from '../../src/engine/load';
import { CORPUS_DIR } from '../fixtures/paths';
import { fixtureSource, nodeAssetBase } from '../helpers/pdfjs-node';

const assetBaseUrl = nodeAssetBase();
const OPEN_TIMEOUT = 30_000;

const opened: LoadedPdf[] = [];

async function open(source: ReturnType<typeof fixtureSource>): Promise<LoadedPdf> {
  const result = await loadPdf(source, { assetBaseUrl });
  if (!result.ok) throw new Error(`no se abre el documento: ${result.error.message}`);
  opened.push(result.value);
  return result.value;
}

afterAll(async () => {
  await Promise.all(opened.map((loaded) => loaded.destroy()));
});

/** Título de cada raíz, en orden. */
function rootTitles(nodes: readonly OutlineNode[]): string[] {
  return nodes.map((n) => n.title);
}

describe('motor de índice con outline.pdf', () => {
  it('lee 5 raíces con los títulos, estilos y destinos del PDF', async () => {
    const loaded = await open(fixtureSource('outline.pdf'));
    const nodes = await getOutline(loaded.doc);

    expect(rootTitles(nodes)).toEqual(['Capítulo 1', 'Capítulo 2', 'Capítulo 3', 'Anexo', 'Sitio web']);
    expect(nodes.map((n) => n.id)).toEqual(['0', '1', '2', '3', '4']);

    const chapter1 = nodes[0];
    expect(chapter1?.bold).toBe(true);
    expect(chapter1?.target.kind).toBe('internal');
    expect(chapter1?.children.map((n) => n.id)).toEqual(['0.0', '0.1']);
    expect(chapter1?.children[0]?.children[0]?.id).toBe('0.0.0');
    expect(chapter1?.children[0]?.children[0]?.title).toBe('Apartado 1.1.1');

    // «Capítulo 3» se guarda cerrado en el PDF.
    expect(nodes[2]?.initiallyExpanded).toBe(false);
    expect(nodes[2]?.children).toHaveLength(2);

    // «Sección 2.1» va en cursiva.
    expect(nodes[1]?.children[0]?.italic).toBe(true);

    // Un destino con nombre (/Dest) se resuelve como interno; un URI, como externo.
    expect(nodes[3]?.target).toEqual({ kind: 'internal', dest: 'anexo' });
    expect(nodes[4]?.target).toEqual({ kind: 'external', url: 'https://example.org/' });
  }, OPEN_TIMEOUT);
});

describe('motor de índice con otros documentos', () => {
  it('un PDF sin marcadores (basic-5.pdf) da un índice vacío', async () => {
    const loaded = await open(fixtureSource('basic-5.pdf'));
    expect(await getOutline(loaded.doc)).toEqual([]);
  }, OPEN_TIMEOUT);

  it('compressed.pdf (xref comprimido) devuelve al menos un marcador', async () => {
    const source = fixtureSource('compressed.pdf');
    const loaded = await open(source);
    const nodes = await getOutline(loaded.doc);
    expect(nodes.length).toBeGreaterThan(0);
  }, OPEN_TIMEOUT);

  it('informe.pdf (corpus LibreOffice) lee su índice sin lanzar', async () => {
    const bytes = new Uint8Array(readFileSync(join(CORPUS_DIR, 'libreoffice', 'informe.pdf')));
    const loaded = await open(memorySource(bytes));
    const nodes = await getOutline(loaded.doc);
    expect(Array.isArray(nodes)).toBe(true);
  }, OPEN_TIMEOUT);
});
