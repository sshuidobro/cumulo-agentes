import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createStorageStore, memorySource, type Platform } from '@suite/platform';
import { createFakePlatform, openedFile } from '../../helpers/fake-platform';
import { fixtureSource, nodeAssetBase } from '../../helpers/pdfjs-node';
import { loadPdf, type LoadedPdf } from '../../../src/engine';
import { additionsDiff, saveAnnotations } from '../../support/save-annotations';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { FIXTURES_DIR } from '../../fixtures/paths';
import type { RawAnnotation } from '../../../src/core/annotations/import';
import { PALETTE } from '../../../src/core/annotations/palette';
import { PageDimsTable } from '../../../src/core/page-dims';
import {
  addAnnotation,
  addAnnotations,
  addNoteFromKeyboard,
  deleteAnnotation,
  endAnnotationSession,
  ensurePageAnnotations,
  getEffective,
  markAnnotationsSaved,
  redo,
  setAuthor,
  setInkWidth,
  setTool,
  setToolColor,
  startAnnotationSession,
  undo,
} from '../../../src/state/annotation-actions';
import { initialAnnotationState, useAnnotations } from '../../../src/state/annotation-store';
import { initServices } from '../../../src/state/services';
import { initialViewerState, useViewer } from '../../../src/state/viewer-store';
import { newAnnotation } from './factories';

const OPEN_TIMEOUT = 30_000;
const TITLE = 'annotated.pdf — Lector PDF';
const DIRTY_TITLE = `• ${TITLE}`;

const setTitle = vi.fn();
const opened: LoadedPdf[] = [];

/** Documento simulado de `numPages` páginas sin anotaciones; cuenta las llamadas a `getPage` y `getAnnotations`. */
function fakeLoaded(numPages: number) {
  const getAnnotations = vi.fn(async (): Promise<RawAnnotation[]> => []);
  const getPage = vi.fn(async (n: number) => ({ pageNumber: n, getAnnotations }));
  const pdf = { numPages, doc: { numPages, getPage } } as unknown as LoadedPdf;
  return { pdf, getPage, getAnnotations };
}

async function openAnnotated(): Promise<LoadedPdf> {
  const result = await loadPdf(fixtureSource('annotated.pdf'), { assetBaseUrl: nodeAssetBase() });
  if (!result.ok) throw new Error(`No se pudo abrir annotated.pdf: ${result.error.code}`);
  opened.push(result.value);
  return result.value;
}

async function waitForScan(): Promise<void> {
  await vi.waitFor(
    () => {
      expect(useAnnotations.getState().scan).toBe('done');
    },
    { timeout: OPEN_TIMEOUT },
  );
}

beforeEach(() => {
  const platform: Platform = createFakePlatform({
    setTitle,
    prefs: createStorageStore(null, 'test.'),
  });
  initServices({ platform, assetBaseUrl: '' });
  useViewer.setState({
    ...initialViewerState,
    status: 'ready',
    file: openedFile('annotated.pdf', memorySource(new Uint8Array([0x25]))),
  });
  endAnnotationSession();
  setTitle.mockClear();
});

afterEach(async () => {
  endAnnotationSession();
  useViewer.setState(initialViewerState);
  for (const pdf of opened.splice(0)) await pdf.destroy();
});

