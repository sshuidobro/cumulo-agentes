// @vitest-environment jsdom
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { memorySource, type ByteSource, type OpenedFile } from '@suite/platform';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { LoadedPdf } from '../../src/engine';
import { ObjectReader } from '../../src/core/pdf/object-reader';
import { PropertiesDialog } from '../../src/ui/properties/PropertiesDialog';
import { resetFontScan } from '../../src/state/fonts-actions';
import { initialFontScan, useFontScan } from '../../src/state/fonts-store';
import { openProperties, usePropertiesDialog } from '../../src/state/properties-store';
import { initServices } from '../../src/state/services';
import { initialViewerState, useViewer } from '../../src/state/viewer-store';
import { createFakePlatform } from '../helpers/fake-platform';
import { PdfBuilder } from '../fixtures/pdf-builder';

/** Documento mínimo para el diálogo (sus metadatos no son lo que se prueba aquí). */
const fakePdf = {
  doc: {
    numPages: 1,
    getMetadata: () => Promise.resolve({ info: {}, metadata: null }),
    getMarkInfo: () => Promise.resolve(null),
    getPage: () => Promise.resolve({ pageNumber: 1, rotate: 0, getViewport: () => ({ width: 595, height: 842 }) }),
    destroy: () => Promise.resolve(),
  },
  numPages: 1,
  fingerprint: 'fonts',
  onIoError: () => () => undefined,
  destroy: () => Promise.resolve(),
} as unknown as LoadedPdf;

/** Fuente que no entrega bytes hasta que el test la abre: el escaneo queda parado de forma determinista. */
function gatedSource(inner: ByteSource): { readonly source: ByteSource; readonly release: () => void } {
  let release: () => void = () => undefined;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  return {
    source: { size: inner.size, read: async (begin, end) => { await gate; return inner.read(begin, end); } },
    release,
  };
}

function openFile(source: ByteSource): OpenedFile {
  return { token: 'fonts-ui', name: 'basic-5.pdf', path: null, size: source.size, lastModified: null, canSaveInPlace: false, source };
}

/** Una página con Helvetica (WinAnsi, no incrustada), generada en memoria (jsdom no lee fixtures). */
function basicSource(): ByteSource {
  const b = new PdfBuilder();
  const catalog = b.alloc();
  const pages = b.alloc();
  const font = b.addObject('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>');
  const page = b.addObject(`<< /Type /Page /Parent ${String(pages)} 0 R /Resources << /Font << /F1 ${String(font)} 0 R >> >> >>`);
  b.setObject(pages, `<< /Type /Pages /Kids [${String(page)} 0 R] /Count 1 >>`);
  b.setObject(catalog, `<< /Type /Catalog /Pages ${String(pages)} 0 R >>`);
  return memorySource(b.build({ root: catalog }));
}

/** Documento de `count` páginas con Helvetica en todas (la fuente es la misma: el escaneo la lee una vez). */
function manyPagesSource(count: number): ByteSource {
  const b = new PdfBuilder();
  const catalog = b.alloc();
  const pages = b.alloc();
  const font = b.addObject('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>');
  const kids: string[] = [];
  for (let i = 0; i < count; i++) {
    kids.push(`${String(b.addObject(`<< /Type /Page /Parent ${String(pages)} 0 R /Resources << /Font << /F1 ${String(font)} 0 R >> >> >>`))} 0 R`);
  }
  b.setObject(pages, `<< /Type /Pages /Kids [${kids.join(' ')}] /Count ${String(count)} >>`);
  b.setObject(catalog, `<< /Type /Catalog /Pages ${String(pages)} 0 R >>`);
  return memorySource(b.build({ root: catalog }));
}

async function openFontsTab(user: ReturnType<typeof userEvent.setup>): Promise<HTMLElement> {
  render(<PropertiesDialog />);
  act(() => { openProperties(); });
  const dialog = await screen.findByRole('dialog', { name: 'Propiedades del documento' });
  await user.click(within(dialog).getByRole('tab', { name: 'Fuentes' }));
  return dialog;
}

beforeEach(() => {
  initServices({ platform: createFakePlatform(), assetBaseUrl: 'http://localhost/pdfjs/' });
  usePropertiesDialog.setState({ open: false });
});

afterEach(() => {
  resetFontScan();
  usePropertiesDialog.setState({ open: false });
  useViewer.setState(initialViewerState);
  useFontScan.setState(initialFontScan);
});

