import { createLogger, err, ok } from '@suite/shared';
import type { AppError, Result } from '@suite/shared';
import { blobSource } from '../byte-source';
import { platformError } from '../errors';
import { createStorageStore } from '../prefs';
import type { FileFilter, OpenedFile, Platform, SaveData, SaveOutcome } from '../types';
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

/** Sin `queryPermission` no hay forma de comprobarlo: se intenta escribir y la escritura falla si no hay permiso. */
async function hasWritePermission(handle: PermissionHandle): Promise<boolean> {
  if (handle.queryPermission === undefined) return true;
  if ((await handle.queryPermission({ mode: 'readwrite' })) === 'granted') return true;
  if (handle.requestPermission === undefined) return false;
  return (await handle.requestPermission({ mode: 'readwrite' })) === 'granted';
}

type AppendData = Extract<SaveData, { readonly kind: 'append' }>;

/** Plataforma para navegador: File System Access si existe, `<input type=file>` si no. */
export function createWebPlatform(
  options: { readonly prefsPrefix: string },
  env: WebEnv = defaultWebEnv(),
): Platform {
  const registry = new Map<string, RegisteredFile>();
  let counter = 0;
  /** Tras `closeWindow` el aviso de `beforeunload` ya no se cancela. */
  let closing = false;

  const describeFile = (token: string, file: File, handle: PermissionHandle | null): OpenedFile => ({
    token,
    name: file.name,
    path: null,
    size: file.size,
    lastModified: file.lastModified,
    canSaveInPlace: handle !== null,
    source: blobSource(file),
  });

  const toOpened = (file: File, handle: PermissionHandle | null): OpenedFile => {
    counter += 1;
    const token = `w${counter}`;
    registry.set(token, { file, handle });
    return describeFile(token, file, handle);
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
    const pendingHandle = item?.getAsFileSystemHandle?.();
    const firstFile = dt.files[0];
    // Chromium puede devolver `undefined` (no `null`) con DataTransfer sintéticos o arrastres que no son ficheros del disco.
    if (pendingHandle !== undefined) {
      let handle: FileSystemHandle | null | undefined = null;
      try {
        handle = await pendingHandle;
      } catch (cause) {
        log.warn('No se ha podido obtener el handle del fichero soltado; se usa la copia.', cause);
      }
      if (handle !== null && handle !== undefined && isFileHandle(handle)) return openHandle(handle);
    }
    if (firstFile === undefined) return ok(null);
    return ok(toOpened(firstFile, null));
  };

  /** Fichero registrado para el incremento de un `append`; comprueba que siga con el tamaño esperado. */
  const appendBase = (data: AppendData): Result<File> => {
    const entry = registry.get(data.base.token);
    if (entry === undefined) return err(platformError('not-found'));
    if (entry.file.size !== data.expectedSize) return err(platformError('changed-on-disk'));
    return ok(entry.file);
  };

  /**
   * Trozos que forman el contenido final. El original de un `append` va como `File` (Blob), no como bytes:
   * el navegador lo copia por trozos sin cargarlo en memoria. `slice()` copia el delta con ArrayBuffer propio.
   */
  const contentParts = (data: SaveData): Result<(Blob | Uint8Array<ArrayBuffer>)[]> => {
    if (data.kind === 'bytes') return ok([data.bytes.slice()]);
    const base = appendBase(data);
    if (!base.ok) return base;
    return ok([base.value, data.delta.slice()]);
  };

  /** Escribe `data` en `handle` de forma atómica (`createWritable` confirma al cerrar). */
  const writeTo = async (handle: PermissionHandle, data: SaveData): Promise<Result<File>> => {
    if (!(await hasWritePermission(handle))) return err(platformError('permission-denied'));
    const parts = contentParts(data);
    if (!parts.ok) return parts;

    let writable: FileSystemWritableFileStream;
    try {
      writable = await handle.createWritable({ keepExistingData: false });
    } catch (cause) {
      return failure(cause);
    }
    try {
      for (const part of parts.value) await writable.write(part);
      await writable.close();
    } catch (cause) {
      await writable.abort().catch(() => undefined);
      return err(platformError('io', cause));
    }
    try {
      return ok(await handle.getFile());
    } catch (cause) {
      return failure(cause);
    }
  };

  const sizeOnDisk = async (handle: FileSystemFileHandle): Promise<Result<number>> => {
    try {
      return ok((await handle.getFile()).size);
    } catch (cause) {
      return failure(cause);
    }
  };

  const save = async (target: OpenedFile, data: SaveData): Promise<Result<OpenedFile>> => {
    const entry = registry.get(target.token);
    if (entry === undefined) return err(platformError('not-found'));
    const { handle } = entry;
    if (handle === null) return err(platformError('save-in-place-unsupported'));
    if (data.kind === 'append' && data.base.token === target.token) {
      const size = await sizeOnDisk(handle);
      if (!size.ok) return size;
      if (size.value !== data.expectedSize) return err(platformError('changed-on-disk'));
    }
    const written = await writeTo(handle, data);
    if (!written.ok) return written;
    registry.set(target.token, { file: written.value, handle });
    return ok(describeFile(target.token, written.value, handle));
  };

  const saveAs = async (name: string, filters: readonly FileFilter[], data: SaveData): Promise<Result<SaveOutcome>> => {
    const picker = env.showSaveFilePicker;
    if (picker === undefined) {
      // Sin File System Access el resultado es una descarga: bytes completos o original + incremento.
      const parts = contentParts(data);
      if (!parts.ok) return parts;
      env.download(new Blob(parts.value), name);
      return ok({ kind: 'downloaded', name });
    }
    let handle: FileSystemFileHandle;
    try {
      handle = await picker({ suggestedName: name, types: toAcceptTypes(filters) });
    } catch (cause) {
      // Cancelar el diálogo no es un error.
      return errorName(cause) === 'AbortError' ? ok({ kind: 'cancelled' }) : failure(cause);
    }
    const written = await writeTo(handle, data);
    if (!written.ok) return written;
    return ok({ kind: 'saved', file: toOpened(written.value, handle) });
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

    save,

    saveAs,

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
        if (closing) return;
        if (cb() === false) event.preventDefault();
      };
      env.window.addEventListener('beforeunload', listener);
      return () => { env.window.removeEventListener('beforeunload', listener); };
    },

    async closeWindow(): Promise<void> {
      closing = true;
      env.closeWindow();
    },

    async print(): Promise<Result<void>> {
      try {
        env.print();
      } catch (cause) {
        return err(platformError('io', cause));
      }
      return ok(undefined);
    },
  };
  return platform;
}
