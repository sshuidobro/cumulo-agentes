import { vi } from 'vitest';
import { platformError, type ByteSource, type OpenedFile, type Platform } from '@suite/platform';
import { err, ok } from '@suite/shared';

/** Fichero abierto de prueba sobre una fuente cualquiera. */
export function openedFile(name: string, source: ByteSource): OpenedFile {
  return {
    token: `test-${name}`,
    name,
    path: null,
    size: source.size,
    lastModified: null,
    canSaveInPlace: false,
    source,
  };
}

/**
 * Platform de prueba: todo se puede sustituir con `overrides`. Lo que no se sustituye
 * responde como una plataforma sin esa capacidad.
 */
export function createFakePlatform(overrides: Partial<Platform> = {}): Platform {
  return {
    kind: 'web',
    isMac: false,
    prefs: { get: () => null, set: () => undefined, remove: () => undefined },
    openFile: vi.fn(async () => ok(null)),
    openBrowserFile: vi.fn(() => err(platformError('unsupported'))),
    openDropped: vi.fn(async () => ok(null)),
    save: vi.fn(async () => err(platformError('unsupported'))),
    saveAs: vi.fn(async () => err(platformError('unsupported'))),
    closeFile: vi.fn(async () => undefined),
    onFileOpenedFromOS: () => () => undefined,
    openExternalUrl: vi.fn(async () => err(platformError('unsupported'))),
    setTitle: vi.fn(),
    onCloseRequested: () => () => undefined,
    closeWindow: vi.fn(async () => undefined),
    print: vi.fn(async () => ok(undefined)),
    ...overrides,
  };
}
