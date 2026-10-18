import { describe, expect, it, vi } from 'vitest';
import { loadPdfjs, pdfjs, setPdfjsWorkerSrc } from '../../src/engine/pdfjs';

describe('pdfjs · carga diferida (ADR-0017)', () => {
  it('loadPdfjs() dos veces devuelve la misma promesa y el módulo tiene getDocument como función', async () => {
    const first = loadPdfjs();
    const second = loadPdfjs();
    expect(second).toBe(first);
    const mod = await first;
    expect(typeof mod.getDocument).toBe('function');
  });

  it('pdfjs() lanza antes de cargar y no lanza después, en un módulo recién importado', async () => {
    vi.resetModules();
    const fresh = await import('../../src/engine/pdfjs');
    expect(() => fresh.pdfjs()).toThrow(/no está cargado/);
    await fresh.loadPdfjs();
    expect(() => fresh.pdfjs()).not.toThrow();
  }, 30_000);

  it('setPdfjsWorkerSrc tras cargar actualiza GlobalWorkerOptions.workerSrc', async () => {
    await loadPdfjs();
    const previous = pdfjs().GlobalWorkerOptions.workerSrc;
    try {
      setPdfjsWorkerSrc('x.js');
      expect(pdfjs().GlobalWorkerOptions.workerSrc).toBe('x.js');
    } finally {
      setPdfjsWorkerSrc(previous);
    }
  });
});
