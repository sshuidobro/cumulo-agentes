import { describe, expect, it, vi } from 'vitest';
import type * as PdfjsModule from '../../src/engine/pdfjs';
import { loadPdf } from '../../src/engine/load';
import { fixtureSource, nodeAssetBase } from '../helpers/pdfjs-node';

// Si pdf.js no se puede cargar (p. ej. falla la descarga del chunk diferido), loadPdf debe devolver un error claro.
vi.mock('../../src/engine/pdfjs', async (importOriginal) => {
  const actual = await importOriginal<typeof PdfjsModule>();
  return { ...actual, loadPdfjs: () => Promise.reject(new Error('red')) };
});

describe('loadPdf · pdf.js no cargable', () => {
  it('devuelve un error de E/S (io) en vez de lanzar', async () => {
    const result = await loadPdf(fixtureSource('basic-5.pdf'), { assetBaseUrl: nodeAssetBase() });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('io');
  });
});
