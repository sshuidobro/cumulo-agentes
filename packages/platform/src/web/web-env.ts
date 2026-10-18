import type { ShowOpenFilePicker, ShowSaveFilePicker } from './fs-access';

/** Dependencias del navegador, inyectadas para poder probar la plataforma web en jsdom. */
export interface WebEnv {
  readonly window: Window;
  readonly storage: Storage | null;
  /** IndexedDB para los recientes (handles); `null` = sin persistencia, solo memoria. */
  readonly indexedDB: IDBFactory | null;
  readonly showOpenFilePicker: ShowOpenFilePicker | undefined;
  readonly showSaveFilePicker: ShowSaveFilePicker | undefined;
  /** Crea un <input type=file accept=...>, hace click y resuelve con el fichero o null si llega el evento 'cancel'. */
  readonly pickWithInput: (accept: string) => Promise<File | null>;
  /** Descarga un Blob con un <a download> y URL.createObjectURL (revoca la URL a los 10 s). */
  readonly download: (blob: Blob, name: string) => void;
  /** Cierra la pestaña o ventana. Por defecto `window.close()`; el navegador puede ignorarlo si no la abrió un script. */
  readonly closeWindow: () => void;
  /** Abre el diálogo de impresión del navegador (`window.print()`). */
  readonly print: () => void;
}

/** File System Access: solo Chromium lo expone en `window`; lib.dom no lo tipa. */
interface FsAccessGlobals {
  readonly showOpenFilePicker?: ShowOpenFilePicker;
  readonly showSaveFilePicker?: ShowSaveFilePicker;
}

const DOWNLOAD_REVOKE_DELAY_MS = 10_000;

function readStorage(win: Window): Storage | null {
  try {
    return win.localStorage;
  } catch {
    // Con cookies bloqueadas, acceder a localStorage lanza SecurityError.
    return null;
  }
}

function createInputPicker(win: Window): (accept: string) => Promise<File | null> {
  return (accept) => new Promise<File | null>((resolve) => {
    const input = win.document.createElement('input');
    input.type = 'file';
    input.accept = accept;
    input.addEventListener('change', () => { resolve(input.files?.[0] ?? null); }, { once: true });
    input.addEventListener('cancel', () => { resolve(null); }, { once: true });
    input.click();
  });
}

function createDownloader(win: Window): (blob: Blob, name: string) => void {
  return (blob, name) => {
    const url = URL.createObjectURL(blob);
    const link = win.document.createElement('a');
    link.href = url;
    link.download = name;
    win.document.body.append(link);
    link.click();
    link.remove();
    win.setTimeout(() => { URL.revokeObjectURL(url); }, DOWNLOAD_REVOKE_DELAY_MS);
  };
}

/** Entorno real del navegador. Debe llamarse solo en el hilo principal de una página. */
export function defaultWebEnv(): WebEnv {
  const win = window as Window & FsAccessGlobals;
  return {
    window: win,
    storage: readStorage(win),
    indexedDB: globalThis.indexedDB ?? null,
    // Se enlazan a window: los métodos de File System Access fallan si se invocan con otro `this`.
    showOpenFilePicker: win.showOpenFilePicker?.bind(win),
    showSaveFilePicker: win.showSaveFilePicker?.bind(win),
    pickWithInput: createInputPicker(win),
    download: createDownloader(win),
    closeWindow: () => { win.close(); },
    print: () => { win.print(); },
  };
}
