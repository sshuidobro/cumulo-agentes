import type { Result } from '@suite/shared';
/** Lectura por rangos. `end` exclusivo. Rechaza con PlatformIoError si falla la E/S. */
export interface ByteSource { readonly size: number; read(begin: number, end: number): Promise<Uint8Array>; }
export interface FileFilter { readonly name: string; readonly extensions: readonly string[]; }
export interface OpenedFile {
  readonly token: string;            // id opaco de la implementación
  readonly name: string;             // "informe.pdf"
  readonly path: string | null;      // ruta absoluta en Tauri; null en web
  readonly size: number;
  readonly lastModified: number | null; // ms desde epoch
  readonly canSaveInPlace: boolean;
  readonly source: ByteSource;
}
export type SaveData =
  | { readonly kind: 'bytes'; readonly bytes: Uint8Array }
  | { readonly kind: 'append'; readonly base: OpenedFile; readonly expectedSize: number; readonly delta: Uint8Array };
export type SaveOutcome =
  | { readonly kind: 'saved'; readonly file: OpenedFile }
  | { readonly kind: 'downloaded'; readonly name: string }
  | { readonly kind: 'cancelled' };
export type PlatformErrorCode = 'not-found' | 'permission-denied' | 'io' | 'changed-on-disk'
  | 'save-in-place-unsupported' | 'unsupported' | 'out-of-range';
export interface KeyValueStore {
  get<T>(key: string, guard: (v: unknown) => v is T): T | null;
  set(key: string, value: unknown): void;
  remove(key: string): void;
}
export interface Platform {
  readonly kind: 'web' | 'tauri';
  readonly isMac: boolean;
  readonly prefs: KeyValueStore;
  /** null = el usuario canceló. */
  openFile(filters: readonly FileFilter[]): Promise<Result<OpenedFile | null>>;
  /** Web: fichero de un <input type=file>. Tauri: err('unsupported'). */
  openBrowserFile(file: File): Result<OpenedFile>;
  /** Web: primer fichero soltado. Tauri: ok(null) (lo gestiona onFileOpenedFromOS). */
  openDropped(dt: DataTransfer): Promise<Result<OpenedFile | null>>;
  /** Guarda encima de `target` de forma atómica y devuelve el fichero reabierto. */
  save(target: OpenedFile, data: SaveData): Promise<Result<OpenedFile>>;
  saveAs(suggestedName: string, filters: readonly FileFilter[], data: SaveData): Promise<Result<SaveOutcome>>;
  closeFile(file: OpenedFile): Promise<void>;
  onFileOpenedFromOS(cb: (file: OpenedFile) => void): () => void;
  openExternalUrl(url: string): Promise<Result<void>>;
  setTitle(title: string): void;
  /** cb devuelve true para permitir cerrar, false para cancelar. */
  onCloseRequested(cb: () => boolean): () => void;
  /** Cierra la ventana sin volver a llamar a onCloseRequested. */
  closeWindow(): Promise<void>;
}