describe('importación al abrir', () => {
  it('annotated.pdf: 5 anotaciones soportadas, 1 ajena (Square) y escaneo terminado', async () => {
    const pdf = await openAnnotated();
    startAnnotationSession(pdf, new AbortController().signal);
    await waitForScan();

    const state = useAnnotations.getState();
    expect(state.baseline.size).toBe(5);
    expect([...state.baseline.values()].map((a) => a.type).sort()).toEqual(
      ['freetext', 'highlight', 'ink', 'note', 'underline'],
    );
    expect(state.foreign.size).toBe(1);
    expect([...state.foreign.values()][0]?.subtype).toBe('Square');
    expect(state.scanProgress).toBe(pdf.numPages);
  }, OPEN_TIMEOUT);

  it('documento de 25 000 páginas: modo lazy, sin escanear y sin llamadas a getPage', () => {
    const { pdf, getPage } = fakeLoaded(25_000);
    startAnnotationSession(pdf, new AbortController().signal);

    expect(useAnnotations.getState().scan).toBe('lazy');
    expect(getPage).not.toHaveBeenCalled();
  });

  it('ensurePageAnnotations importa solo la página pedida y no la vuelve a importar', async () => {
    const { pdf, getPage, getAnnotations } = fakeLoaded(25_000);
    startAnnotationSession(pdf, new AbortController().signal);

    await ensurePageAnnotations(7);
    expect(getPage).toHaveBeenCalledTimes(1);
    expect(getPage).toHaveBeenCalledWith(8);
    expect(getAnnotations).toHaveBeenCalledTimes(1);
    expect(useAnnotations.getState().importedPages.has(7)).toBe(true);
    expect(useAnnotations.getState().scanProgress).toBe(1);

    await ensurePageAnnotations(7);
    expect(getPage).toHaveBeenCalledTimes(1);
    expect(getAnnotations).toHaveBeenCalledTimes(1);
  });

  it('llamadas concurrentes a la misma página importan una sola vez', async () => {
    const { pdf, getPage } = fakeLoaded(25_000);
    startAnnotationSession(pdf, new AbortController().signal);

    await Promise.all([ensurePageAnnotations(3), ensurePageAnnotations(3), ensurePageAnnotations(3)]);
    expect(getPage).toHaveBeenCalledTimes(1);
  });

  it('cerrar durante el escaneo lo aborta: ningún set del store después del cierre', async () => {
    const gates: (() => void)[] = [];
    const getAnnotations = vi.fn(
      () =>
        new Promise<RawAnnotation[]>((resolve) => {
          gates.push(() => {
            resolve([]);
          });
        }),
    );
    const getPage = vi.fn(async (n: number) => ({ pageNumber: n, getAnnotations }));
    const pdf = { numPages: 300, doc: { numPages: 300, getPage } } as unknown as LoadedPdf;
    startAnnotationSession(pdf, new AbortController().signal);
    await vi.waitFor(() => {
      expect(gates.length).toBe(1);
    });

    const setSpy = vi.spyOn(useAnnotations, 'setState');
    endAnnotationSession();
    const callsAtClose = setSpy.mock.calls.length;
    for (const release of gates.splice(0)) release();
    await new Promise<void>((resolve) => {
      setTimeout(resolve, 20);
    });

    expect(setSpy.mock.calls.length).toBe(callsAtClose);
    expect(useAnnotations.getState().scan).toBe('idle');
    expect(getPage.mock.calls.length).toBeLessThan(300);
    setSpy.mockRestore();
  });
});

describe('historial de cambios', () => {
  it('añadir dos, borrar una del fichero: undo la devuelve, redo la borra, y el título marca los cambios', async () => {
    const pdf = await openAnnotated();
    startAnnotationSession(pdf, new AbortController().signal);
    await waitForScan();
    const target = [...useAnnotations.getState().baseline.values()][0];
    if (target === undefined) throw new Error('annotated.pdf sin anotaciones soportadas');

    addAnnotation(newAnnotation('suite-a', 'note', 0));
    addAnnotation(newAnnotation('suite-b', 'highlight', 1));
    deleteAnnotation(target.id);
    expect(getEffective().has(target.id)).toBe(false);
    expect(useAnnotations.getState().undo.undoDepth).toBe(3);
    expect(useAnnotations.getState().undo.isDirty).toBe(true);
    expect(setTitle).toHaveBeenLastCalledWith(DIRTY_TITLE);

    undo();
    expect(getEffective().get(target.id)).toEqual(target);
    expect(getEffective().has('suite-a')).toBe(true);

    redo();
    expect(getEffective().has(target.id)).toBe(false);

    markAnnotationsSaved();
    expect(useAnnotations.getState().undo.isDirty).toBe(false);
    expect(setTitle).toHaveBeenLastCalledWith(TITLE);
  }, OPEN_TIMEOUT);

  it('addAnnotations crea una sola entrada de deshacer', async () => {
    const pdf = await openAnnotated();
    startAnnotationSession(pdf, new AbortController().signal);
    await waitForScan();

    addAnnotations('resaltar', [newAnnotation('suite-1', 'highlight', 0), newAnnotation('suite-2', 'highlight', 0)]);
    expect(useAnnotations.getState().undo.undoDepth).toBe(1);
    expect(useAnnotations.getState().undo.undoLabel).toBe('resaltar');
    expect(getEffective().has('suite-1')).toBe(true);
    expect(getEffective().has('suite-2')).toBe(true);

    undo();
    expect(getEffective().has('suite-1')).toBe(false);
    expect(getEffective().has('suite-2')).toBe(false);
    expect(useAnnotations.getState().undo.canUndo).toBe(false);
  }, OPEN_TIMEOUT);

  it('sube la versión de la página afectada al cambiar sus anotaciones', () => {
    const { pdf } = fakeLoaded(25_000);
    startAnnotationSession(pdf, new AbortController().signal);

    addAnnotation(newAnnotation('suite-p4', 'note', 4));
    expect(useAnnotations.getState().pageVersion.get(4)).toBe(1);
    expect(useAnnotations.getState().pageVersion.has(5)).toBe(false);
  });
});

