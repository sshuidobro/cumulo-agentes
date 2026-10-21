import { vi } from 'vitest';
import type { WebEnv } from '../../src/web/web-env';

/** Estado de permisos y ausencia de un handle falso. Se puede cambiar después de crearlo. */
export interface FakeHandleOptions {
  /** Estado que devuelven queryPermission y requestPermission con 'readwrite'. Por defecto 'granted'. */
  readwrite?: PermissionState;
  /** Estado que devuelven queryPermission y requestPermission con 'read'. Por defecto 'granted'. */
  read?: PermissionState;
  /** Si es true, getFile() lanza NotFoundError (el fichero ya no existe). */
  missing?: boolean;
}

/** Fichero de cada handle falso: dos handles son la misma entrada si envuelven el mismo File. */
const fileOfHandle = new WeakMap<object, File>();

/** Handle falso de File System Access que devuelve siempre el mismo fichero. */
export function fakeHandle(file: File, options: FakeHandleOptions = {}): FileSystemFileHandle {
  const permission = async ({ mode }: { readonly mode: 'read' | 'readwrite' }): Promise<PermissionState> =>
    (mode === 'readwrite' ? options.readwrite : options.read) ?? 'granted';
  const handle = {
    kind: 'file',
    name: file.name,
    getFile: async () => {
      if (options.missing === true) throw namedError('NotFoundError');
      return file;
    },
    isSameEntry: async (other: FileSystemHandle) => fileOfHandle.get(other) === file,
    queryPermission: permission,
    requestPermission: permission,
  };
  fileOfHandle.set(handle, file);
  return handle as unknown as FileSystemFileHandle;
}

/** Error con `name` de DOMException (AbortError, NotAllowedError...). */
export function namedError(name: string): Error {
  const error = new Error(name);
  error.name = name;
  return error;
}

/** WebEnv con la ventana de jsdom y sin File System Access, IndexedDB ni input por defecto. */
export function fakeEnv(overrides: Partial<WebEnv> = {}): WebEnv {
  return {
    window,
    storage: null,
    indexedDB: null,
    showOpenFilePicker: undefined,
    showSaveFilePicker: undefined,
    pickWithInput: vi.fn(async (): Promise<File | null> => null),
    pickManyWithInput: vi.fn(async (): Promise<readonly File[] | null> => null),
    download: vi.fn(),
    closeWindow: vi.fn(),
    print: vi.fn(),
    ...overrides,
  };
}
