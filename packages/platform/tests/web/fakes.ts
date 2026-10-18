import { vi } from 'vitest';
import type { WebEnv } from '../../src/web/web-env';

/** Handle falso de File System Access que devuelve siempre el mismo fichero. */
export function fakeHandle(file: File): FileSystemFileHandle {
  const handle = { kind: 'file', name: file.name, getFile: async () => file };
  return handle as unknown as FileSystemFileHandle;
}

/** Error con `name` de DOMException (AbortError, NotAllowedError...). */
export function namedError(name: string): Error {
  const error = new Error(name);
  error.name = name;
  return error;
}

/** WebEnv con la ventana de jsdom y sin File System Access ni input por defecto. */
export function fakeEnv(overrides: Partial<WebEnv> = {}): WebEnv {
  return {
    window,
    storage: null,
    showOpenFilePicker: undefined,
    showSaveFilePicker: undefined,
    pickWithInput: vi.fn(async (): Promise<File | null> => null),
    download: vi.fn(),
    closeWindow: vi.fn(),
    print: vi.fn(),
    ...overrides,
  };
}
