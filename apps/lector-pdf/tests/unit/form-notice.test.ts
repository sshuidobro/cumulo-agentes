import { createStorageStore, type Platform } from '@suite/platform';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { loadPdf, type LoadedPdf } from '../../src/engine';
import { endAnnotationSession, startAnnotationSession } from '../../src/state/annotation-actions';
import { useAnnotations } from '../../src/state/annotation-store';
import { endFormSession, startFormSession } from '../../src/state/form-actions';
import { initServices } from '../../src/state/services';
import { initialViewerState, useViewer } from '../../src/state/viewer-store';
import { formMsg } from '../../src/ui/messages-forms';
import { createFakePlatform } from '../helpers/fake-platform';
import { fixtureSource, nodeAssetBase } from '../helpers/pdfjs-node';

const OPEN_TIMEOUT = 30_000;

const opened: LoadedPdf[] = [];

/** Abre un fixture como la app: anotaciones y después formularios, y espera al escaneo de anotaciones. */
async function openDocument(name: string): Promise<void> {
  const result = await loadPdf(fixtureSource(name), { assetBaseUrl: nodeAssetBase() });
  if (!result.ok) throw new Error(`No se pudo abrir ${name}: ${result.error.code}`);
  opened.push(result.value);
  startAnnotationSession(result.value, new AbortController().signal);
  startFormSession(result.value);
  await vi.waitFor(
    () => {
      expect(useAnnotations.getState().scan).toBe('done');
    },
    { timeout: OPEN_TIMEOUT },
  );
}

beforeEach(() => {
  const platform: Platform = createFakePlatform({ prefs: createStorageStore(null, 'test.') });
  initServices({ platform, assetBaseUrl: '' });
  endFormSession();
  endAnnotationSession();
  useViewer.setState({ ...initialViewerState, status: 'ready' });
});

afterEach(async () => {
  endFormSession();
  endAnnotationSession();
  useViewer.setState(initialViewerState);
  for (const pdf of opened.splice(0)) await pdf.destroy();
});

describe('aviso de campos rellenables (PDF-041)', () => {
  it('al abrir un documento con campos rellenables avisa una vez', async () => {
    const notices: string[] = [];
    const unsubscribe = useViewer.subscribe((state, prev) => {
      if (state.notice !== null && state.notice !== prev.notice) notices.push(state.notice.text);
    });
    try {
      await openDocument('form-full.pdf');
      expect(notices).toEqual([formMsg.hasFields]);
    } finally {
      unsubscribe();
    }
  });

  it('un documento sin campos no muestra el aviso', async () => {
    await openDocument('basic-5.pdf');
    expect(useViewer.getState().notice).toBeNull();
  });
});
