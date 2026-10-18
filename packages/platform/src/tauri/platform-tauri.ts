import { createLogger, err, ok, type Result } from '@suite/shared';
import { PlatformIoError, platformError } from '../errors';
import { createStorageStore } from '../prefs';
import type {
  ByteSource, FileFilter, OpenedFile, Platform, PlatformErrorCode, RecentFile, SaveData, SaveOutcome,
} from '../types';
import type { TauriApi } from './tauri-api';
import { realTauriApi } from './tauri-api';

const log = createLogger('platform');

/** Evento que emite Rust cuando llegan ficheros desde el sistema (COM-009). */
const OS_OPEN_EVENT = 'suite://file-opened';

/** Forma de un fichero registrado en Rust (serialización camelCase de `FileInfoDto`). */
interface FileInfoDto {
  token: string;
  name: string;
  path: string;
  size: number;
  lastModified: number | null;
}

/** Forma de un reciente en Rust (serialización camelCase de `RecentDto`, COM-016). */
interface RecentDto {
  id: string;
  name: string;
  path: string;
  size: number | null;
  openedAt: number;
  available: boolean;
}

const PLATFORM_ERROR_CODES: ReadonlySet<string> = new Set<PlatformErrorCode>([
  'not-found', 'permission-denied', 'io', 'changed-on-disk',
  'save-in-place-unsupported', 'unsupported', 'out-of-range',
]);

const SAFE_PROTOCOLS: ReadonlySet<string> = new Set(['http:', 'https:', 'mailto:']);

/** Código de un rechazo de `invoke`: `{ code, message }` (serialización de `CommandError`). */
function errorCode(cause: unknown): string | undefined {
  if (typeof cause !== 'object' || cause === null || !('code' in cause)) return undefined;
  return typeof cause.code === 'string' ? cause.code : undefined;
}

/** Códigos de `PlatformErrorCode` se respetan; `unknown-token` es un fichero que ya no está registrado. */
function mapCode(code: string | undefined): PlatformErrorCode {
  if (code !== undefined && PLATFORM_ERROR_CODES.has(code)) return code as PlatformErrorCode;
  if (code === 'unknown-token' || code === 'unknown-recent') return 'not-found';
  return 'io';
}

function checkRange(begin: number, end: number, size: number): void {
  const valid = Number.isInteger(begin) && Number.isInteger(end)
    && 0 <= begin && begin <= end && end <= size;
  if (!valid) throw new PlatformIoError('out-of-range');
}

/** Fuente de bytes que lee por rangos con `suite_read_range` (el original nunca se carga entero). */
function tauriSource(api: TauriApi, token: string, size: number): ByteSource {
  return {
    size,
    async read(begin, end) {
      checkRange(begin, end, size);
      if (begin === end) return new Uint8Array(0);
      try {
        const buffer = await api.invoke<ArrayBuffer>('suite_read_range', {
          token,
          offset: begin,
          length: end - begin,
        });
        return new Uint8Array(buffer);
      } catch (cause) {
        throw new PlatformIoError(mapCode(errorCode(cause)), { cause });
      }
    },
  };
}

function toRecent(dto: RecentDto): RecentFile {
  return {
    id: dto.id,
    name: dto.name,
    path: dto.path,
    size: dto.size,
    openedAt: dto.openedAt,
    available: dto.available,
  };
}

function toOpened(api: TauriApi, dto: FileInfoDto): OpenedFile {
  return {
    token: dto.token,
    name: dto.name,
    path: dto.path,
    size: dto.size,
    lastModified: dto.lastModified,
    canSaveInPlace: true,
    source: tauriSource(api, dto.token, dto.size),
  };
}

/** Suscribe de forma síncrona aunque el registro (`listen`, `onCloseRequested`) sea asíncrono. */
function subscribe(start: Promise<() => void>, what: string): () => void {
  let active = true;
  let stop: (() => void) | null = null;
  start.then(
    (unlisten) => {
      if (active) stop = unlisten;
      else unlisten();
    },
    (cause: unknown) => { log.warn(`No se ha podido suscribir a ${what}.`, cause); },
  );
  return () => {
    if (!active) return;
    active = false;
    stop?.();
    stop = null;
  };
}

function safeLocalStorage(): Storage | null {
  try {
    return globalThis.localStorage;
  } catch {
    return null;
  }
}

