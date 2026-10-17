import { create, type StoreApi, type UseBoundStore } from 'zustand';
import type { AppError } from '@suite/shared';
import type { OpenedFile } from '@suite/platform';
import type { LoadedPdf } from '../engine';
import type { PageDimsTable } from '../core/page-dims';

export type DocStatus = 'empty' | 'loading' | 'ready' | 'error';

export interface ViewerState {
  readonly status: DocStatus;
  readonly file: OpenedFile | null;
  readonly pdf: LoadedPdf | null;
  readonly error: AppError | null; // error al abrir
  readonly ioError: AppError | null; // error de lectura con el documento ya abierto
  readonly loadingName: string | null;
  readonly loadProgress: number | null; // 0..1 o null si desconocido
  readonly dims: PageDimsTable | null;
  /** Sube cada vez que cambian las dimensiones (la tabla se muta en sitio). */
  readonly dimsVersion: number;
  readonly currentPage: number; // 0-based
}

export const initialViewerState: ViewerState = {
  status: 'empty',
  file: null,
  pdf: null,
  error: null,
  ioError: null,
  loadingName: null,
  loadProgress: null,
  dims: null,
  dimsVersion: 0,
  currentPage: 0,
};

export const useViewer: UseBoundStore<StoreApi<ViewerState>> = create<ViewerState>()(() => initialViewerState);
