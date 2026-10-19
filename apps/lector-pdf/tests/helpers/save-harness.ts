import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, vi, beforeEach, afterEach, type Mock } from 'vitest';
import {
  createStorageStore,
  memorySource,
  platformError,
  type ByteSource,
  type ExportOutcome,
  type OpenedFile,
  type Platform,
  type SaveData,
} from '@suite/platform';
import { err, ok, type Result } from '@suite/shared';
import { openDocument, closeDocument } from '../../src/state/document-actions';
import { initServices } from '../../src/state/services';
import { useAnnotations, initialAnnotationState } from '../../src/state/annotation-store';
import { initialViewerState, useViewer } from '../../src/state/viewer-store';
import { useChoice } from '../../src/state/choice';
import { endAnnotationSession } from '../../src/state/annotation-actions';
import { FIXTURES_DIR } from '../fixtures/paths';
import { nodeAssetBase } from './pdfjs-node';
import { openedFile } from './fake-platform';

export const FIXTURE = 'basic-5.pdf';
/** Título de la ventana con el documento de prueba limpio. */
export const CLEAN_TITLE = 'basic-5.pdf — Lector PDF';
export const DIRTY_TITLE = `• ${CLEAN_TITLE}`;

const OPEN_TIMEOUT = 30_000;

export function fixtureBytes(name: string): Uint8Array {
  return new Uint8Array(readFileSync(join(FIXTURES_DIR, name)));
}

export function concat(a: Uint8Array, b: Uint8Array): Uint8Array {
  const out = new Uint8Array(a.length + b.length);
  out.set(a, 0);
  out.set(b, a.length);
  return out;
}

/** Fuente cuyo contenido se puede cambiar después de abrir el documento (simula un fichero modificado o dañado). */
export function replaceableSource(initial: Uint8Array): { readonly source: ByteSource; replace(data: Uint8Array): void } {
  let current = memorySource(initial);
  return {
    source: {
      get size() { return current.size; },
      read: (begin, end) => current.read(begin, end),
    },
    replace(data) {
      current = memorySource(data);
    },
  };
}

export interface SaveHarness {
  readonly original: Uint8Array;
  readonly platform: Platform;
  readonly save: Mock;
  readonly saveAs: Mock;
  readonly closeFile: Mock;
  readonly closeWindow: Mock;
  readonly setTitle: Mock;
  readonly onCloseRequested: Mock;
}

/**
 * Prepara la app con una plataforma falsa en memoria (guardar en sitio anexa el delta al original) y
 * limpia el estado del documento al terminar cada prueba. Llamar una vez por fichero de pruebas.
 */
export function setupSaveHarness(): SaveHarness {
  const original = fixtureBytes(FIXTURE);
  const save = vi.fn(async (target: OpenedFile, data: SaveData): Promise<Result<OpenedFile>> => {
    if (data.kind !== 'append') return err(platformError('unsupported'));
    const reopened = openedFile(target.name, memorySource(concat(original, data.delta)));
    return ok({ ...reopened, canSaveInPlace: target.canSaveInPlace });
  });
  const saveAs = vi.fn(async () => ok({ kind: 'cancelled' as const }));
  const closeFile = vi.fn(async () => undefined);
  const closeWindow = vi.fn(async () => undefined);
  const setTitle = vi.fn();
  const onCloseRequested = vi.fn(() => () => undefined);
  const platform: Platform = {
    kind: 'web',
    isMac: false,
    prefs: createStorageStore(null, 'test.'),
    openFile: vi.fn(async () => ok(null)),
    openBrowserFile: vi.fn(() => err(platformError('unsupported'))),
    openDropped: vi.fn(async () => ok(null)),
    save,
    saveAs,
    closeFile,
    exportFile: vi.fn(async () => ok<ExportOutcome>('saved')),
    importFile: vi.fn(async () => ok(null)),
    onFileOpenedFromOS: () => () => undefined,
    openExternalUrl: vi.fn(async () => err(platformError('unsupported'))),
    setTitle,
    onCloseRequested,
    closeWindow,
    print: vi.fn(async () => ok(undefined)),
    recentFiles: vi.fn(async () => []),
    openRecent: vi.fn(async () => err(platformError('unsupported'))),
    removeRecent: vi.fn(async () => undefined),
    clearRecents: vi.fn(async () => undefined),
    setFullscreen: vi.fn(async () => ok(undefined)),
    isFullscreen: () => false,
    onFullscreenChange: () => () => undefined,
  };
  const harness: SaveHarness = { original, platform, save, saveAs, closeFile, closeWindow, setTitle, onCloseRequested };

  beforeEach(() => {
    initServices({ platform, assetBaseUrl: nodeAssetBase() });
    save.mockClear();
    saveAs.mockClear();
    closeFile.mockClear();
    closeWindow.mockClear();
    setTitle.mockClear();
    onCloseRequested.mockClear();
    useChoice.setState({ active: null });
  });

  afterEach(async () => {
    endAnnotationSession();
    await closeDocument();
    useViewer.setState(initialViewerState);
    useAnnotations.setState(initialAnnotationState());
    useChoice.setState({ active: null });
  });

  return harness;
}

/** Abre un documento (por defecto basic-5.pdf que se puede guardar en sitio) y espera a que las anotaciones estén importadas. */
export async function openFixture(source: ByteSource = memorySource(fixtureBytes(FIXTURE)), name = FIXTURE, canSaveInPlace = true): Promise<OpenedFile> {
  const file: OpenedFile = { ...openedFile(name, source), canSaveInPlace };
  await openDocument(file);
  await vi.waitFor(
    () => {
      expect(useViewer.getState().status).toBe('ready');
    },
    { timeout: OPEN_TIMEOUT },
  );
  await waitForScan();
  return file;
}

export async function waitForScan(): Promise<void> {
  await vi.waitFor(
    () => {
      expect(useAnnotations.getState().scan).toBe('done');
    },
    { timeout: OPEN_TIMEOUT },
  );
}

/**
 * Responde al diálogo de elección activo pulsando la opción con esa etiqueta. Devuelve el título del diálogo.
 * Así se prueba el flujo completo sin DOM (el pintado del diálogo se prueba aparte en tests/ui).
 */
export async function answerChoice(label: string): Promise<string> {
  await vi.waitFor(
    () => {
      expect(useChoice.getState().active).not.toBeNull();
    },
    { timeout: OPEN_TIMEOUT },
  );
  const active = useChoice.getState().active;
  const option = active?.options.find((o) => o.label === label);
  if (active === null || active === undefined || option === undefined) {
    throw new Error(`No hay una opción «${label}» en el diálogo activo`);
  }
  option.pick();
  return active.title;
}
