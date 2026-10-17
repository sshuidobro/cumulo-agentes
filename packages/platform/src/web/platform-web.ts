import { createLogger, err, ok } from '@suite/shared';
import type { AppError, Result } from '@suite/shared';
import { blobSource } from '../byte-source';
import { platformError } from '../errors';
import { createStorageStore } from '../prefs';
import type { FileFilter, OpenedFile, Platform } from '../types';
import type { DataTransferItemFsAccess, PermissionHandle } from './fs-access';
import { toAcceptAttribute, toAcceptTypes } from './mime';
import { defaultWebEnv } from './web-env';
import type { WebEnv } from './web-env';

const log = createLogger('platform-web');

const SAFE_URL_PROTOCOLS: ReadonlySet<string> = new Set(['http:', 'https:', 'mailto:']);

interface RegisteredFile {
  readonly file: File;
  readonly handle: PermissionHandle | null;
}

/** Lee `name` de un error de forma segura (DOMException u otro objeto con name). */
function errorName(cause: unknown): string | undefined {
  if (typeof cause !== 'object' || cause === null || !('name' in cause)) return undefined;
  return typeof cause.name === 'string' ? cause.name : undefined;
}

function isFileHandle(handle: FileSystemHandle): handle is FileSystemFileHandle {
  return handle.kind === 'file';
}

function failure(cause: unknown): Result<never, AppError> {
  const name = errorName(cause);
  if (name === 'NotAllowedError' || name === 'SecurityError') {
    return err(platformError('permission-denied', cause));
  }
  return err(platformError('io', cause));
}

/** Plataforma para navegador: File System Access si existe, `<input type=file>` si no. */
export function createWebPlatform(
  options: { readonly prefsPrefix: string },
  env: WebEnv = defaultWebEnv(),
): Platform {
  const registry = new Map<string, RegisteredFile>();
  let counter = 0;

  const toOpened = (file: File, handle: PermissionHandle | null): OpenedFile => {
    counter += 1;
    const token = `w${counter}`;
    registry.set(token, { file, handle });
    return {
      token,
      name: file.name,
      path: null,
      size: file.size,
      lastModified: file.lastModified,
      canSaveInPlace: handle !== null,
      source: blobSource(file),
    };
  };

  const openHandle = async (handle: FileSystemFileHandle): Promise<Result<OpenedFile>> => {
    try {
      const file = await handle.getFile();
      return ok(toOpened(file, handle));
    } catch (cause) {
      return failure(cause);
    }
  };

  const openFile = async (filters: readonly FileFilter[]): Promise<Result<OpenedFile | null>> => {
    const picker = env.showOpenFilePicker;
    if (picker === undefined) {
      try {
        const file = await env.pickWithInput(toAcceptAttribute(filters));
        return ok(file === null ? null : toOpened(file, null));
      } catch (cause) {
        return failure(cause);
      }
    }
    let handles: FileSystemFileHandle[];
    try {
      handles = await picker({ types: toAcceptTypes(filters), excludeAcceptAllOption: false, multiple: false });
    } catch (cause) {
      // Cancelar el selector no es un error.
      return errorName(cause) === 'AbortError' ? ok(null) : failure(cause);
    }
    const handle = handles[0];
    if (handle === undefined) return ok(null);
    return openHandle(handle);
  };

  const openDropped = async (dt: DataTransfer): Promise<Result<OpenedFile | null>> => {
    // items y files se leen de forma síncrona: el DataTransfer deja de ser accesible al terminar el evento.
    const item = dt.items[0] as (DataTransferItem & DataTransferItemFsAccess) | undefined;
    const pendingHandle = item?.getAsFileSystemHandle?.() ?? null;
    const firstFile = dt.files[0];
    if (pendingHandle !== null) {
      let handle: FileSystemHandle | null = null;
      try {
        handle = await pendingHandle;
      } catch (cause) {
        log.warn('No se ha podido obtener el handle del fichero soltado; se usa la copia.', cause);
      }
      if (handle !== null && isFileHandle(handle)) return openHandle(handle);
    }
    if (firstFile === undefined) return ok(null);
    return ok(toOpened(firstFile, null));
  };

  const platform: Platform = {
    kind: 'web',
    isMac: /Mac|iPhone|iPad/.test(env.window.navigator.userAgent),
    prefs: createStorageStore(env.storage, options.prefsPrefix),

    openFile,

    openBrowserFile(file: File): Result<OpenedFile> {
      return ok(toOpened(file, null));
    },

    openDropped,

    // Guardar llega en COM-007.
    async save() {
      return err(platformError('unsupported'));
    },

    async saveAs() {
      return err(platformError('unsupported'));
    },

    async closeFile(file: OpenedFile): Promise<void> {
      registry.delete(file.token);
    },

    // Web: no hay eventos del sistema operativo que abran ficheros.
    onFileOpenedFromOS(): () => void {
      return () => undefined;
    },

    async openExternalUrl(url: string): Promise<Result<void>> {
      let protocol: string;
      try {
        protocol = new URL(url).protocol;
      } catch {
        return err(platformError('unsupported'));
      }
      if (!SAFE_URL_PROTOCOLS.has(protocol)) return err(platformError('unsupported'));
      env.window.open(url, '_blank', 'noopener,noreferrer');
      return ok(undefined);
    },

    setTitle(title: string): void {
      env.window.document.title = title;
    },

    onCloseRequested(cb: () => boolean): () => void {
      const listener = (event: Event): void => {
        if (cb() === false) event.preventDefault();
      };
      env.window.addEventListener('beforeunload', listener);
      return () => { env.window.removeEventListener('beforeunload', listener); };
    },
  };
  return platform;
}
