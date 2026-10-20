// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { unzipSync } from 'fflate';
import { memorySource, type OpenedFile, type Platform } from '@suite/platform';
import type { LoadedPdf, PDFDocumentProxy } from '../../src/engine';
import { renderPageImage } from '../../src/engine/print-render';
import { createPageTextSource } from '../../src/engine/search-source';
import { ALL_PERMISSIONS } from '../../src/core/permissions';
import {
  cancelExport,
  closeExportDialog,
  EXPORT_OPTIONS_PREF,
  openExportDialog,
  startExport,
  useExportDialog,
  useExportJob,
  type ExportOptions,
} from '../../src/state/export-actions';
import { useChoice } from '../../src/state/choice';
import { openPrintSource, type PrintSource } from '../../src/state/print-source';
import { initServices } from '../../src/state/services';
import { initialViewerState, useViewer } from '../../src/state/viewer-store';
import { exportMsg } from '../../src/ui/messages-export';
import { createFakePlatform } from '../helpers/fake-platform';

vi.mock('../../src/engine/print-render', () => ({ renderPageImage: vi.fn() }));
vi.mock('../../src/engine/search-source', () => ({ createPageTextSource: vi.fn() }));
vi.mock('../../src/state/print-source', () => ({ openPrintSource: vi.fn() }));

interface PageSize {
  readonly widthPt: number;
  readonly heightPt: number;
}

const PORTRAIT: PageSize = { widthPt: 595, heightPt: 842 };

/** Documento de prueba: tamaño de cada página y `getPage` con `getViewport` y `cleanup`. */
function fakeDoc(sizes: readonly PageSize[]): PDFDocumentProxy {
  return {
    numPages: sizes.length,
    getPage: (pageNumber: number) => {
      const size = sizes[pageNumber - 1];
      if (size === undefined) return Promise.reject(new Error(`no hay página ${String(pageNumber)}`));
      return Promise.resolve({
        getViewport: () => ({ width: size.widthPt, height: size.heightPt }),
        cleanup: () => true,
      });
    },
  } as unknown as PDFDocumentProxy;
}

function fakeSource(sizes: readonly PageSize[]): PrintSource {
  return {
    doc: fakeDoc(sizes),
    temporary: false,
    unsavedIncluded: true,
    dispose: vi.fn(() => Promise.resolve()),
  };
}

function setDocument(sizes: readonly PageSize[], currentPage = 0): PrintSource {
  const pdf = { doc: fakeDoc(sizes), numPages: sizes.length, fingerprint: 'fake' } as unknown as LoadedPdf;
  const file: OpenedFile = {
    token: 'fake',
    name: 'informe.pdf',
    path: null,
    size: 10,
    lastModified: null,
    canSaveInPlace: false,
    source: memorySource(new Uint8Array(0)),
  };
  useViewer.setState({ ...initialViewerState, status: 'ready', file, pdf, currentPage });
  const source = fakeSource(sizes);
  vi.mocked(openPrintSource).mockResolvedValue(source);
  return source;
}

const IMAGES_PNG: ExportOptions = { format: 'png', dpi: 150, withComments: true, pages: 'all', range: '' };

let prefs: Map<string, unknown>;
let platform: ReturnType<typeof createFakePlatform>;

beforeEach(() => {
  prefs = new Map();
  platform = createFakePlatform({
    prefs: {
      get: (key: string, guard: (value: unknown) => boolean) => {
        const value = prefs.get(key);
        return value !== undefined && guard(value) ? value : null;
      },
      set: (key: string, value: unknown) => { prefs.set(key, value); },
      remove: (key: string) => { prefs.delete(key); },
    } as Platform['prefs'],
  });
  initServices({ platform, assetBaseUrl: '/' });
  vi.mocked(renderPageImage).mockImplementation((_doc, index, o) =>
    Promise.resolve({ blob: new Blob([`pagina ${String(index)}`]), width: 1, height: 1, dpi: o.dpi }),
  );
  useExportDialog.setState({ open: false });
  useExportJob.setState({ job: { status: 'idle' } });
});

afterEach(() => {
  vi.clearAllMocks();
  useViewer.setState(initialViewerState);
  useChoice.setState({ active: null });
});

function noticeText(): string | undefined {
  return useViewer.getState().notice?.text;
}

