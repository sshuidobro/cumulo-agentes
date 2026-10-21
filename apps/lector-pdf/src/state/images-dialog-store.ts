import { create } from 'zustand';
import type { PageSizeMode } from '../core/pdf/images-to-pdf';

/**
 * Estado del diálogo «Crear PDF desde imágenes» (PDF-129). Vive aparte de las acciones para que la pantalla de inicio
 * y «Más acciones» lo usen sin cargar el código de creación (presupuesto de bundle de arranque).
 */

/** Margen en pt: sin margen, pequeño y normal. */
export type MarginChoice = 0 | 18 | 36;

/** Una imagen de la lista. `previewUrl` es un object URL que se revoca al quitarla o cerrar el diálogo. */
export interface ImageItem {
  readonly id: string;
  readonly name: string;
  readonly bytes: Uint8Array;
  readonly previewUrl: string;
}

export interface ImagesDialogState {
  readonly open: boolean;
  readonly items: readonly ImageItem[];
  readonly pageSize: PageSizeMode;
  readonly margin: MarginChoice;
}

/** Diálogo «Crear PDF desde imágenes» (lo pinta `ui/organize/ImagesDialog`). */
export const useImagesDialog = create<ImagesDialogState>()(() => ({
  open: false,
  items: [],
  pageSize: 'a4',
  margin: 18,
}));

/**
 * Texto de la entrada en la pantalla de inicio y en «Más acciones». Está aquí, y no en `messages-images`, porque
 * ese fichero se carga con el diálogo y estas dos entradas se pintan en el arranque (presupuesto de bundle).
 */
export const IMAGES_MENU_ITEM = 'Crear PDF desde imágenes…';

/** Carga las acciones y abre el diálogo (un único `import()` para la pantalla de inicio y «Más acciones»). */
export function requestImagesDialog(): void {
  void import('./images-pdf-actions').then((a) => a.openImagesDialog());
}
