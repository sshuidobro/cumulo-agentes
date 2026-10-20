import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createStorageStore, memorySource, platformError, type Platform } from '@suite/platform';
import { err, ok } from '@suite/shared';
import type { LoadedPdf } from '../../src/engine';
import { exportXfdf, importXfdf } from '../../src/core/xfdf/xfdf';
import type { Annotation } from '../../src/core/annotations/model';
import {
  addAnnotation,
  endAnnotationSession,
  getEffective,
  startAnnotationSession,
  undo,
} from '../../src/state/annotation-actions';
import { initialAnnotationState, useAnnotations } from '../../src/state/annotation-store';
import { exportComments, importComments, MAX_XFDF_BYTES, XFDF_FILTERS } from '../../src/state/xfdf-actions';
import { initServices } from '../../src/state/services';
import { initialViewerState, useViewer } from '../../src/state/viewer-store';
import { commentsMsg } from '../../src/ui/messages-comments';
import { createFakePlatform, openedFile } from '../helpers/fake-platform';
import { newAnnotation } from './annotations/factories';

/** Más de 20 000 páginas: el escaneo es perezoso y no toca las páginas, así que el test es determinista. */
const PAGE_COUNT = 25_000;

const setTitle = vi.fn();

function fakeLoaded(): LoadedPdf {
  const doc = { numPages: PAGE_COUNT, fingerprints: ['0a1b2c', '3d4e5f'] };
  return { doc, numPages: PAGE_COUNT } as unknown as LoadedPdf;
}

/** Anotación nueva con id `suite-…` (válido para XFDF) en la página indicada. */
function comment(id: string, type: Annotation['type'], pageIndex = 0): Annotation {
  return newAnnotation(`suite-${id}`, type, pageIndex);
}

/** XFDF con `list`, tal como lo escribe la app. */
function xfdfOf(list: readonly Annotation[]): Uint8Array {
  const xml = exportXfdf(new Map(list.map((a) => [a.id, a])), { fileName: 'informe.pdf', ids: null });
  return new TextEncoder().encode(xml);
}

function lastNotice(): string | undefined {
  return useViewer.getState().notice?.text;
}

function setUpPlatform(overrides: Partial<Platform>): Platform {
  const platform = createFakePlatform({ setTitle, prefs: createStorageStore(null, 'test.'), ...overrides });
  initServices({ platform, assetBaseUrl: '' });
  return platform;
}

beforeEach(() => {
  setTitle.mockClear();
  setUpPlatform({});
  useViewer.setState({
    ...initialViewerState,
    status: 'ready',
    file: openedFile('informe.pdf', memorySource(new Uint8Array([0x25]))),
    pdf: fakeLoaded(),
  });
  useAnnotations.setState(initialAnnotationState());
  startAnnotationSession(fakeLoaded(), new AbortController().signal);
});

afterEach(() => {
  endAnnotationSession();
  useViewer.setState(initialViewerState);
  useAnnotations.setState(initialAnnotationState());
});

