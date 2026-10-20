import { createLogger, err, ok } from '@suite/shared';
import type { AppError, Result } from '@suite/shared';
import { blobSource } from '../byte-source';
import { platformError } from '../errors';
import { createStorageStore } from '../prefs';
import type { ExportOutcome, FileFilter, ImportedFile, OpenedFile, Platform, RecentFile, SaveData, SaveOutcome } from '../types';
import type { DataTransferItemFsAccess, PermissionHandle } from './fs-access';
import { toAcceptAttribute, toAcceptTypes } from './mime';
import { MAX_RECENTS, createRecentStore, rememberEntry } from './recent-store';
import type { RecentRecord } from './recent-store';
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

/**
 * Pide (si hace falta) el permiso. Sin `queryPermission` no hay forma de comprobarlo: se asume concedido
 * y la operación falla si no lo está.
 */
async function hasPermission(handle: PermissionHandle, mode: 'read' | 'readwrite'): Promise<boolean> {
  if (handle.queryPermission === undefined) return true;
  if ((await handle.queryPermission({ mode })) === 'granted') return true;
  if (handle.requestPermission === undefined) return false;
  return (await handle.requestPermission({ mode })) === 'granted';
}

type AppendData = Extract<SaveData, { readonly kind: 'append' }>;

/** Plataforma para navegador: File System Access si existe, `<input type=file>` si no. */
export function createWebPlatform(
  options: { readonly prefsPrefix: string },
  env: WebEnv = defaultWebEnv(),
): Platform {
  const registry = new Map<string, RegisteredFile>();
  const recents = createRecentStore(options.prefsPrefix, env.indexedDB);
  /** Recientes cuyo fichero ya no se pudo leer. Solo en memoria: el registro guardado no lleva ese campo. */
  const missing = new Set<string>();
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

  /** Añade a recientes; un fallo al guardar no impide abrir el fichero. */
  const remember = async (handle: PermissionHandle, file: File): Promise<void> => {
    try {
      await rememberEntry(recents, handle, { name: file.name, size: file.size }, Date.now());
    } catch (cause) {
      log.warn('No se ha podido añadir el fichero a recientes.', cause);
    }
  };

  const openHandle = async (handle: FileSystemFileHandle): Promise<Result<OpenedFile>> => {
    try {
      const file = await handle.getFile();
      await remember(handle, file);
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
    if (!(await hasPermission(handle, 'readwrite'))) return err(platformError('permission-denied'));
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
    await remember(handle, written.value);
    return ok({ kind: 'saved', file: toOpened(written.value, handle) });
  };

  const exportFile = async (
    name: string,
    filters: readonly FileFilter[],
    bytes: Uint8Array,
  ): Promise<Result<ExportOutcome>> => {
    const picker = env.showSaveFilePicker;
    if (picker === undefined) {
      env.download(new Blob([bytes.slice()]), name);
      return ok('downloaded');
    }
    let handle: FileSystemFileHandle;
    try {
      handle = await picker({ suggestedName: name, types: toAcceptTypes(filters) });
    } catch (cause) {
      return errorName(cause) === 'AbortError' ? ok('cancelled') : failure(cause);
    }
    const written = await writeTo(handle, { kind: 'bytes', bytes });
    return written.ok ? ok('saved') : written;
  };

  const readImported = async (file: File, maxBytes: number): Promise<Result<ImportedFile>> => {
    if (file.size > maxBytes) return err(platformError('out-of-range'));
    try {
      return ok({ name: file.name, bytes: new Uint8Array(await file.arrayBuffer()) });
    } catch (cause) {
      return failure(cause);
    }
  };

  const importFile = async (filters: readonly FileFilter[], maxBytes: number): Promise<Result<ImportedFile | null>> => {
    const picker = env.showOpenFilePicker;
    let file: File | null;
    try {
      if (picker === undefined) {
        file = await env.pickWithInput(toAcceptAttribute(filters));
      } else {
        const handles = await picker({ types: toAcceptTypes(filters), excludeAcceptAllOption: false, multiple: false });
        const handle = handles[0];
        file = handle === undefined ? null : await handle.getFile();
      }
    } catch (cause) {
      return errorName(cause) === 'AbortError' ? ok(null) : failure(cause);
    }
    if (file === null) return ok(null);
    return readImported(file, maxBytes);
  };

  const importFiles = async (
    filters: readonly FileFilter[],
    maxBytesEach: number,
    maxCount: number,
  ): Promise<Result<readonly ImportedFile[] | null>> => {
    const picker = env.showOpenFilePicker;
    let files: readonly File[] | null;
    try {
      if (picker === undefined) {
        files = await env.pickManyWithInput(toAcceptAttribute(filters));
      } else {
        const handles = await picker({ types: toAcceptTypes(filters), excludeAcceptAllOption: false, multiple: true });
        files = await Promise.all(handles.map((handle) => handle.getFile()));
      }
    } catch (cause) {
      // Cancelar el selector no es un error.
      return errorName(cause) === 'AbortError' ? ok(null) : failure(cause);
    }
    if (files === null || files.length === 0) return ok(null);
    // Se comprueban número y tamaños antes de leer ningún contenido.
    if (files.length > maxCount || files.some((file) => file.size > maxBytesEach)) return err(platformError('out-of-range'));
    try {
      const imported = await Promise.all(files.map(async (file): Promise<ImportedFile> => ({
        name: file.name,
        bytes: new Uint8Array(await file.arrayBuffer()),
      })));
      return ok(imported);
    } catch (cause) {
      return failure(cause);
    }
  };

  const toRecentFile = (record: RecentRecord): RecentFile => ({
    id: record.id,
    name: record.name,
    path: null,
    size: record.size,
    openedAt: record.openedAt,
    available: !missing.has(record.id),
  });

  /** Reabre un reciente. Sin permiso de escritura se abre en solo lectura; sin lectura, `ok(null)`. */
  const openRecent = async (id: string): Promise<Result<OpenedFile | null>> => {
    let record: RecentRecord | undefined;
    try {
      record = await recents.get(id);
    } catch (cause) {
      return failure(cause);
    }
    if (record === undefined) return err(platformError('not-found'));
    const { handle } = record;
    const canSaveInPlace = await hasPermission(handle, 'readwrite');
    if (!canSaveInPlace && !(await hasPermission(handle, 'read'))) return ok(null);
    let file: File;
    try {
      file = await handle.getFile();
    } catch (cause) {
      if (errorName(cause) !== 'NotFoundError') return failure(cause);
      missing.add(id);
      return err(platformError('not-found', cause));
    }
    missing.delete(id);
    await remember(handle, file);
    return ok(toOpened(file, canSaveInPlace ? handle : null));
  };

  /** Pantalla completa de la página entera (`documentElement`), sin barra de navegación cuando el navegador lo permite. */
  const setFullscreen = async (on: boolean): Promise<Result<void>> => {
    const { document: doc } = env.window;
    try {
      if (on) {
        if (typeof doc.documentElement.requestFullscreen !== 'function') return err(platformError('unsupported'));
        await doc.documentElement.requestFullscreen({ navigationUI: 'hide' });
      } else {
        if (typeof doc.exitFullscreen !== 'function') return err(platformError('unsupported'));
        await doc.exitFullscreen();
      }
    } catch (cause) {
      return err(platformError('unsupported', cause));
    }
    return ok(undefined);
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

    exportFile,

    importFile,
    importFiles,

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

    async recentFiles(): Promise<readonly RecentFile[]> {
      try {
        return (await recents.list()).slice(0, MAX_RECENTS).map(toRecentFile);
      } catch (cause) {
        log.warn('No se han podido leer los ficheros recientes.', cause);
        return [];
      }
    },

    openRecent,

    async removeRecent(id: string): Promise<void> {
      missing.delete(id);
      try {
        await recents.delete(id);
      } catch (cause) {
        log.warn('No se ha podido quitar el fichero de recientes.', cause);
      }
    },

    async clearRecents(): Promise<void> {
      missing.clear();
      try {
        await recents.clear();
      } catch (cause) {
        log.warn('No se han podido borrar los ficheros recientes.', cause);
      }
    },

    setFullscreen,

    isFullscreen(): boolean {
      return env.window.document.fullscreenElement !== null;
    },

    onFullscreenChange(cb: (on: boolean) => void): () => void {
      const { document: doc } = env.window;
      const listener = (): void => { cb(doc.fullscreenElement !== null); };
      doc.addEventListener('fullscreenchange', listener);
      return () => { doc.removeEventListener('fullscreenchange', listener); };
    },
  };
  return platform;
}
