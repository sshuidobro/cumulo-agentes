// @vitest-environment jsdom
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createIdbDraftStore, memorySource, type DraftStore } from '@suite/platform';
import { configureLogging, type LogSink } from '@suite/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EMPTY_EDITS } from '../../src/core/annotations/model';
import { draftSavedAt, toDraft } from '../../src/core/annotations/draft';
import type { LoadedPdf } from '../../src/engine';
import { addAnnotation, endAnnotationSession, markAnnotationsSaved, undo } from '../../src/state/annotation-actions';
import { useAnnotations } from '../../src/state/annotation-store';
import { DRAFT_DELAY_MS, discardCurrentDraft, draftKey, startDraftSync } from '../../src/state/draft-sync';
import { initServices } from '../../src/state/services';
import { useChoice } from '../../src/state/choice';
import { initialViewerState, useViewer } from '../../src/state/viewer-store';
import { ChoiceDialog } from '../../src/ui/kit/ChoiceDialog';
import { createFakePlatform, openedFile } from '../helpers/fake-platform';
import { newAnnotation } from '../unit/annotations/factories';

/** Documento de prueba: 1 234 bytes y una huella fija, así la clave es conocida. */
const BYTES = new Uint8Array(1234);
const KEY = draftKey('fp-1', BYTES.length);
const FILE_NAME = 'a.pdf';
const DIALOG_NAME = /Hay cambios sin guardar de la última vez en «a\.pdf»/;
const DAY_MS = 24 * 60 * 60 * 1000;

let store: DraftStore;
let stopSync: (() => void) | null = null;
const logged: { readonly level: string; readonly message: string }[] = [];
const sink: LogSink = (level, _scope, message) => {
  logged.push({ level, message });
};

function start(): void {
  stopSync = startDraftSync(store);
}

function stop(): void {
  stopSync?.();
  stopSync = null;
}

/** Abre el documento como la app: primero el visor y después el store de anotaciones ya importadas. */
function openDoc(): void {
  const file = openedFile(FILE_NAME, memorySource(BYTES));
  const pdf = { fingerprint: 'fp-1', numPages: 1 } as unknown as LoadedPdf;
  useViewer.setState({ ...initialViewerState, status: 'ready', file, pdf });
  useAnnotations.setState({ scan: 'done' });
}

/** Cierra el documento como la app: primero el store de anotaciones, después el visor. */
function closeDoc(): void {
  endAnnotationSession();
  useViewer.setState(initialViewerState);
}

/** Recarga la página: el navegador avisa con pagehide, se pierde el estado en memoria y el almacén se conserva. */
function reload(): void {
  window.dispatchEvent(new Event('pagehide'));
  stop();
  closeDoc();
  start();
}

async function flushMicrotasks(): Promise<void> {
  for (let i = 0; i < 5; i += 1) await Promise.resolve();
}

beforeEach(() => {
  initServices({ platform: createFakePlatform(), assetBaseUrl: '' });
  store = createIdbDraftStore('test-drafts', null);
  logged.length = 0;
  configureLogging({ sink, minLevel: 'warn' });
  closeDoc();
});

afterEach(() => {
  stop();
  closeDoc();
  vi.useRealTimers();
  useChoice.setState({ active: null });
  configureLogging({ sink: null });
});

describe('guardado del borrador', () => {
  it('guarda 2 s después del último cambio y lo borra al quedar guardado', async () => {
    vi.useFakeTimers();
    start();
    openDoc();

    addAnnotation(newAnnotation('suite-n1', 'note'));
    await vi.advanceTimersByTimeAsync(DRAFT_DELAY_MS - 1);
    expect(await store.keys()).toEqual([]);

    await vi.advanceTimersByTimeAsync(1);
    expect(await store.keys()).toEqual([KEY]);
    const saved = await store.get(KEY);
    expect(saved).toMatchObject({ version: 2, fileName: FILE_NAME, removed: [] });
    expect(draftSavedAt(saved)).not.toBeNull();

    markAnnotationsSaved();
    expect(await store.keys()).toEqual([]);
  });

  it('al ocultarse la página escribe el borrador sin esperar al retraso', async () => {
    vi.useFakeTimers();
    start();
    openDoc();
    addAnnotation(newAnnotation('suite-n1', 'note'));

    window.dispatchEvent(new Event('pagehide'));
    await flushMicrotasks();

    expect(await store.keys()).toEqual([KEY]);
  });

  it('deshacer hasta quedar limpio borra el borrador', async () => {
    vi.useFakeTimers();
    start();
    openDoc();
    addAnnotation(newAnnotation('suite-n1', 'note'));
    await vi.advanceTimersByTimeAsync(DRAFT_DELAY_MS);
    expect(await store.keys()).toEqual([KEY]);

    undo();

    expect(await store.keys()).toEqual([]);
  });

  it('«No guardar» borra el borrador y, al cerrar, no vuelve a escribirlo', async () => {
    vi.useFakeTimers();
    start();
    openDoc();
    addAnnotation(newAnnotation('suite-n1', 'note'));
    await vi.advanceTimersByTimeAsync(DRAFT_DELAY_MS);
    expect(await store.keys()).toEqual([KEY]);

    await discardCurrentDraft();
    closeDoc();
    window.dispatchEvent(new Event('pagehide'));
    await vi.advanceTimersByTimeAsync(DRAFT_DELAY_MS);

    expect(await store.keys()).toEqual([]);
  });

  it('si el almacén rechaza la escritura, la app sigue sin errores visibles y registra un aviso', async () => {
    vi.useFakeTimers();
    store = { ...createIdbDraftStore('test-drafts', null), put: () => Promise.reject(new Error('cuota llena')) };
    start();
    openDoc();

    addAnnotation(newAnnotation('suite-n1', 'note'));
    await vi.advanceTimersByTimeAsync(DRAFT_DELAY_MS);
    await flushMicrotasks();

    expect(logged).toContainEqual({ level: 'warn', message: 'put' });
    expect(useAnnotations.getState().edits.upserts.size).toBe(1);
    expect(useChoice.getState().active).toBeNull();
  });
});

