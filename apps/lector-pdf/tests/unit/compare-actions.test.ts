import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { memorySource, platformError, type ByteSource, type Platform } from '@suite/platform';
import { err, ok } from '@suite/shared';
import { describeChange } from '../../src/core/compare/compare';
import {
  cancelCompare,
  closeCompare,
  comparedDocument,
  selectChange,
  startCompare,
  useCompare,
} from '../../src/state/compare-actions';
import { closeDocument, openDocument } from '../../src/state/document-actions';
import { cancelPassword, submitPassword, usePasswordPrompt } from '../../src/state/password-prompt';
import { initServices } from '../../src/state/services';
import { initialViewerState, useViewer } from '../../src/state/viewer-store';
import { createFakePlatform, openedFile } from '../helpers/fake-platform';
import { fixtureSource, nodeAssetBase } from '../helpers/pdfjs-node';

const assetBaseUrl = nodeAssetBase();
const USER = 'usuario';
const AES128 = 'encrypted-aes-128.pdf';
const BASIC = 'basic-5.pdf';
const CHANGED = 'basic-5-changed.pdf';
const BIG = 'pages-5000.pdf';

let platform: Platform;

/** Hace que el selector de la plataforma devuelva `source` con el nombre `name` (o `null` si se cancela). */
function nextPick(name: string | null, source: ByteSource = fixtureSource(name ?? BASIC)): void {
  platform = createFakePlatform({
    openFile: vi.fn(async () => ok(name === null ? null : openedFile(name, source))),
  });
  initServices({ platform, assetBaseUrl });
}

/** Abre el documento de la izquierda (el que está en el visor). */
async function openLeft(name: string): Promise<void> {
  await openDocument(openedFile(name, fixtureSource(name)));
  expect(useViewer.getState().status).toBe('ready');
}

/** Espera a que `condition` sea cierta (sondeo breve, sin depender de la hora). */
async function waitUntil(condition: () => boolean): Promise<void> {
  for (let i = 0; i < 3000; i += 1) {
    if (condition()) return;
    await new Promise((resolve) => { setTimeout(resolve, 5); });
  }
  throw new Error('La condición no se cumplió a tiempo');
}

beforeEach(() => {
  nextPick(null);
  useViewer.setState(initialViewerState);
  useCompare.setState({ status: 'idle', otherName: null, results: [], progress: null, selected: null, cancelled: false });
  usePasswordPrompt.setState({ request: null });
});

afterEach(async () => {
  cancelPassword();
  await closeCompare();
  await closeDocument();
  usePasswordPrompt.setState({ request: null });
});

