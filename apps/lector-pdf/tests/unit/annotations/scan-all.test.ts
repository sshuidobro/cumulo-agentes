import { afterEach, describe, expect, it, vi } from 'vitest';
import { createStorageStore, type Platform } from '@suite/platform';
import type { LoadedPdf } from '../../../src/engine';
import type { RawAnnotation } from '../../../src/core/annotations/import';
import {
  cancelScanAll,
  endAnnotationSession,
  scanAllAnnotations,
  startAnnotationSession,
} from '../../../src/state/annotation-actions';
import { initialAnnotationState, useAnnotations } from '../../../src/state/annotation-store';
import { initServices } from '../../../src/state/services';
import { createFakePlatform } from '../../helpers/fake-platform';

const LAZY_PAGES = 20_001;
const WAIT = 10_000;

/** Documento 'lazy' simulado: cada página no tiene anotaciones. */
function lazyDoc(): LoadedPdf {
  const getAnnotations = vi.fn(async (): Promise<RawAnnotation[]> => []);
  const getPage = vi.fn(async (n: number) => ({ pageNumber: n, getAnnotations }));
  return { numPages: LAZY_PAGES, doc: { numPages: LAZY_PAGES, getPage } } as unknown as LoadedPdf;
}

async function until(check: () => boolean): Promise<void> {
  const started = Date.now();
  while (!check()) {
    if (Date.now() - started > WAIT) throw new Error('tiempo agotado esperando al escaneo');
    await new Promise((resolve) => {
      setTimeout(resolve, 5);
    });
  }
}

initServices({
  platform: createFakePlatform({ prefs: createStorageStore(null, 'test.') }) as Platform,
  assetBaseUrl: '',
});

afterEach(() => {
  endAnnotationSession();
  useAnnotations.setState(initialAnnotationState());
});

describe('escaneo completo de un documento grande (PDF-036)', () => {
  it('lanzarlo pasa a «escaneando» y cancelarlo vuelve a «lazy» sin terminar', async () => {
    startAnnotationSession(lazyDoc(), new AbortController().signal);
    expect(useAnnotations.getState().scan).toBe('lazy');

    scanAllAnnotations();
    expect(useAnnotations.getState()).toMatchObject({ scan: 'scanning', scanCancelable: true });

    cancelScanAll();
    await until(() => useAnnotations.getState().scan === 'lazy');
    expect(useAnnotations.getState().scanCancelable).toBe(false);
    expect(useAnnotations.getState().importedPages.size).toBeLessThan(LAZY_PAGES);
  });

  it('sin cancelar, importa todas las páginas y termina en «done»', async () => {
    startAnnotationSession(lazyDoc(), new AbortController().signal);
    scanAllAnnotations();

    await until(() => useAnnotations.getState().scan === 'done');
    expect(useAnnotations.getState().importedPages.size).toBe(LAZY_PAGES);
    expect(useAnnotations.getState().scanProgress).toBe(LAZY_PAGES);
    expect(useAnnotations.getState().scanCancelable).toBe(false);
  }, WAIT + 5_000);

  it('no hace nada si el documento no es lazy o no hay documento', () => {
    scanAllAnnotations();
    expect(useAnnotations.getState().scan).toBe('idle');
  });
});