/** Platform de escritorio: los diálogos, rutas y E/S viven en Rust; JS solo maneja tokens. */
export function createTauriPlatform(
  options: { readonly prefsPrefix: string },
  api: TauriApi = realTauriApi(),
): Platform {
  const save = async (target: OpenedFile, data: SaveData): Promise<Result<OpenedFile>> => {
    try {
      const dto = data.kind === 'bytes'
        ? await api.invoke<FileInfoDto>('suite_write_atomic', data.bytes, {
          headers: { 'x-suite-token': target.token },
        })
        : await api.invoke<FileInfoDto>('suite_append_atomic', data.delta, {
          headers: {
            'x-suite-token': target.token,
            'x-suite-base-token': data.base.token,
            'x-suite-expected-size': String(data.expectedSize),
          },
        });
      return ok(toOpened(api, dto));
    } catch (cause) {
      return err(platformError(mapCode(errorCode(cause)), cause));
    }
  };

  return {
    kind: 'tauri',
    isMac: navigator.userAgent.includes('Mac'),
    prefs: createStorageStore(safeLocalStorage(), options.prefsPrefix),

    async openFile(filters: readonly FileFilter[]): Promise<Result<OpenedFile | null>> {
      try {
        const dto = await api.invoke<FileInfoDto | null>('suite_open_dialog', { filters });
        return ok(dto === null ? null : toOpened(api, dto));
      } catch (cause) {
        return err(platformError(mapCode(errorCode(cause)), cause));
      }
    },

    openBrowserFile() {
      return err(platformError('unsupported'));
    },

    openDropped() {
      // En Tauri los ficheros soltados llegan por onFileOpenedFromOS.
      return Promise.resolve(ok(null));
    },

    save,

    async saveAs(suggestedName: string, filters: readonly FileFilter[], data: SaveData): Promise<Result<SaveOutcome>> {
      let dto: FileInfoDto | null;
      try {
        dto = await api.invoke<FileInfoDto | null>('suite_save_dialog', { suggestedName, filters });
      } catch (cause) {
        return err(platformError(mapCode(errorCode(cause)), cause));
      }
      if (dto === null) return ok({ kind: 'cancelled' });
      const saved = await save(toOpened(api, dto), data);
      if (!saved.ok) return saved;
      return ok({ kind: 'saved', file: saved.value });
    },

    async closeFile(file: OpenedFile): Promise<void> {
      await api.invoke<boolean>('suite_close', { token: file.token });
    },

    onFileOpenedFromOS(cb: (file: OpenedFile) => void): () => void {
      let subscribed = true;
      const drain = async (): Promise<void> => {
        if (!subscribed) return;
        try {
          const pending = await api.invoke<FileInfoDto[]>('suite_take_pending_opens');
          for (const dto of pending) {
            if (!subscribed) return;
            cb(toOpened(api, dto));
          }
        } catch (cause) {
          log.warn('No se han podido recoger los ficheros abiertos desde el sistema.', cause);
        }
      };
      const stop = subscribe(api.listen(OS_OPEN_EVENT, () => { void drain(); }), 'ficheros abiertos desde el sistema');
      void drain();
      return () => {
        subscribed = false;
        stop();
      };
    },

    async openExternalUrl(url: string): Promise<Result<void>> {
      let protocol: string;
      try {
        protocol = new URL(url).protocol;
      } catch {
        return err(platformError('unsupported'));
      }
      if (!SAFE_PROTOCOLS.has(protocol)) return err(platformError('unsupported'));
      try {
        await api.openUrl(url);
        return ok(undefined);
      } catch (cause) {
        return err(platformError('io', cause));
      }
    },

    setTitle(title: string): void {
      api.setTitle(title).catch((cause: unknown) => { log.warn('No se ha podido cambiar el título de la ventana.', cause); });
    },

    onCloseRequested(cb: () => boolean): () => void {
      return subscribe(api.onCloseRequested((preventDefault) => {
        if (!cb()) preventDefault();
      }), 'el cierre de la ventana');
    },

    async closeWindow(): Promise<void> {
      try {
        await api.destroyWindow();
      } catch (cause) {
        log.error('No se ha podido cerrar la ventana.', cause);
      }
    },

    async print(): Promise<Result<void>> {
      try {
        await api.invoke<unknown>('suite_print');
        return ok(undefined);
      } catch (cause) {
        return err(platformError('io', cause));
      }
    },

    async recentFiles(): Promise<readonly RecentFile[]> {
      try {
        const dtos = await api.invoke<RecentDto[]>('suite_recent_list');
        return dtos.map(toRecent);
      } catch (cause) {
        log.warn('No se han podido leer los documentos recientes.', cause);
        return [];
      }
    },

    async openRecent(id: string): Promise<Result<OpenedFile | null>> {
      try {
        const dto = await api.invoke<FileInfoDto>('suite_recent_open', { id });
        return ok(toOpened(api, dto));
      } catch (cause) {
        return err(platformError(mapCode(errorCode(cause)), cause));
      }
    },

    async removeRecent(id: string): Promise<void> {
      try {
        await api.invoke<unknown>('suite_recent_remove', { id });
      } catch (cause) {
        log.warn('No se ha podido quitar el documento de recientes.', cause);
      }
    },

    async clearRecents(): Promise<void> {
      try {
        await api.invoke<unknown>('suite_recent_clear');
      } catch (cause) {
        log.warn('No se han podido vaciar los documentos recientes.', cause);
      }
    },
  };
}
