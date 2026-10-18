// @vitest-environment jsdom
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { LoadedPdf, LoadOptions } from '../../src/engine';
import { pdfError } from '../../src/core/errors';
import { err, ok, type Result } from '@suite/shared';
import { memorySource, type OpenedFile, type Platform } from '@suite/platform';
import { App } from '../../src/ui/App';
import { closeDocument } from '../../src/state/document-actions';
import { initServices } from '../../src/state/services';
import { initialViewerState, useViewer } from '../../src/state/viewer-store';
import { createFakePlatform, openedFile } from '../helpers/fake-platform';

const engine = vi.hoisted(() => ({ loadPdf: vi.fn() }));

// Motor falso: no hay pdf.js en jsdom. La carga la controla cada prueba.
vi.mock('../../src/engine', () => ({
  loadPdf: engine.loadPdf,
  readPageDims: async () => ({ index: 0, width: 595, height: 842, rotation: 0 }),
  scanPageDims: async () => 'done',
  scanAnnotations: async () => 'done',
}));

const ASSET_BASE = 'http://localhost/pdfjs/';

/** Página de pdf.js mínima: el visor pide tamaño, rotación, dibujo y liberación. El dibujo no termina nunca. */
function fakePage(): unknown {
  return {
    rotate: 0,
    getViewport: () => ({ width: 612, height: 792 }),
    render: () => ({ promise: new Promise<void>(() => undefined), cancel: () => undefined }),
    cleanup: () => true,
  };
}

function fakeLoaded(numPages: number): LoadedPdf {
  return {
    doc: { getPage: async () => fakePage() } as unknown as LoadedPdf['doc'],
    numPages,
    fingerprint: 'fake',
    onIoError: () => () => undefined,
    destroy: async () => undefined,
  };
}

/** Deja la carga pendiente hasta la cancelación: el motor falso responde `cancelled` si se cancela. */
function holdLoad(): void {
  engine.loadPdf.mockImplementation((_source: unknown, opts: LoadOptions) => new Promise<Result<LoadedPdf>>((resolve) => {
    opts.signal?.addEventListener('abort', () => { resolve(err(pdfError('cancelled'))); });
  }));
}

function pdfFile(name: string): File {
  return new File(['%PDF-1.4'], name, { type: 'application/pdf' });
}

let platform: Platform;
let file: OpenedFile;

function setup(overrides: Partial<Platform> = {}): Platform {
  platform = createFakePlatform({
    openBrowserFile: () => ok(file),
    ...overrides,
  });
  initServices({ platform, assetBaseUrl: ASSET_BASE });
  return platform;
}

beforeEach(() => {
  file = openedFile('a.pdf', memorySource(new Uint8Array([1, 2, 3])));
  engine.loadPdf.mockReset();
  useViewer.setState(initialViewerState);
  setup();
});

afterEach(async () => {
  await closeDocument();
});

