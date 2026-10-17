import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { ByteSource } from '@suite/platform';
import type * as PdfjsModule from '../../src/engine/pdfjs';
import { loadPdf, type LoadedPdf } from '../../src/engine/load';
import { getDocument } from '../../src/engine/pdfjs';
import { countingSource, fixtureSource, nodeAssetBase } from '../helpers/pdfjs-node';

// Espía sobre getDocument: pasa la llamada al original, pero permite comprobar si pdf.js se invocó.
vi.mock('../../src/engine/pdfjs', async (importOriginal) => {
  const actual = await importOriginal<typeof PdfjsModule>();
  return { ...actual, getDocument: vi.fn(actual.getDocument) };
});

const assetBaseUrl = nodeAssetBase();
const OPEN_TIMEOUT = 30_000;

/** Fuente que falla (rechaza) a partir de la `failFrom`-ésima lectura. */
function failingFrom(inner: ByteSource, failFrom: number): ByteSource {
  let reads = 0;
  return {
    size: inner.size,
    read(begin, end) {
      reads += 1;
      if (reads >= failFrom) return Promise.reject(new Error('disco no disponible'));
      return inner.read(begin, end);
    },
  };
}

async function pageText(loaded: LoadedPdf, pageNumber: number): Promise<string> {
  const page = await loaded.doc.getPage(pageNumber);
  const content = await page.getTextContent();
  return content.items.map((item) => ('str' in item ? item.str : '')).join(' ');
}

beforeEach(() => {
  vi.mocked(getDocument).mockClear();
});

describe('loadPdf · casos correctos', () => {
  it('abre basic-5.pdf con 5 páginas y una huella no vacía, estable entre dos cargas', async () => {
    const first = await loadPdf(fixtureSource('basic-5.pdf'), { assetBaseUrl });
    const second = await loadPdf(fixtureSource('basic-5.pdf'), { assetBaseUrl });
    expect(first.ok && second.ok).toBe(true);
    if (!first.ok || !second.ok) return;
    try {
      expect(first.value.numPages).toBe(5);
      expect(first.value.fingerprint).not.toBe('');
      expect(second.value.fingerprint).toBe(first.value.fingerprint);
    } finally {
      await first.value.destroy();
      await second.value.destroy();
    }
  }, OPEN_TIMEOUT);

  it('abre pages-5000.pdf y la página 5000 contiene su numeración', async () => {
    const result = await loadPdf(fixtureSource('pages-5000.pdf'), { assetBaseUrl });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    try {
      expect(result.value.numPages).toBe(5000);
      expect(await pageText(result.value, 5000)).toContain('Página 5000 de 5000');
    } finally {
      await result.value.destroy();
    }
  }, OPEN_TIMEOUT);

  it('abre pages-100000.pdf leyendo solo una parte del fichero', async () => {
    const source = countingSource(fixtureSource('pages-100000.pdf'));
    const result = await loadPdf(source, { assetBaseUrl });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    try {
      expect(result.value.numPages).toBe(100000);
      await pageText(result.value, 1);
      // El presupuesto es < 30 % (el líder midió ~15 %): comprueba que no se lee el fichero entero.
      expect(source.bytesRead).toBeLessThan(source.size * 0.3);
    } finally {
      await result.value.destroy();
    }
  }, OPEN_TIMEOUT);

  it('abre pages-20000-flat.pdf (árbol plano) con 20 000 páginas', async () => {
    const result = await loadPdf(fixtureSource('pages-20000-flat.pdf'), { assetBaseUrl });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    try {
      expect(result.value.numPages).toBe(20000);
    } finally {
      await result.value.destroy();
    }
  }, OPEN_TIMEOUT);
});

describe('loadPdf · errores tipados', () => {
  it('devuelve empty para un fichero de 0 bytes', async () => {
    const result = await loadPdf(fixtureSource('corrupt-empty.pdf'), { assetBaseUrl });
    expect(result).toEqual({ ok: false, error: expect.objectContaining({ code: 'empty', message: 'El fichero está vacío (0 bytes).' }) });
  });

  it('devuelve not-pdf sin invocar a pdf.js y leyendo solo la cabecera', async () => {
    const source = countingSource(fixtureSource('corrupt-not-pdf.pdf'));
    const result = await loadPdf(source, { assetBaseUrl });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('not-pdf');
    expect(getDocument).not.toHaveBeenCalled();
    expect(source.reads).toBe(1);
  });

  it('nunca lanza con ficheros truncados o con startxref roto: ok con páginas o corrupt', async () => {
    const names = ['corrupt-truncated.pdf', 'corrupt-bad-startxref.pdf'];
    for (const name of names) {
      const result = await loadPdf(fixtureSource(name), { assetBaseUrl });
      if (result.ok) {
        try {
          expect(result.value.numPages).toBeGreaterThanOrEqual(1);
        } finally {
          await result.value.destroy();
        }
      } else {
        expect(result.error.code).toBe('corrupt');
      }
    }
  }, 10_000);

  it('devuelve io si la fuente falla a partir de la 2.ª lectura', async () => {
    const result = await loadPdf(failingFrom(fixtureSource('basic-5.pdf'), 2), { assetBaseUrl });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('io');
    expect(result.error.message).toBe('No se ha podido leer el fichero. Comprueba que sigue en su sitio.');
  }, 5_000);

  it('devuelve cancelled si se aborta justo después de llamar', async () => {
    const controller = new AbortController();
    const pending = loadPdf(fixtureSource('basic-5.pdf'), { assetBaseUrl, signal: controller.signal });
    controller.abort();
    const result = await pending;
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('cancelled');
  }, OPEN_TIMEOUT);

  it('destroy() es idempotente: llamarlo dos veces no lanza', async () => {
    const result = await loadPdf(fixtureSource('basic-5.pdf'), { assetBaseUrl });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    await result.value.destroy();
    await expect(result.value.destroy()).resolves.toBeUndefined();
  }, OPEN_TIMEOUT);
});