describe('pestaña «Fuentes» del diálogo de propiedades', () => {
  it('con Fuentes seleccionada muestra la tabla de fuentes del documento', async () => {
    useViewer.setState({ ...initialViewerState, status: 'ready', pdf: fakePdf, file: openFile(basicSource()), currentPage: 0 });
    const user = userEvent.setup();
    const dialog = await openFontsTab(user);

    const table = await within(dialog).findByRole('table');
    const headers = within(table).getAllByRole('columnheader').map((th) => th.textContent);
    expect(headers).toEqual(['Nombre', 'Tipo', 'Codificación', 'Incrustada']);
    const row = within(table).getByRole('row', { name: /Helvetica/ });
    expect(within(row).getAllByRole('cell').map((td) => td.textContent)).toEqual(['Helvetica', 'Type1', 'WinAnsiEncoding', 'No']);
    await waitFor(() => { expect(within(dialog).queryByRole('status')).toBeNull(); });
    expect(within(dialog).queryByRole('button', { name: 'Detener' })).toBeNull();
  });

  it('«Detener» durante el escaneo muestra lo encontrado y la página donde se detuvo; no sigue leyendo', async () => {
    const gate = gatedSource(basicSource());
    useViewer.setState({ ...initialViewerState, status: 'ready', pdf: fakePdf, file: openFile(gate.source), currentPage: 0 });
    const user = userEvent.setup();
    const dialog = await openFontsTab(user);

    expect(await within(dialog).findByRole('status')).toHaveTextContent('Buscando fuentes…');
    await user.click(within(dialog).getByRole('button', { name: 'Detener' }));
    expect(within(dialog).getByText('Búsqueda detenida antes de terminar la primera página.')).toBeInTheDocument();
    expect(within(dialog).queryByRole('status')).toBeNull();

    // Al liberar la lectura pendiente, el escaneo ya parado no publica nada más.
    act(() => { gate.release(); });
    await new Promise((resolve) => { setTimeout(resolve, 30); });
    expect(useFontScan.getState().status).toBe('cancelled');
    expect(useFontScan.getState().fonts).toEqual([]);
    expect(within(dialog).queryByRole('table')).toBeNull();
  });

  it('«Detener» tras el primer lote de 200 páginas dice cuántas se han revisado de cuántas', async () => {
    // Las páginas 201 en adelante se quedan esperando: el escaneo para en el lote 2 sin que el test dependa del tiempo.
    const pageRef = ObjectReader.prototype.pageRef;
    let calls = 0;
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const spy = vi.spyOn(ObjectReader.prototype, 'pageRef').mockImplementation(async function (this: ObjectReader, index: number) {
      calls += 1;
      if (calls > 200) await gate;
      return pageRef.call(this, index);
    });
    try {
      useViewer.setState({ ...initialViewerState, status: 'ready', pdf: fakePdf, file: openFile(manyPagesSource(450)), currentPage: 0 });
      const user = userEvent.setup();
      const dialog = await openFontsTab(user);

      expect(await within(dialog).findByText('Buscando fuentes… 200 de 450 páginas')).toBeInTheDocument();
      await user.click(within(dialog).getByRole('button', { name: 'Detener' }));
      expect(within(dialog).getByText('Búsqueda detenida tras revisar 200 de 450 páginas.')).toBeInTheDocument();
      expect(within(dialog).getByRole('table')).toHaveTextContent('Helvetica');
    } finally {
      release();
      spy.mockRestore();
    }
  });

  it('error de lectura: muestra el mensaje en español', async () => {
    const broken: ByteSource = { size: 1000, read: () => Promise.reject(new Error('disco no disponible')) };
    useViewer.setState({ ...initialViewerState, status: 'ready', pdf: fakePdf, file: openFile(broken), currentPage: 0 });
    const user = userEvent.setup();
    const dialog = await openFontsTab(user);
    expect(await within(dialog).findByText('No se han podido leer las fuentes de este PDF.')).toBeInTheDocument();
  });

  it('cerrar el diálogo cancela el escaneo y, al reabrirlo, empieza de cero', async () => {
    const gate = gatedSource(basicSource());
    useViewer.setState({ ...initialViewerState, status: 'ready', pdf: fakePdf, file: openFile(gate.source), currentPage: 0 });
    const user = userEvent.setup();
    await openFontsTab(user);
    await user.keyboard('{Escape}');
    await waitFor(() => { expect(screen.queryByRole('dialog')).toBeNull(); });
    expect(useFontScan.getState().status).toBe('idle');
    gate.release();
  });
});