describe('startExport · imágenes', () => {
  it('una página se guarda como PNG suelto con su número de página', async () => {
    setDocument([PORTRAIT, PORTRAIT, PORTRAIT], 1);

    const result = await startExport({ ...IMAGES_PNG, pages: 'current' });

    expect(result).toBe('saved');
    expect(platform.lastExport?.name).toBe('informe-p2.png');
    expect(noticeText()).toBe(exportMsg.done);
  });

  it('varias páginas se guardan en un ZIP sin recomprimir con números de página con ceros', async () => {
    setDocument([PORTRAIT, PORTRAIT, PORTRAIT]);

    const result = await startExport({ ...IMAGES_PNG, pages: 'range', range: '1-3' });

    expect(result).toBe('saved');
    expect(platform.lastExport?.name).toBe('informe-imagenes.zip');
    expect(platform.lastExport?.filters[0]?.extensions).toEqual(['zip']);
    const entries = unzipSync(platform.lastExport?.bytes ?? new Uint8Array());
    expect(Object.keys(entries)).toEqual(['informe-p0001.png', 'informe-p0002.png', 'informe-p0003.png']);
  });

  it('una página con menos ppp de los pedidos avisa de la resolución real', async () => {
    setDocument([PORTRAIT]);
    vi.mocked(renderPageImage).mockResolvedValueOnce({ blob: new Blob(['x']), width: 1, height: 1, dpi: 72 });

    await startExport({ ...IMAGES_PNG, dpi: 150 });

    expect(noticeText()).toBe(exportMsg.reduced(72));
  });

  it('estimación por encima de 1 GB: aviso y nada se guarda', async () => {
    setDocument(Array.from({ length: 30 }, () => PORTRAIT));

    const result = await startExport({ ...IMAGES_PNG, dpi: 600 });

    expect(result).toBe('failed');
    expect(noticeText()).toBe(exportMsg.tooBig);
    expect(platform.exportFile).not.toHaveBeenCalled();
    expect(renderPageImage).not.toHaveBeenCalled();
  });

  it('más de 200 páginas pide confirmación; cancelarla no guarda nada', async () => {
    setDocument(Array.from({ length: 201 }, () => PORTRAIT));

    const pending = startExport(IMAGES_PNG);
    await vi.waitFor(() => { expect(useChoice.getState().active).not.toBeNull(); });
    useChoice.getState().active?.options.find((o) => o.label === exportMsg.cancel)?.pick();

    expect(await pending).toBe('cancelled');
    expect(platform.exportFile).not.toHaveBeenCalled();
    expect(renderPageImage).not.toHaveBeenCalled();
  });

  it('cancelar a mitad no guarda nada y libera el documento temporal', async () => {
    const source = setDocument([PORTRAIT, PORTRAIT, PORTRAIT]);
    vi.mocked(renderPageImage).mockImplementationOnce(() => {
      cancelExport();
      return Promise.resolve('cancelled');
    });

    const result = await startExport(IMAGES_PNG);

    expect(result).toBe('cancelled');
    expect(platform.exportFile).not.toHaveBeenCalled();
    expect(source.dispose).toHaveBeenCalledTimes(1);
    expect(useExportJob.getState().job).toEqual({ status: 'idle' });
  });
});

describe('startExport · texto', () => {
  it('genera un TXT con BOM y un salto de página \\f entre páginas', async () => {
    setDocument([PORTRAIT, PORTRAIT, PORTRAIT, PORTRAIT, PORTRAIT]);
    vi.mocked(createPageTextSource).mockReturnValue({
      getPageItems: vi.fn(() => Promise.resolve([])),
    } as unknown as ReturnType<typeof createPageTextSource>);

    const result = await startExport({ ...IMAGES_PNG, format: 'txt' });

    expect(result).toBe('saved');
    expect(platform.lastExport?.name).toBe('informe.txt');
    // ignoreBOM: el decodificador deja el BOM en el texto (si no, lo quitaría y no lo comprobaríamos).
    const text = new TextDecoder('utf-8', { ignoreBOM: true }).decode(platform.lastExport?.bytes);
    expect(text.startsWith('﻿')).toBe(true);
    expect(text.split('\f')).toHaveLength(5);
  });
});

describe('startExport · errores y permisos', () => {
  it('rango no válido: aviso y nada se guarda', async () => {
    setDocument([PORTRAIT, PORTRAIT, PORTRAIT, PORTRAIT, PORTRAIT]);

    const result = await startExport({ ...IMAGES_PNG, pages: 'range', range: '9' });

    expect(result).toBe('failed');
    expect(noticeText()).toBe(exportMsg.invalidRange(5));
    expect(platform.exportFile).not.toHaveBeenCalled();
  });

  it('sin permiso de copia: no exporta y avisa', async () => {
    setDocument([PORTRAIT]);
    useViewer.setState({ permissions: { ...ALL_PERMISSIONS, copy: false } });

    const result = await startExport(IMAGES_PNG);
    openExportDialog();

    expect(result).toBe('failed');
    expect(noticeText()).toBe(exportMsg.blocked);
    expect(useExportDialog.getState().open).toBe(false);
    expect(platform.exportFile).not.toHaveBeenCalled();
  });

  it('exportar no cambia la lista de recientes', async () => {
    setDocument([PORTRAIT]);

    await startExport(IMAGES_PNG);

    expect(platform.recentFiles).not.toHaveBeenCalled();
  });
});

describe('opciones recordadas', () => {
  it('la última exportación se recuerda al volver a abrir el diálogo (sin el rango)', async () => {
    setDocument([PORTRAIT]);
    openExportDialog();
    expect(useExportDialog.getState().form).toMatchObject({ format: 'png', dpi: 150, withComments: true, pages: 'all' });
    closeExportDialog();

    await startExport({ format: 'jpeg', dpi: 300, withComments: false, pages: 'all', range: '1' });
    openExportDialog();

    expect(prefs.get(EXPORT_OPTIONS_PREF)).toEqual({ format: 'jpeg', dpi: 300, withComments: false, pages: 'all' });
    expect(useExportDialog.getState().form).toEqual({
      format: 'jpeg',
      dpi: 300,
      withComments: false,
      pages: 'all',
      range: '',
    });
  });
});
