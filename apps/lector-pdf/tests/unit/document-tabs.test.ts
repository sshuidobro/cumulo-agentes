import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ByteSource, OpenedFile } from '@suite/platform';
import type * as EngineModule from '../../src/engine';
import type { LoadOptions } from '../../src/engine';
import { closeDocument, openRequested, registerDocumentParticipant } from '../../src/state/document-actions';
import { goToPage } from '../../src/state/navigation';
import { POSITIONS_PREF_KEY } from '../../src/state/position-sync';
import { cancelPassword, usePasswordPrompt } from '../../src/state/password-prompt';
import { initServices } from '../../src/state/services';
import { activateTab, closeTab, resetTabsForTests, useTabs } from '../../src/state/tabs';
import { initialViewerState, useViewer } from '../../src/state/viewer-store';
import { setZoomMode } from '../../src/state/view-actions';
import { tabsMsg } from '../../src/ui/messages-tabs';
import { createFakePlatform, openedFile } from '../helpers/fake-platform';
import { fixtureSource, nodeAssetBase } from '../helpers/pdfjs-node';

// Espías del motor real: cuántas veces se carga y se destruye cada documento (índice = orden de carga) y con qué
// señal de cancelación arranca cada escaneo de dimensiones.
const spies = vi.hoisted(() => ({
  loads: 0,
  destroyed: [] as number[],
  scanSignals: [] as (AbortSignal | undefined)[],
}));

vi.mock('../../src/engine', async (importOriginal) => {
  const actual = await importOriginal<typeof EngineModule>();
  return {
    ...actual,
    loadPdf: async (source: ByteSource, opts: LoadOptions) => {
      const index = spies.loads;
      spies.loads += 1;
      const result = await actual.loadPdf(source, opts);
      if (result.ok) {
        const loaded = result.value;
        const destroy = loaded.destroy;
        (loaded as { destroy: () => Promise<void> }).destroy = () => {
          spies.destroyed.push(index);
          return destroy();
        };
      }
      return result;
    },
    scanPageDims: (...args: Parameters<typeof actual.scanPageDims>) => {
      spies.scanSignals.push(args[1].signal);
      return actual.scanPageDims(...args);
    },
  };
});

const assetBaseUrl = nodeAssetBase();

/** Fichero con ruta (como en Tauri), para que las pestañas puedan reconocerlo. */
function fileAt(name: string, path: string | null = `/docs/${name}`): OpenedFile {
  return { ...openedFile(name, fixtureSource(name)), path };
}

function activeTitle(): string | null {
  const { tabs, activeId } = useTabs.getState();
  return tabs.find((t) => t.id === activeId)?.title ?? null;
}

function tabTitles(): string[] {
  return useTabs.getState().tabs.map((t) => t.title);
}

/** Espera a que se cumpla `condition` (sondeo breve, sin depender de la hora del sistema). */
async function waitUntil(condition: () => boolean, timeoutMs = 15_000): Promise<void> {
  const start = Date.now();
  while (!condition()) {
    if (Date.now() - start > timeoutMs) throw new Error('Tiempo agotado esperando una condición');
    await new Promise((resolve) => {
      setTimeout(resolve, 5);
    });
  }
}

const prefsSet = vi.fn<(key: string, value: unknown) => void>();
let platform: ReturnType<typeof createFakePlatform>;

beforeEach(() => {
  prefsSet.mockClear();
  platform = createFakePlatform({
    prefs: { get: () => null, set: prefsSet, remove: () => undefined },
  });
  initServices({ platform, assetBaseUrl });
  resetTabsForTests();
  registerDocumentParticipant();
  useViewer.setState({ ...initialViewerState });
  spies.loads = 0;
  spies.destroyed.length = 0;
  spies.scanSignals.length = 0;
});

afterEach(async () => {
  for (const tab of [...useTabs.getState().tabs]) await closeTab(tab.id);
  await closeDocument();
  resetTabsForTests();
});

