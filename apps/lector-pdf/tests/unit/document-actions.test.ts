import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { platformError, type ByteSource, type Platform } from '@suite/platform';
import { err, ok } from '@suite/shared';
import type * as EngineModule from '../../src/engine';
import type { LoadOptions } from '../../src/engine';
import {
  cancelOpening,
  closeDocument,
  openBrowserFile,
  openDocument,
  openDropped,
  pickAndOpen,
  reportPageDims,
} from '../../src/state/document-actions';
import { initServices } from '../../src/state/services';
import { initialViewerState, useViewer } from '../../src/state/viewer-store';
import { createFakePlatform, openedFile } from '../helpers/fake-platform';
import { fixtureSource, nodeAssetBase } from '../helpers/pdfjs-node';

// Espía: registra cuántas veces se destruye el documento abierto en cada llamada a loadPdf
// (la llamada n-ésima tiene índice n, empezando en 0). El motor real sigue haciendo el trabajo.
const spies = vi.hoisted(() => ({ calls: 0, destroyed: [] as number[] }));

vi.mock('../../src/engine', async (importOriginal) => {
  const actual = await importOriginal<typeof EngineModule>();
  return {
    ...actual,
    loadPdf: async (source: ByteSource, opts: LoadOptions) => {
      const index = spies.calls;
      spies.calls += 1;
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
  };
});

const assetBaseUrl = nodeAssetBase();

/** Fuente que no entrega datos hasta que se llama a `open()`. */
function gatedSource(inner: ByteSource): { source: ByteSource; open: () => void } {
  let release: () => void = () => undefined;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  return {
    source: {
      size: inner.size,
      async read(begin, end) {
        await gate;
        return inner.read(begin, end);
      },
    },
    open: release,
  };
}

/** Espera a que se cumpla `condition` (sondeo breve, sin depender de la hora del sistema). */
async function waitUntil(condition: () => boolean, timeoutMs = 15_000): Promise<void> {
  const start = Date.now();
  while (!condition()) {
    if (Date.now() - start > timeoutMs) throw new Error('Tiempo agotado esperando una condición');
    await new Promise((resolve) => { setTimeout(resolve, 5); });
  }
}

let platform: Platform;

beforeEach(() => {
  platform = createFakePlatform();
  initServices({ platform, assetBaseUrl });
  useViewer.setState(initialViewerState);
  spies.calls = 0;
  spies.destroyed.length = 0;
});

afterEach(async () => {
  await closeDocument();
});

describe('openDocument', () => {
  it('abre basic-5 y deja el documento listo con 5 páginas y el título de la ventana', async () => {
    await openDocument(openedFile('basic-5.pdf', fixtureSource('basic-5.pdf')));

    const state = useViewer.getState();
    expect(state.status).toBe('ready');
    expect(state.dims?.count).toBe(5);
    expect(state.pdf?.numPages).toBe(5);
    expect(state.file?.name).toBe('basic-5.pdf');
    expect(platform.setTitle).toHaveBeenLastCalledWith('basic-5.pdf — Lector PDF');
  });

  it('lee las etiquetas de página del PDF en segundo plano (page-labels.pdf: «i», «ii», … «A-1»)', async () => {
    await openDocument(openedFile('page-labels.pdf', fixtureSource('page-labels.pdf')));
    expect(useViewer.getState().status).toBe('ready');

    await waitUntil(() => useViewer.getState().pageLabels !== null);

    const labels = useViewer.getState().pageLabels;
    expect(labels?.length).toBe(12);
    expect(labels?.[0]).toBe('i');
    expect(labels?.[3]).toBe('iv');
    expect(labels?.[11]).toBe('A-1');
  });

  it('un PDF sin etiquetas de página deja pageLabels en null', async () => {
    await openDocument(openedFile('basic-5.pdf', fixtureSource('basic-5.pdf')));

    expect(await useViewer.getState().pdf?.doc.getPageLabels()).toBeNull();
    expect(useViewer.getState().pageLabels).toBeNull();
  });

  it('tras el escaneo corrige las dimensiones de las páginas distintas de la primera', async () => {
    await openDocument(openedFile('sizes-mixed.pdf', fixtureSource('sizes-mixed.pdf')));
    const versionAfterOpen = useViewer.getState().dimsVersion;

    await waitUntil(() => useViewer.getState().dimsVersion > versionAfterOpen);

    const dims = useViewer.getState().dims;
    expect(dims?.width(1)).toBe(792);
    expect(dims?.height(1)).toBe(612);
  });

  it('con dos aperturas seguidas (A lenta, B rápida) acaba con B y no deja vivo ningún documento de A', async () => {
    const slow = gatedSource(fixtureSource('basic-5.pdf'));
    const openingA = openDocument(openedFile('basic-5.pdf', slow.source));
    await openDocument(openedFile('sizes-mixed.pdf', fixtureSource('sizes-mixed.pdf')));

    slow.open();
    await openingA;

    const state = useViewer.getState();
    expect(state.status).toBe('ready');
    expect(state.file?.name).toBe('sizes-mixed.pdf');
    expect(state.pdf?.numPages).toBe(6);
    const alive = Array.from({ length: spies.calls }, (_, i) => i).filter((i) => !spies.destroyed.includes(i));
    expect(alive).toHaveLength(1); // solo el de B
  });

  it('un PDF corrupto deja el estado de error con el mensaje en español', async () => {
    await openDocument(openedFile('corrupt-not-pdf.pdf', fixtureSource('corrupt-not-pdf.pdf')));

    const state = useViewer.getState();
    expect(state.status).toBe('error');
    expect(state.error?.message).toBe('Este fichero no es un PDF.');
    expect(state.loadingName).toBe('corrupt-not-pdf.pdf');
    expect(platform.setTitle).toHaveBeenLastCalledWith('Lector PDF');
  });

  it('un fichero vacío informa de que tiene 0 bytes', async () => {
    await openDocument(openedFile('corrupt-empty.pdf', fixtureSource('corrupt-empty.pdf')));

    expect(useViewer.getState().error?.message).toBe('El fichero está vacío (0 bytes).');
  });

  it('cancelOpening durante la carga deja el estado vacío sin mensaje', async () => {
    const slow = gatedSource(fixtureSource('basic-5.pdf'));
    const opening = openDocument(openedFile('basic-5.pdf', slow.source));
    expect(useViewer.getState().status).toBe('loading');

    cancelOpening();
    slow.open();
    await opening;

    const state = useViewer.getState();
    expect(state.status).toBe('empty');
    expect(state.error).toBeNull();
  });

  it('informa de progreso con valores entre 0 y 1 mientras carga', async () => {
    const progress: (number | null)[] = [];
    const unsubscribe = useViewer.subscribe((state) => {
      if (state.status === 'loading') progress.push(state.loadProgress);
    });
    try {
      await openDocument(openedFile('basic-5.pdf', fixtureSource('basic-5.pdf')));
    } finally {
      unsubscribe();
    }
    for (const value of progress) {
      expect(value === null || (value >= 0 && value <= 1)).toBe(true);
    }
  });
});

describe('closeDocument', () => {
  it('libera el documento, cierra el fichero y restaura el título por defecto', async () => {
    const file = openedFile('basic-5.pdf', fixtureSource('basic-5.pdf'));
    await openDocument(file);

    await closeDocument();

    expect(useViewer.getState().status).toBe('empty');
    expect(useViewer.getState().pdf).toBeNull();
    expect(spies.destroyed).toEqual([0]);
    expect(platform.closeFile).toHaveBeenCalledWith(file);
    expect(platform.setTitle).toHaveBeenLastCalledWith('Lector PDF');
  });
});

describe('selección de ficheros', () => {
  it('pickAndOpen con un error del selector muestra el estado de error', async () => {
    platform = createFakePlatform({
      openFile: async () => err(platformError('permission-denied')),
    });
    initServices({ platform, assetBaseUrl });

    await pickAndOpen();

    const state = useViewer.getState();
    expect(state.status).toBe('error');
    expect(state.error?.code).toBe('permission-denied');
  });

  it('pickAndOpen cancelado por el usuario no cambia el estado', async () => {
    await pickAndOpen();
    expect(useViewer.getState().status).toBe('empty');
  });

  it('openDropped con una excepción de la plataforma muestra el estado de error en español', async () => {
    platform = createFakePlatform({
      openDropped: async () => {
        throw new Error('fallo inesperado');
      },
    });
    initServices({ platform, assetBaseUrl });

    await expect(openDropped({ items: [], files: [] } as unknown as DataTransfer)).resolves.toBeUndefined();

    const state = useViewer.getState();
    expect(state.status).toBe('error');
    expect(state.error?.code).toBe('io');
    expect(state.error?.message).toBe('No se ha podido leer o escribir el fichero.');
  });

  it('openBrowserFile abre el fichero que entrega la plataforma', async () => {
    const file = openedFile('basic-5.pdf', fixtureSource('basic-5.pdf'));
    platform = createFakePlatform({
      openBrowserFile: () => ok(file),
    });
    initServices({ platform, assetBaseUrl });

    openBrowserFile(new File([], 'basic-5.pdf'));
    await waitUntil(() => useViewer.getState().status !== 'loading');

    expect(useViewer.getState().status).toBe('ready');
  });
});

describe('reportPageDims', () => {
  it('no hace nada si no hay documento', () => {
    reportPageDims({ index: 0, width: 100, height: 100, rotation: 0 });
    expect(useViewer.getState().dims).toBeNull();
    expect(useViewer.getState().dimsVersion).toBe(0);
  });

  it('sube dimsVersion solo cuando cambia el valor', async () => {
    await openDocument(openedFile('basic-5.pdf', fixtureSource('basic-5.pdf')));
    const before = useViewer.getState().dimsVersion;
    const dims = useViewer.getState().dims;
    const width = dims?.width(2) ?? -1;
    const height = dims?.height(2) ?? -1;

    reportPageDims({ index: 2, width, height, rotation: 0 });
    expect(useViewer.getState().dimsVersion).toBe(before);

    reportPageDims({ index: 2, width: width + 100, height, rotation: 0 });
    expect(useViewer.getState().dimsVersion).toBe(before + 1);
    expect(dims?.width(2)).toBe(width + 100);
  });
});

describe('modo de vista entre documentos', () => {
  it('abrir otro documento conserva el modo de vista (es una preferencia global)', async () => {
    useViewer.setState({ viewMode: { scroll: 'paged', spread: 'cover' } });
    await openDocument(openedFile('basic-5.pdf', fixtureSource('basic-5.pdf')));
    expect(useViewer.getState().status).toBe('ready');
    expect(useViewer.getState().viewMode).toEqual({ scroll: 'paged', spread: 'cover' });
  });
});
