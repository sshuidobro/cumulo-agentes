import { create, type StoreApi, type UseBoundStore } from 'zustand';
import type { AppError } from '@suite/shared';
import type { OpenedFile } from '@suite/platform';
import type { LoadedPdf } from '../engine';
import type { PageDimsTable } from '../core/page-dims';
import { DEFAULT_ZOOM_MODE, type ZoomMode } from '../core/zoom';
import type { Rotation } from '../core/rotation';

export type DocStatus = 'empty' | 'loading' | 'ready' | 'error';

/** Petición de ir a una posición del documento. `seq` crece en cada petición para que el visor distinga repeticiones. */
export interface NavRequest {
  readonly seq: number;
  readonly page: number;
  /** Posición vertical dentro de la página, en [0, 1]. */
  readonly yFraction: number;
  /** Posición horizontal dentro de la página, en [0, 1], o null para no tocar el scroll horizontal. */
  readonly xFraction: number | null;
}

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
  /** Modo de zoom elegido por el usuario. */
  readonly zoomMode: ZoomMode;
  /** Zoom efectivo (lo calcula el visor a partir de `zoomMode`). */
  readonly zoom: number;
  /** Rotación de vista (se suma a la de cada página). */
  readonly rotation: Rotation;
  readonly navRequest: NavRequest | null;
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
  zoomMode: DEFAULT_ZOOM_MODE,
  zoom: 1,
  rotation: 0,
  navRequest: null,
};

export const useViewer: UseBoundStore<StoreApi<ViewerState>> = create<ViewerState>()(() => initialViewerState);
