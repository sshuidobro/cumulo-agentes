/** Tipos de File System Access que no trae lib.dom (solo Chromium). */
export interface FilePickerAcceptType {
  readonly description?: string;
  readonly accept: Record<string, string[]>;
}

export interface OpenFilePickerOptions {
  readonly types?: FilePickerAcceptType[];
  readonly excludeAcceptAllOption?: boolean;
  readonly multiple?: boolean;
}

export interface SaveFilePickerOptions {
  readonly suggestedName?: string;
  readonly types?: FilePickerAcceptType[];
}

export type ShowOpenFilePicker = (o?: OpenFilePickerOptions) => Promise<FileSystemFileHandle[]>;

export type ShowSaveFilePicker = (o?: SaveFilePickerOptions) => Promise<FileSystemFileHandle>;

export type PermissionHandle = FileSystemFileHandle & {
  queryPermission?(d: { mode: 'read' | 'readwrite' }): Promise<PermissionState>;
  requestPermission?(d: { mode: 'read' | 'readwrite' }): Promise<PermissionState>;
};

/** DataTransferItem.getAsFileSystemHandle (Chromium): lib.dom no lo tipa. */
export interface DataTransferItemFsAccess {
  getAsFileSystemHandle?(): Promise<FileSystemHandle | null>;
}