describe('recuperación al abrir', () => {
  it('«Recuperar» aplica los cambios como una sola entrada que deshacer quita entera', async () => {
    const user = userEvent.setup();
    start();
    openDoc();
    addAnnotation(newAnnotation('suite-n1', 'note'));
    addAnnotation(newAnnotation('suite-n2', 'freetext'));
    reload();

    openDoc();
    render(<ChoiceDialog />);
    const dialog = await screen.findByRole('dialog', { name: DIALOG_NAME });
    await user.click(within(dialog).getByRole('button', { name: 'Recuperar' }));

    await waitFor(() => {
      expect(useAnnotations.getState().edits.upserts.size).toBe(2);
    });
    expect(useAnnotations.getState().undo.isDirty).toBe(true);
    undo();
    expect(useAnnotations.getState().edits.upserts.size).toBe(0);
    expect(useAnnotations.getState().undo.canUndo).toBe(false);
  });

  it('«Descartar» borra el borrador y no aplica nada', async () => {
    const user = userEvent.setup();
    start();
    openDoc();
    addAnnotation(newAnnotation('suite-n1', 'note'));
    reload();

    openDoc();
    render(<ChoiceDialog />);
    const dialog = await screen.findByRole('dialog', { name: DIALOG_NAME });
    await user.click(within(dialog).getByRole('button', { name: 'Descartar' }));

    await waitFor(() => {
      expect(useChoice.getState().active).toBeNull();
    });
    await waitFor(async () => {
      expect(await store.keys()).toEqual([]);
    });
    expect(useAnnotations.getState().edits.upserts.size).toBe(0);
  });

  it('Esc deja el borrador para la próxima vez', async () => {
    const user = userEvent.setup();
    start();
    openDoc();
    addAnnotation(newAnnotation('suite-n1', 'note'));
    reload();

    openDoc();
    render(<ChoiceDialog />);
    await screen.findByRole('dialog', { name: DIALOG_NAME });
    await user.keyboard('{Escape}');
    await waitFor(() => {
      expect(useChoice.getState().active).toBeNull();
    });
    closeDoc();

    expect(await store.keys()).toEqual([KEY]);
  });

  it('un borrador inválido se borra sin preguntar y deja un aviso', async () => {
    await store.put(KEY, { version: 1, fileName: FILE_NAME, savedAt: new Date().toISOString(), upserts: [{ id: 'x' }], removed: [] });
    start();
    openDoc();

    await waitFor(async () => {
      expect(await store.keys()).toEqual([]);
    });
    expect(logged).toContainEqual({ level: 'warn', message: 'borrador inválido, se borra' });
    expect(useChoice.getState().active).toBeNull();
  });

  it('un borrador sin cambios se borra sin preguntar', async () => {
    await store.put(KEY, toDraft(EMPTY_EDITS, FILE_NAME, new Date().toISOString()));
    start();
    openDoc();

    await waitFor(async () => {
      expect(await store.keys()).toEqual([]);
    });
    expect(useChoice.getState().active).toBeNull();
  });
});

describe('limpieza al arrancar', () => {
  it('borra los borradores de más de 30 días y conserva los recientes', async () => {
    const old = new Date(Date.now() - 31 * DAY_MS).toISOString();
    const recent = new Date(Date.now() - DAY_MS).toISOString();
    await store.put('pdf:viejo:1', toDraft(EMPTY_EDITS, 'viejo.pdf', old));
    await store.put('pdf:reciente:1', toDraft(EMPTY_EDITS, 'reciente.pdf', recent));

    start();

    await waitFor(async () => {
      expect(await store.keys()).toEqual(['pdf:reciente:1']);
    });
  });
});