describe('pestañas de documento', () => {
  it('volver a una pestaña restaura página, posición y zoom sin recargar el documento', async () => {
    await openRequested(fileAt('basic-5.pdf'));
    goToPage(2, { yFraction: 0.5 });
    setZoomMode({ kind: 'custom', zoom: 1.5 });
    useViewer.setState({ currentPage: 2, currentYFraction: 0.5 });
    const first = useTabs.getState().activeId ?? '';

    await openRequested(fileAt('links.pdf'));
    expect(useTabs.getState().tabs).toHaveLength(2);
    expect(useViewer.getState().file?.name).toBe('links.pdf');

    activateTab(first);

    const state = useViewer.getState();
    expect(state.file?.name).toBe('basic-5.pdf');
    expect(state.currentPage).toBe(2);
    expect(state.zoomMode).toEqual({ kind: 'custom', zoom: 1.5 });
    expect(state.navRequest?.page).toBe(2);
    expect(state.navRequest?.yFraction).toBe(0.5);
    expect(spies.loads).toBe(2);
  });

  it('abrir de nuevo un fichero ya abierto activa su pestaña, avisa y cierra la carga repetida', async () => {
    const basic = fileAt('basic-5.pdf');
    await openRequested(basic);
    await openRequested(fileAt('links.pdf'));

    const repeated = fileAt('basic-5.pdf');
    await openRequested(repeated);

    expect(useTabs.getState().tabs).toHaveLength(2);
    expect(activeTitle()).toBe('basic-5.pdf');
    expect(useViewer.getState().status).toBe('ready');
    expect(useViewer.getState().notice?.text).toBe(tabsMsg.alreadyOpen('basic-5.pdf'));
    expect(useViewer.getState().notice?.text).toBe('“basic-5.pdf” ya está abierto.');
    expect(platform.closeFile).toHaveBeenCalledWith(repeated);
  });

  it('un fichero corrupto con otro abierto queda en error en su pestaña; cerrarla devuelve la primera intacta', async () => {
    await openRequested(fileAt('basic-5.pdf'));

    await openRequested(fileAt('corrupt-not-pdf.pdf'));

    expect(tabTitles()).toEqual(['basic-5.pdf', 'corrupt-not-pdf.pdf']);
    expect(useViewer.getState().status).toBe('error');

    expect(await closeTab(useTabs.getState().activeId ?? '')).toBe('closed');

    expect(tabTitles()).toEqual(['basic-5.pdf']);
    expect(activeTitle()).toBe('basic-5.pdf');
    expect(useViewer.getState().status).toBe('ready');
    expect(useViewer.getState().dims?.count).toBe(5);
  });

  it('cerrar una pestaña suspendida libera su documento y su fichero; la activa no se toca', async () => {
    const basic = fileAt('basic-5.pdf');
    await openRequested(basic);
    const first = useTabs.getState().activeId ?? '';
    await openRequested(fileAt('links.pdf'));
    const activeBefore = useViewer.getState().pdf;

    expect(await closeTab(first)).toBe('closed');

    expect(spies.destroyed).toEqual([0]);
    expect(platform.closeFile).toHaveBeenCalledWith(basic);
    expect(tabTitles()).toEqual(['links.pdf']);
    expect(useViewer.getState().pdf).toBe(activeBefore);
    expect(useViewer.getState().status).toBe('ready');
  });

  it('el escaneo de la pestaña que se suspende queda abortado; al reanudar se lanza otro desde la página 1', async () => {
    await openRequested(fileAt('basic-5.pdf'));
    const first = useTabs.getState().activeId ?? '';
    await openRequested(fileAt('links.pdf'));
    expect(spies.scanSignals).toHaveLength(2);
    expect(spies.scanSignals[0]?.aborted).toBe(true);

    activateTab(first);

    expect(spies.scanSignals).toHaveLength(3);
    expect(spies.scanSignals[2]?.aborted).toBe(false);
    expect(useViewer.getState().file?.name).toBe('basic-5.pdf');
  });

  it('ninguna instantánea se escribe en las preferencias salvo las posiciones', async () => {
    await openRequested(fileAt('basic-5.pdf'));
    const first = useTabs.getState().activeId ?? '';
    await openRequested(fileAt('links.pdf'));
    activateTab(first);

    expect(prefsSet.mock.calls.length).toBeGreaterThan(0);
    expect(prefsSet.mock.calls.every(([key]) => key === POSITIONS_PREF_KEY)).toBe(true);
  });

  it('abrir un documento que ya está abierto en otra pestaña (mismo contenido) muestra la existente', async () => {
    await openRequested(fileAt('basic-5.pdf'));
    const copy = openedFile('basic-5.pdf', fixtureSource('basic-5.pdf'));

    await openRequested(copy);

    expect(useTabs.getState().tabs).toHaveLength(1);
    expect(activeTitle()).toBe('basic-5.pdf');
    expect(useViewer.getState().status).toBe('ready');
    expect(useViewer.getState().notice?.text).toBe(tabsMsg.alreadyOpen('basic-5.pdf'));
    expect(platform.closeFile).toHaveBeenCalledWith(copy);
  });

  it('abrir una copia desde una pestaña en error reutilizada no deja una pestaña vacía sobrante', async () => {
    await openRequested(fileAt('basic-5.pdf'));
    await openRequested(fileAt('corrupt-not-pdf.pdf'));
    expect(tabTitles()).toHaveLength(2);

    await openRequested(fileAt('basic-5.pdf', '/otra-carpeta/basic-5.pdf'));

    expect(tabTitles()).toEqual(['basic-5.pdf']);
    expect(activeTitle()).toBe('basic-5.pdf');
    expect(useViewer.getState().status).toBe('ready');
  });

  it('abrir una copia desde una pestaña vacía reutilizada no deja una pestaña vacía sobrante', async () => {
    await openRequested(fileAt('basic-5.pdf'));
    await openRequested(fileAt('links.pdf'));
    await closeDocument();
    expect(useViewer.getState().status).toBe('empty');
    expect(tabTitles()).toHaveLength(2);

    await openRequested(fileAt('basic-5.pdf', '/otra-carpeta/basic-5.pdf'));

    expect(tabTitles()).toEqual(['basic-5.pdf']);
    expect(activeTitle()).toBe('basic-5.pdf');
    expect(useViewer.getState().status).toBe('ready');
  });

  it('cancelar la contraseña de un documento nuevo cierra su pestaña y vuelve a la anterior', async () => {
    await openRequested(fileAt('basic-5.pdf'));

    const opening = openRequested(fileAt('encrypted-aes-128.pdf'));
    await waitUntil(() => usePasswordPrompt.getState().request !== null);
    cancelPassword();
    await opening;

    expect(tabTitles()).toEqual(['basic-5.pdf']);
    expect(activeTitle()).toBe('basic-5.pdf');
    expect(useViewer.getState().status).toBe('ready');
  });

  it('una pestaña con error se guarda con su error al cambiar de pestaña y lo mantiene al volver', async () => {
    await openRequested(fileAt('basic-5.pdf'));
    const basic = useTabs.getState().activeId ?? '';
    await openRequested(fileAt('corrupt-not-pdf.pdf'));
    const broken = useTabs.getState().activeId ?? '';

    activateTab(basic);
    expect(useViewer.getState().status).toBe('ready');

    activateTab(broken);
    expect(useViewer.getState().status).toBe('error');
    expect(activeTitle()).toBe('corrupt-not-pdf.pdf');
  });
});
