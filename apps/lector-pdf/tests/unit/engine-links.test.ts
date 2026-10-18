import { describe, expect, it } from 'vitest';
import type { LoadedPdf } from '../../src/engine/load';
import { loadPdf } from '../../src/engine/load';
import { resolveDest } from '../../src/engine/dest';
import { getPageLinks } from '../../src/engine/links';
import type { PDFPageProxy } from '../../src/engine/pdfjs';
import { fixtureSource, nodeAssetBase } from '../helpers/pdfjs-node';

const assetBaseUrl = nodeAssetBase();
const OPEN_TIMEOUT = 30_000;

async function open(name: string): Promise<LoadedPdf> {
  const result = await loadPdf(fixtureSource(name), { assetBaseUrl });
  if (!result.ok) throw new Error(`no se abre ${name}: ${result.error.message}`);
  return result.value;
}

describe('motor de enlaces con links.pdf', () => {
  it('los 8 enlaces se clasifican como se espera, en orden de página', async () => {
    const loaded = await open('links.pdf');
    try {
      const page = await loaded.doc.getPage(1);
      const links = await getPageLinks(page);
      expect(links.map((l) => l.target.kind)).toEqual([
        'internal', // (a) destino explícito a la página 3
        'internal', // (b) destino con nombre
        'internal', // (c) GoTo a la página 2
        'external', // (d) https
        'external', // (e) mailto
        'blocked', // (f) JavaScript
        'blocked', // (g) Launch
        'blocked', // (h) javascript:
      ]);
      expect(links[3]?.target).toEqual({ kind: 'external', url: 'https://example.org/ruta?x=1' });
      expect(links[4]?.target).toEqual({ kind: 'external', url: 'mailto:alguien@example.org' });
      expect(links[5]?.target).toEqual({ kind: 'blocked', reason: 'unsupported' });
      expect(links[7]?.target).toEqual({ kind: 'blocked', reason: 'unsafe-url' });
      for (const link of links) {
        expect(link.rect.every((n) => Number.isFinite(n))).toBe(true);
      }
    } finally {
      await loaded.destroy();
    }
  }, OPEN_TIMEOUT);

  it('resolveDest del enlace (a) va a la página 3 (índice 2) con yFraction ≈ 0,495', async () => {
    const loaded = await open('links.pdf');
    try {
      const page = await loaded.doc.getPage(1);
      const links = await getPageLinks(page);
      const first = links[0]?.target;
      expect(first?.kind).toBe('internal');
      if (first?.kind !== 'internal') return;
      const resolved = await resolveDest(loaded.doc, first.dest);
      expect(resolved?.pageIndex).toBe(2);
      expect(resolved?.yFraction).toBeCloseTo((792 - 400) / 792, 2);
      expect(resolved?.zoom).toBeNull();
    } finally {
      await loaded.destroy();
    }
  }, OPEN_TIMEOUT);

  it('resolveDest del destino nombrado «destino-final» va a la página 5 (índice 4) con zoom fit-page', async () => {
    const loaded = await open('links.pdf');
    try {
      const resolved = await resolveDest(loaded.doc, 'destino-final');
      expect(resolved?.pageIndex).toBe(4);
      expect(resolved?.zoom).toEqual({ kind: 'fit-page' });
    } finally {
      await loaded.destroy();
    }
  }, OPEN_TIMEOUT);

  it('un destino inexistente da null', async () => {
    const loaded = await open('links.pdf');
    try {
      expect(await resolveDest(loaded.doc, 'no-existe')).toBeNull();
      expect(await resolveDest(loaded.doc, [{ num: 999999, gen: 0 }, { name: 'Fit' }])).toBeNull();
    } finally {
      await loaded.destroy();
    }
  }, OPEN_TIMEOUT);
});

describe('getPageLinks con anotaciones no válidas', () => {
  it('descarta lo que no es un enlace con rectángulo válido y conserva el resto', async () => {
    const annotations: unknown[] = [
      null,
      { subtype: 'Text', rect: [0, 0, 1, 1] },
      { subtype: 'Link', rect: [1, 2, 3] },
      { subtype: 'Link', rect: [1, 2, 'x', 4] },
      { subtype: 'Link', rect: [1, 2, 3, 4], dest: 'destino-final' },
    ];
    const page = { getAnnotations: async () => annotations };
    const links = await getPageLinks(page as unknown as PDFPageProxy);
    expect(links).toEqual([{ rect: [1, 2, 3, 4], target: { kind: 'internal', dest: 'destino-final' } }]);
  });
});