describe('exportComments', () => {
  it('exporta las anotaciones sin guardar como informe.xfdf, y el XML las vuelve a leer', async () => {
    const platform = setUpPlatform({});
    addAnnotation(comment('a1', 'highlight'));
    addAnnotation(comment('b2', 'note', 1));

    const result = await exportComments();

    expect(result).toBe('saved');
    expect(platform.exportFile).toHaveBeenCalledTimes(1);
    const [name, filters, bytes] = vi.mocked(platform.exportFile).mock.calls[0] ?? [];
    expect(name).toBe('informe.xfdf');
    expect(filters).toEqual(XFDF_FILTERS);
    expect(bytes).toBeInstanceOf(Uint8Array);
    const xml = new TextDecoder('utf-8').decode(bytes);
    expect(xml).toContain('<f href="informe.pdf"/>');
    const back = importXfdf(xml, { existingIds: new Set(), pageCount: PAGE_COUNT, newId: () => 'suite-nuevo', now: '2026-10-17T12:00:00.000Z', author: 'Ana' });
    expect(back.ok && back.value.annotations.length).toBe(2);
    expect(lastNotice()).toBe(commentsMsg.exported);
  });

  it('sin anotaciones editables no abre el diálogo y devuelve nothing', async () => {
    const platform = setUpPlatform({});

    expect(await exportComments()).toBe('nothing');
    expect(platform.exportFile).not.toHaveBeenCalled();
  });

  it('devuelve cancelled si el usuario cancela, sin aviso', async () => {
    setUpPlatform({ exportFile: vi.fn(async () => ok('cancelled' as const)) });
    addAnnotation(comment('a1', 'highlight'));

    expect(await exportComments()).toBe('cancelled');
    expect(lastNotice()).toBeUndefined();
  });

  it('un error de plataforma muestra su mensaje y devuelve failed', async () => {
    setUpPlatform({ exportFile: vi.fn(async () => err(platformError('io'))) });
    addAnnotation(comment('a1', 'highlight'));

    expect(await exportComments()).toBe('failed');
    expect(lastNotice()).toBe(platformError('io').message);
  });
});

describe('importComments', () => {
  const three = [comment('c1', 'highlight'), comment('c2', 'ink', 1), comment('c3', 'square', 2)];

  it('importa 3 comentarios con una sola entrada de deshacer, y deshacer las quita todas', async () => {
    setUpPlatform({ importFile: vi.fn(async () => ok({ name: 'c.xfdf', bytes: xfdfOf(three) })) });
    const depth = useAnnotations.getState().undo.undoDepth;

    expect(await importComments()).toBe('imported');

    expect(getEffective().size).toBe(3);
    expect(useAnnotations.getState().undo.undoDepth).toBe(depth + 1);
    expect(lastNotice()).toBe(commentsMsg.imported(3, 0, 0));
    expect(lastNotice()).toBe('Se han importado 3 comentarios.');

    undo();
    expect(getEffective().size).toBe(0);
  });

  it('importar el mismo XFDF otra vez no añade nada y avisa de los 3 ya existentes', async () => {
    setUpPlatform({ importFile: vi.fn(async () => ok({ name: 'c.xfdf', bytes: xfdfOf(three) })) });
    await importComments();
    const before = getEffective().size;
    const depth = useAnnotations.getState().undo.undoDepth;

    expect(await importComments()).toBe('imported');

    expect(getEffective().size).toBe(before);
    expect(useAnnotations.getState().undo.undoDepth).toBe(depth);
    expect(lastNotice()).toBe('Se han importado 0 comentarios. 3 ya estaban en el documento.');
  });

  it('cancelar el diálogo no cambia nada', async () => {
    setUpPlatform({ importFile: vi.fn(async () => ok(null)) });

    expect(await importComments()).toBe('cancelled');
    expect(getEffective().size).toBe(0);
  });

  it('un XFDF con <!DOCTYPE avisa y no cambia nada', async () => {
    const xml = '<?xml version="1.0"?><!DOCTYPE xfdf [<!ENTITY x "y">]><xfdf><annots/></xfdf>';
    setUpPlatform({ importFile: vi.fn(async () => ok({ name: 'mal.xfdf', bytes: new TextEncoder().encode(xml) })) });

    expect(await importComments()).toBe('failed');
    expect(lastNotice()).toBe('El fichero de comentarios no es un XFDF válido.');
    expect(getEffective().size).toBe(0);
  });

  it('un fichero mayor que el máximo avisa del tamaño', async () => {
    const importFile = vi.fn(async () => err(platformError('out-of-range')));
    setUpPlatform({ importFile });

    expect(await importComments()).toBe('failed');
    expect(importFile).toHaveBeenCalledWith(XFDF_FILTERS, MAX_XFDF_BYTES);
    expect(lastNotice()).toBe('El fichero de comentarios es demasiado grande (máximo 20 MB).');
    expect(getEffective().size).toBe(0);
  });
});