describe('startCompare (PDF-112)', () => {
  it('compara con el documento abierto y deja un único cambio de «página» por «hoja» en la página 2', async () => {
    await openLeft(BASIC);
    nextPick(CHANGED);

    await expect(startCompare()).resolves.toBe('started');
    await waitUntil(() => useCompare.getState().status === 'done');

    const state = useCompare.getState();
    expect(state.cancelled).toBe(false);
    expect(state.otherName).toBe(CHANGED);
    expect(state.results).toHaveLength(1);
    const [only] = state.results;
    expect(only).toMatchObject({ kind: 'changed', page: 1, changes: [expect.objectContaining({ kind: 'replace' })] });
    if (only?.kind !== 'changed') throw new Error('se esperaba una página cambiada');
    expect(only.changes.map(describeChange)).toEqual(['Se ha cambiado “página” por “hoja”.']);
    expect(comparedDocument()?.numPages).toBe(5);
  });

  it('comparar un documento consigo mismo no deja resultados', async () => {
    await openLeft(BASIC);
    nextPick(BASIC);

    await expect(startCompare()).resolves.toBe('started');
    await waitUntil(() => useCompare.getState().status === 'done');

    expect(useCompare.getState()).toMatchObject({ results: [], cancelled: false });
  });

  it('un segundo PDF cifrado pide la contraseña y, con «usuario», compara', async () => {
    await openLeft(BASIC);
    nextPick(AES128);

    const started = startCompare();
    await waitUntil(() => usePasswordPrompt.getState().request !== null);
    expect(usePasswordPrompt.getState().request).toMatchObject({ name: AES128, incorrect: false });
    submitPassword(USER);

    await expect(started).resolves.toBe('started');
    await waitUntil(() => useCompare.getState().status === 'done');
    expect(comparedDocument()?.numPages).toBe(5);
  });

  it('cancelar la contraseña devuelve «cancelled», deja el estado en idle y cierra el segundo fichero sin aviso', async () => {
    await openLeft(BASIC);
    nextPick(AES128);

    const started = startCompare();
    await waitUntil(() => usePasswordPrompt.getState().request !== null);
    cancelPassword();

    await expect(started).resolves.toBe('cancelled');
    expect(useCompare.getState().status).toBe('idle');
    expect(comparedDocument()).toBeNull();
    expect(platform.closeFile).toHaveBeenCalledWith(expect.objectContaining({ name: AES128 }));
    expect(useViewer.getState().notice).toBeNull();
  });

  it('un fichero que no es PDF se avisa con el mensaje de error y no inicia la comparación', async () => {
    await openLeft(BASIC);
    nextPick('notas.pdf', memorySource(new TextEncoder().encode('Esto no es un PDF.')));

    await expect(startCompare()).resolves.toBe('failed');

    expect(useCompare.getState().status).toBe('idle');
    expect(useViewer.getState().notice?.text).toBe('Este fichero no es un PDF.');
  });

  it('cancelar el selector de ficheros no hace nada', async () => {
    await openLeft(BASIC);
    nextPick(null);

    await expect(startCompare()).resolves.toBe('cancelled');
    expect(useCompare.getState().status).toBe('idle');
  });

  it('sin documento abierto no compara', async () => {
    await expect(startCompare()).resolves.toBe('failed');
    expect(platform.openFile).not.toHaveBeenCalled();
  });

  it('un error del selector se avisa y no inicia la comparación', async () => {
    await openLeft(BASIC);
    platform = createFakePlatform({
      openFile: vi.fn(async () => err(platformError('io'))),
    });
    initServices({ platform, assetBaseUrl });

    await expect(startCompare()).resolves.toBe('failed');
    expect(useViewer.getState().notice?.text).toBeTruthy();
    expect(useCompare.getState().status).toBe('idle');
  });
});

describe('cancelCompare y closeCompare (PDF-112)', () => {
  it('cancelar en mitad de la comparación deja los resultados parciales con cancelled: true', async () => {
    await openLeft(BIG);
    nextPick(BIG);

    await expect(startCompare()).resolves.toBe('started');
    await waitUntil(() => useCompare.getState().status === 'running');
    cancelCompare();

    const state = useCompare.getState();
    expect(state.status).toBe('done');
    expect(state.cancelled).toBe(true);
    expect(state.progress?.pagesDone).toBeLessThan(5000);
    expect(comparedDocument()).not.toBeNull();
  });

  it('cerrar la comparación destruye el segundo documento, cierra su fichero y vuelve a idle', async () => {
    await openLeft(BASIC);
    nextPick(CHANGED);
    await startCompare();
    await waitUntil(() => useCompare.getState().status === 'done');
    const other = comparedDocument();
    if (other === null) throw new Error('falta el segundo documento');
    const destroy = vi.spyOn(other, 'destroy');

    await closeCompare();

    expect(destroy).toHaveBeenCalledTimes(1);
    expect(platform.closeFile).toHaveBeenCalledWith(expect.objectContaining({ name: CHANGED }));
    expect(useCompare.getState().status).toBe('idle');
    expect(comparedDocument()).toBeNull();
  });

  it('abrir otro documento en el visor cierra la comparación', async () => {
    await openLeft(BASIC);
    nextPick(CHANGED);
    await startCompare();
    await waitUntil(() => useCompare.getState().status === 'done');

    await openLeft(CHANGED);

    await waitUntil(() => useCompare.getState().status === 'idle');
    expect(comparedDocument()).toBeNull();
  });

  it('selectChange elige un cambio existente y descarta índices fuera de la lista', async () => {
    await openLeft(BASIC);
    nextPick(CHANGED);
    await startCompare();
    await waitUntil(() => useCompare.getState().status === 'done');

    selectChange(0);
    expect(useCompare.getState().selected).toBe(0);
    selectChange(1);
    selectChange(-1);
    selectChange(0.5);
    expect(useCompare.getState().selected).toBe(0);
  });
});