describe('preferencias', () => {
  it('el color elegido se guarda en prefs y sobrevive a recrear el store', () => {
    const { pdf } = fakeLoaded(25_000);
    startAnnotationSession(pdf, new AbortController().signal);
    const blue = PALETTE.find((c) => c.id === 'blue');
    if (blue === undefined) throw new Error('falta el azul en la paleta');

    setToolColor('highlight', blue.rgb);
    setInkWidth(4);
    expect(useAnnotations.getState().colors.highlight).toEqual(blue.rgb);

    // «Recrear el store»: estado inicial y nueva sesión; las preferencias deben volver.
    useAnnotations.setState(initialAnnotationState());
    expect(useAnnotations.getState().colors.highlight).not.toEqual(blue.rgb);
    startAnnotationSession(pdf, new AbortController().signal);
    expect(useAnnotations.getState().colors.highlight).toEqual(blue.rgb);
    expect(useAnnotations.getState().inkWidth).toBe(4);
  });

  it('autor vacío o solo espacios → «Usuario»; el nombre se recorta', () => {
    setAuthor('   ');
    expect(useAnnotations.getState().author).toBe('Usuario');
    setAuthor('  Ana  ');
    expect(useAnnotations.getState().author).toBe('Ana');
  });
});

describe('nota con teclado (PDF-072)', () => {
  it('crea la nota en la página actual, arriba a la izquierda de lo visible, y la deja seleccionada con su ventana abierta', () => {
    useViewer.setState({ dims: PageDimsTable.uniform(3, 612, 792, 0), currentPage: 1, currentYFraction: 0, rotation: 0 });
    setTool('note');

    const id = addNoteFromKeyboard();

    expect(id).not.toBeNull();
    const note = id === null ? undefined : getEffective().get(id);
    expect(note?.type).toBe('note');
    expect(note?.pageIndex).toBe(1);
    expect(note?.rect).toEqual([24, 748, 44, 768]);
    expect(useAnnotations.getState().tool).toBe('none');
    expect(useAnnotations.getState().selectedId).toBe(id);
    expect(useAnnotations.getState().openPopupId).toBe(id);
  });

  it('usa la fracción vertical visible y la rotación total de la vista', () => {
    useViewer.setState({ dims: PageDimsTable.uniform(2, 612, 792, 0), currentPage: 0, currentYFraction: 0.5, rotation: 90 });

    const id = addNoteFromKeyboard();

    const note = id === null ? undefined : getEffective().get(id);
    expect(note?.rect).toEqual([330, 24, 350, 44]);
  });

  it('una sola entrada de deshacer: Ctrl+Z la quita y Ctrl+Y la repone', () => {
    useViewer.setState({ dims: PageDimsTable.uniform(3, 612, 792, 0), currentPage: 1, currentYFraction: 0, rotation: 0 });
    const id = addNoteFromKeyboard();
    expect(id).not.toBeNull();

    undo();
    expect(id === null ? true : getEffective().has(id)).toBe(false);

    redo();
    expect(id === null ? false : getEffective().has(id)).toBe(true);
  });

  it('sin documento (dims null) o con página actual fuera de rango devuelve null y no añade nada', () => {
    useViewer.setState({ dims: null, currentPage: 0 });
    expect(addNoteFromKeyboard()).toBeNull();

    useViewer.setState({ dims: PageDimsTable.uniform(2, 612, 792, 0), currentPage: 2 });
    expect(addNoteFromKeyboard()).toBeNull();

    expect(getEffective().size).toBe(0);
    expect(useAnnotations.getState().tool).toBe('none');
  });
});

describe('firmas guardadas al reabrir (PDF-104)', () => {
  const SIGNATURE = {
    id: 'firma-1',
    type: 'signature' as const,
    pageIndex: 0,
    rect: [100, 100, 300, 200] as [number, number, number, number],
    color: [0, 0, 0.6] as [number, number, number],
    opacity: 1,
    contents: '',
    author: 'Ana',
    modified: '2026-10-18T10:00:00.000Z',
    created: '2026-10-18T10:00:00.000Z',
    origin: { kind: 'new' as const },
    art: { kind: 'ink' as const, paths: [[0, 0, 25, 40, 50, 0]], width: 2, box: [100, 50] as [number, number] },
  };

  it('una firma escrita por la suite se lista como «SuiteFirma» al abrir la sesión', async () => {
    const original = new Uint8Array(readFileSync(join(FIXTURES_DIR, 'basic-5.pdf')));
    const { data } = await saveAnnotations(original, additionsDiff([SIGNATURE]));
    const result = await loadPdf(memorySource(data), { assetBaseUrl: nodeAssetBase() });
    if (!result.ok) throw new Error(result.error.code);
    opened.push(result.value);

    startAnnotationSession(result.value, new AbortController().signal, memorySource(data));
    await waitForScan();

    expect([...useAnnotations.getState().foreign.values()].map((a) => a.stampName)).toEqual(['SuiteFirma']);
  }, OPEN_TIMEOUT);

  it('si el fichero no se puede leer para guardar, el escaneo termina y el sello sale sin nombre', async () => {
    const pdf = await openAnnotated();
    startAnnotationSession(pdf, new AbortController().signal, memorySource(new Uint8Array([1, 2, 3])));
    await waitForScan();

    const foreign = [...useAnnotations.getState().foreign.values()];
    expect(foreign).toHaveLength(1);
    expect(foreign[0]?.stampName).toBeUndefined();
  }, OPEN_TIMEOUT);
});
