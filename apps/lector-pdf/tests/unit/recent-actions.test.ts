import { beforeEach, describe, expect, it, vi } from 'vitest';
import { platformError, memorySource, type OpenedFile, type Platform, type RecentFile } from '@suite/platform';
import { err, ok } from '@suite/shared';
import { openRequested } from '../../src/state/document-actions';
import { forgetAllRecent, forgetRecent, openRecentFile, refreshRecent, startRecentSync, useRecent } from '../../src/state/recent-actions';
import { initServices } from '../../src/state/services';
import { useViewer, initialViewerState } from '../../src/state/viewer-store';
import { createFakePlatform, openedFile } from '../helpers/fake-platform';

vi.mock('../../src/state/document-actions', () => ({ openRequested: vi.fn(async () => undefined) }));

function recent(id: string, name: string, available = true): RecentFile {
  return { id, name, path: null, size: 10, openedAt: 1_000, available };
}

let platform: Platform;
let list: RecentFile[];

function setup(overrides: Partial<Platform> = {}): void {
  platform = createFakePlatform({
    recentFiles: vi.fn(async () => list),
    ...overrides,
  });
  initServices({ platform, assetBaseUrl: 'http://localhost/pdfjs/' });
}

beforeEach(() => {
  vi.mocked(openRequested).mockClear();
  list = [];
  useRecent.setState({ list: [], loading: false });
  useViewer.setState(initialViewerState);
  setup();
});

describe('refreshRecent', () => {
  it('carga la lista de la plataforma y deja como mucho 10 entradas', async () => {
    list = Array.from({ length: 12 }, (_, i) => recent(`id-${String(i)}`, `doc-${String(i)}.pdf`));
    await refreshRecent();
    const { list: shown, loading } = useRecent.getState();
    expect(shown).toHaveLength(10);
    expect(shown[0]?.name).toBe('doc-0.pdf');
    expect(loading).toBe(false);
  });

  it('un fallo de la plataforma deja la lista como estaba y quita el estado de carga', async () => {
    useRecent.setState({ list: [recent('a', 'a.pdf')] });
    setup({ recentFiles: vi.fn(async () => { throw new Error('IndexedDB cerrada'); }) });
    await refreshRecent();
    expect(useRecent.getState().list.map((e) => e.name)).toEqual(['a.pdf']);
    expect(useRecent.getState().loading).toBe(false);
  });
});

describe('openRecentFile', () => {
  it('reabre el fichero devuelto por la plataforma con el flujo de «Abrir»', async () => {
    const file: OpenedFile = openedFile('links.pdf', memorySource(new Uint8Array([1])));
    setup({ openRecent: vi.fn(async () => ok(file)) });
    await openRecentFile('id-1');
    expect(platform.openRecent).toHaveBeenCalledWith('id-1');
    expect(openRequested).toHaveBeenCalledWith(file);
  });

  it('si el usuario negó el permiso no abre nada ni avisa', async () => {
    setup({ openRecent: vi.fn(async () => ok(null)) });
    await openRecentFile('id-1');
    expect(openRequested).not.toHaveBeenCalled();
    expect(useViewer.getState().notice).toBeNull();
  });

  it('si el fichero ya no existe avisa con su nombre y refresca la lista', async () => {
    list = [recent('id-1', 'basic-5.pdf', false)];
    useRecent.setState({ list: [recent('id-1', 'basic-5.pdf')] });
    setup({ openRecent: vi.fn(async () => err(platformError('not-found'))), recentFiles: vi.fn(async () => list) });
    await openRecentFile('id-1');
    expect(useViewer.getState().notice?.text).toBe('No se encuentra “basic-5.pdf”. Puede que se haya movido o borrado.');
    expect(openRequested).not.toHaveBeenCalled();
    expect(useRecent.getState().list[0]?.available).toBe(false);
  });

  it('otro fallo muestra que no se ha podido abrir', async () => {
    list = [recent('id-1', 'a.pdf')];
    useRecent.setState({ list });
    setup({ openRecent: vi.fn(async () => err(platformError('permission-denied'))) });
    await openRecentFile('id-1');
    expect(useViewer.getState().notice?.text).toBe('No se ha podido abrir «a.pdf»');
  });
});

describe('quitar recientes', () => {
  it('forgetRecent quita una entrada y refresca', async () => {
    list = [recent('id-2', 'b.pdf')];
    await forgetRecent('id-1');
    expect(platform.removeRecent).toHaveBeenCalledWith('id-1');
    expect(useRecent.getState().list.map((e) => e.id)).toEqual(['id-2']);
  });

  it('forgetAllRecent vacía la lista', async () => {
    list = [];
    await forgetAllRecent();
    expect(platform.clearRecents).toHaveBeenCalledOnce();
    expect(useRecent.getState().list).toEqual([]);
  });
});

describe('startRecentSync', () => {
  it('carga al arrancar y de nuevo cuando cambia el documento abierto (apertura o guardado)', async () => {
    const stop = startRecentSync();
    await vi.waitFor(() => { expect(platform.recentFiles).toHaveBeenCalledTimes(1); });

    useViewer.setState({ file: openedFile('a.pdf', memorySource(new Uint8Array([1]))) });
    await vi.waitFor(() => { expect(platform.recentFiles).toHaveBeenCalledTimes(2); });

    useViewer.setState({ notice: { id: 1, text: 'aviso' } });
    await Promise.resolve();
    expect(platform.recentFiles).toHaveBeenCalledTimes(2);

    stop();
    useViewer.setState({ file: null });
    await Promise.resolve();
    expect(platform.recentFiles).toHaveBeenCalledTimes(2);
  });
});
