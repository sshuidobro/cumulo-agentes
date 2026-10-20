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
export type ExportOutcome = 'saved' | 'downloaded' | 'cancelled';
export interface ImportedFile { readonly name: string; readonly bytes: Uint8Array }
export type PlatformErrorCode = 'not-found' | 'permission-denied' | 'io' | 'changed-on-disk'
  | 'save-in-place-unsupported' | 'unsupported' | 'out-of-range';
/** Fichero reciente. Solo metadatos: nunca el contenido. */
export interface RecentFile {
  readonly id: string;              // estable por fichero
  readonly name: string;
  readonly path: string | null;     // Tauri: ruta; web: null
  readonly size: number | null;
  readonly openedAt: number;        // ms desde epoch
  readonly available: boolean;      // false si ya no existe (Tauri) o no se puede reabrir
}
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
  /** Guarda `bytes` con el diálogo de guardar. No lo anota en recientes ni lo deja abierto. */
  exportFile(suggestedName: string, filters: readonly FileFilter[], bytes: Uint8Array): Promise<Result<ExportOutcome>>;
  /** Elige un fichero con el diálogo de abrir y devuelve su contenido completo; null = cancelado. Más de `maxBytes` → err('out-of-range') sin leerlo. No lo anota en recientes ni lo deja abierto. */
  importFile(filters: readonly FileFilter[], maxBytes: number): Promise<Result<ImportedFile | null>>;
  closeFile(file: OpenedFile): Promise<void>;
  onFileOpenedFromOS(cb: (file: OpenedFile) => void): () => void;
  openExternalUrl(url: string): Promise<Result<void>>;
  setTitle(title: string): void;
  /** cb devuelve true para permitir cerrar, false para cancelar. */
  onCloseRequested(cb: () => boolean): () => void;
  /** Cierra la ventana sin volver a llamar a onCloseRequested. */
  closeWindow(): Promise<void>;
  /** Abre el diálogo de impresión del sistema. Resuelve cuando el diálogo se ha abierto (web: cuando `window.print()` vuelve). */
  print(): Promise<Result<void>>;
  /** Más reciente primero, máximo 20. */
  recentFiles(): Promise<readonly RecentFile[]>;
  /** null = el usuario negó el permiso. */
  openRecent(id: string): Promise<Result<OpenedFile | null>>;
  removeRecent(id: string): Promise<void>;
  clearRecents(): Promise<void>;
  /** Pone o quita la pantalla completa. err('unsupported') si el entorno no lo permite. */
  setFullscreen(on: boolean): Promise<Result<void>>;
  isFullscreen(): boolean;
  /** Avisa cuando cambia (también si lo cambia el usuario o el SO). Devuelve la baja. */
  onFullscreenChange(cb: (on: boolean) => void): () => void;
}
