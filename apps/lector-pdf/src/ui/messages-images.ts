import { IMAGES_MENU_ITEM } from '../state/images-dialog-store';

/**
 * Textos de «Crear PDF desde imágenes» (PDF-129). Se cargan con el diálogo; la entrada del menú va en el store.
 */
export const imagesMsg = {
  /** Elemento del menú y botón de la pantalla de inicio. */
  menuItem: IMAGES_MENU_ITEM,
  /** Título del diálogo. */
  title: 'Crear PDF desde imágenes',
  /** Explicación cuando la lista está vacía. */
  hint: 'Elige las imágenes; cada una será una página del PDF, en el orden de la lista.',
  /** Nombre accesible de la lista de imágenes. */
  list: 'Imágenes en orden',
  add: 'Añadir imágenes…',
  moveUp: 'Subir',
  moveDown: 'Bajar',
  remove: 'Quitar',
  /** Grupo «Tamaño de página». */
  pageSize: 'Tamaño de página',
  fit: 'Ajustar a cada imagen',
  a4: 'A4',
  letter: 'Carta',
  /** Grupo «Margen» (deshabilitado con «Ajustar a cada imagen»). */
  margin: 'Margen',
  none: 'Sin margen',
  small: 'Pequeño',
  normal: 'Normal',
  create: 'Crear PDF',
  /** Un fichero que no se puede decodificar o que supera los píxeles permitidos. */
  cannotRead: (name: string): string => `No se puede leer la imagen “${name}”.`,
  tooMany: 'Puedes añadir como mucho 500 imágenes.',
  tooBig: 'Cada imagen puede ocupar como mucho 50 MB.',
  /** Progreso mientras se preparan las imágenes y se crea el PDF. */
  progress: (current: number, total: number): string => `Creando PDF: imagen ${String(current)} de ${String(total)}…`,
  /** Aviso cuando el PDF se ha descargado (no hay diálogo de guardar). */
  created: (name: string): string => `PDF creado y guardado como “${name}”.`,
};