describe('estados de apertura', () => {
  it('con la carga pendiente muestra el estado de carga con el nombre y Cancelar', async () => {
    const user = userEvent.setup();
    holdLoad();
    render(<App />);

    await user.upload(screen.getByTestId('open-input'), pdfFile('a.pdf'));

    const status = await screen.findByRole('status');
    expect(within(status).getByText('Abriendo «a.pdf»…')).toBeInTheDocument();
    expect(within(status).getByRole('button', { name: 'Cancelar' })).toBeInTheDocument();
  });

  it('Cancelar aborta la carga y vuelve al estado vacío', async () => {
    const user = userEvent.setup();
    holdLoad();
    render(<App />);
    await user.upload(screen.getByTestId('open-input'), pdfFile('a.pdf'));

    await user.click(await screen.findByRole('button', { name: 'Cancelar' }));

    expect(await screen.findByRole('heading', { level: 1, name: 'Abre un PDF para empezar' })).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('si la carga falla muestra el mensaje de error en un role=alert', async () => {
    const user = userEvent.setup();
    engine.loadPdf.mockResolvedValue(err(pdfError('not-pdf')));
    render(<App />);

    await user.upload(screen.getByTestId('open-input'), pdfFile('a.pdf'));

    const alert = await screen.findByRole('alert');
    expect(within(alert).getByText('Este fichero no es un PDF.')).toBeInTheDocument();
    expect(within(alert).getByText('No se ha podido abrir «a.pdf»')).toBeInTheDocument();
    expect(within(alert).getByRole('button', { name: 'Abrir otro…' })).toBeInTheDocument();
  });

  it('con un documento cargado muestra el número de páginas y pone el título de la ventana', async () => {
    const user = userEvent.setup();
    engine.loadPdf.mockResolvedValue(ok(fakeLoaded(5)));
    render(<App />);

    await user.upload(screen.getByTestId('open-input'), pdfFile('a.pdf'));

    expect(await screen.findByTestId('document-ready')).toHaveTextContent('5 páginas');
    expect(platform.setTitle).toHaveBeenLastCalledWith('a.pdf — Lector PDF');
  });
});

describe('atajos y botones', () => {
  it('Ctrl+O llama al selector de la plataforma', async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.keyboard('{Control>}o{/Control}');

    expect(platform.openFile).toHaveBeenCalledTimes(1);
  });

  it('Ctrl+O también funciona dentro de un campo de texto', async () => {
    const user = userEvent.setup();
    const input = document.createElement('input');
    document.body.append(input);
    try {
      render(<App />);
      input.focus();

      await user.keyboard('{Control>}o{/Control}');

      expect(platform.openFile).toHaveBeenCalledTimes(1);
    } finally {
      input.remove();
    }
  });

  it('el botón Abrir… de la barra abre el selector', async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(within(screen.getByRole('toolbar')).getByRole('button', { name: 'Abrir…' }));

    expect(platform.openFile).toHaveBeenCalledTimes(1);
  });

  it('se puede llegar a los botones con el teclado (Tab)', async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.tab();
    expect(within(screen.getByRole('toolbar')).getByRole('button', { name: 'Abrir…' })).toHaveFocus();

    // Sin documento, la barra solo tiene activo «Apariencia» (PDF-020): el Tab pasa por él antes del visor.
    await user.tab();
    expect(within(screen.getByRole('toolbar')).getByRole('button', { name: 'Apariencia' })).toHaveFocus();

    await user.tab();
    expect(within(screen.getByRole('main')).getByRole('button', { name: 'Abrir…' })).toHaveFocus();
  });
});

describe('arrastrar ficheros (web)', () => {
  it('muestra la superposición al arrastrar un fichero y abre el primero al soltarlo', async () => {
    engine.loadPdf.mockResolvedValue(ok(fakeLoaded(2)));
    setup({ openDropped: vi.fn(async () => ok(file)) });
    render(<App />);

    const dataTransfer = { types: ['Files'], items: [], files: [pdfFile('a.pdf')] };
    fireEvent.dragEnter(window, { dataTransfer });
    expect(screen.getByText('Suelta el PDF para abrirlo')).toBeInTheDocument();

    fireEvent.drop(window, { dataTransfer });

    expect(await screen.findByTestId('document-ready')).toHaveTextContent('2 páginas');
    expect(platform.openDropped).toHaveBeenCalledTimes(1);
    expect(screen.queryByText('Suelta el PDF para abrirlo')).not.toBeInTheDocument();
  });
});

describe('error de lectura con el documento abierto', () => {
  it('muestra el aviso con el mensaje y «Cerrar documento» vuelve al estado vacío', async () => {
    const user = userEvent.setup();
    engine.loadPdf.mockResolvedValue(ok(fakeLoaded(3)));
    render(<App />);
    await user.upload(screen.getByTestId('open-input'), pdfFile('a.pdf'));
    await screen.findByTestId('document-ready');

    act(() => {
      useViewer.setState({ ioError: pdfError('io') });
    });
    const banner = await screen.findByRole('alert');
    expect(within(banner).getByText('No se ha podido leer el fichero. Comprueba que sigue en su sitio.')).toBeInTheDocument();

    await user.click(within(banner).getByRole('button', { name: 'Cerrar documento' }));

    expect(await screen.findByRole('heading', { level: 1, name: 'Abre un PDF para empezar' })).toBeInTheDocument();
    expect(useViewer.getState().ioError).toBeNull();
  });
});
