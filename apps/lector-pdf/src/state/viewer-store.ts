import { create, type StoreApi, type UseBoundStore } from 'zustand';
import type { AppError } from '@suite/shared';
import type { OpenedFile } from '@suite/platform';
import type { LoadedPdf } from '../engine';
import type { PageDimsTable } from '../core/page-dims';
import { DEFAULT_ZOOM_MODE, type ZoomMode } from '../core/zoom';
import type { Rotation } from '../core/rotation';
import type { SidebarState } from '../core/sidebar';
import type { OutlineNode } from '../core/outline';

export type DocStatus = 'empty' | 'loading' | 'ready' | 'error';

/** Herramienta del puntero sobre el visor: seleccionar texto o desplazar el documento arrastrando (PDF-013). */
export type ViewTool = 'select' | 'hand';

/** Petición de ir a una posición del documento. `seq` crece en cada petición para que el visor distinga repeticiones. */
export interface NavRequest {
  readonly seq: number;
  readonly page: number;
  /** Posición vertical dentro de la página, en [0, 1]. */
  readonly yFraction: number;
  /** Posición horizontal dentro de la página, en [0, 1], o null para no tocar el scroll horizontal. */
  readonly xFraction: number | null;
}

/**
 * Punto que no debe moverse al cambiar el layout: píxeles desde el borde superior del visor, o `'center'`
 * (el centro del visor, el valor por defecto de los controles de zoom y rotación).
 */
export type ZoomFocus = number | 'center';

/** Si hay vista anterior y siguiente a la que volver (historial de enlaces, PDF-014). */
export interface HistoryFlags {
  readonly canBack: boolean;
  readonly canForward: boolean;
}

/** Aviso temporal de la interfaz. `id` crece en cada aviso para distinguir avisos con el mismo texto. */
export interface NoticeItem {
  readonly id: number;
  readonly text: string;
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
  /** Posición vertical dentro de la página actual, en [0, 1] (PDF-019). */
  readonly currentYFraction: number;
  /** Modo de zoom elegido por el usuario. */
  readonly zoomMode: ZoomMode;
  /** Zoom efectivo (lo calcula el visor a partir de `zoomMode`). */
  readonly zoom: number;
  /** Rotación de vista (se suma a la de cada página). */
  readonly rotation: Rotation;
  /** Punto fijo del próximo cambio de layout (zoom o giro). `null`: el visor conserva el borde superior. */
  readonly zoomFocusY: ZoomFocus | null;
  readonly navRequest: NavRequest | null;
  /** Etiquetas de página del PDF (p. ej. «i», «1», «A-1»), o null si no tiene o no se han leído. */
  readonly pageLabels: readonly string[] | null;
  /** `true` si el contenido es más ancho que el visor (las flechas izquierda/derecha hacen scroll horizontal). */
  readonly hasHorizontalOverflow: boolean;
  /** Herramienta activa del visor. */
  readonly tool: ViewTool;
  /** Atrás/adelante disponibles en el historial de vista (PDF-014). */
  readonly historyState: HistoryFlags;
  /** Aviso temporal visible, o null (PDF-014). */
  readonly notice: NoticeItem | null;
  /** Panel lateral: cerrado o la pestaña mostrada (PDF-015). */
  readonly sidebar: SidebarState;
  /** Índice del documento como árbol (PDF-016), o null mientras se lee. */
  readonly outline: readonly OutlineNode[] | null;
  /** Ids de los marcadores del índice que están desplegados (PDF-016). */
  readonly outlineExpanded: ReadonlySet<string>;
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
  currentYFraction: 0,
  zoomMode: DEFAULT_ZOOM_MODE,
  zoom: 1,
  rotation: 0,
  zoomFocusY: null,
  navRequest: null,
  pageLabels: null,
  hasHorizontalOverflow: false,
  tool: 'select',
  historyState: { canBack: false, canForward: false },
  notice: null,
  sidebar: 'none',
  outline: null,
  outlineExpanded: new Set<string>(),
};

export const useViewer: UseBoundStore<StoreApi<ViewerState>> = create<ViewerState>()(() => initialViewerState);
