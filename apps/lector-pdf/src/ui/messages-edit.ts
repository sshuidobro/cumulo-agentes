/**
 * Textos de la barra «Editar» (PDF-130): añadir texto e imagen a la página como contenido al guardar (ADR-0036).
 */
export const editMsg = {
  /** Botón de la barra principal y nombre de la barra. */
  editButton: 'Editar',
  /** Herramienta de texto libre aplanado. */
  addText: 'Añadir texto',
  /** Abre el selector de PNG o JPEG y deja la imagen pendiente de colocar. */
  addImage: 'Añadir imagen',
  close: 'Cerrar',
  /** Título de lo que está pendiente de guardar: se verá igual, pero aún no es contenido de la página. */
  pendingContent: 'Contenido de la página (se fijará al guardar)',
  /** Aviso una vez por documento si el PDF no permite modificar su contenido. No bloquea el cambio. */
  modifyAnyway: 'Este PDF no permite modificar su contenido; tus cambios se guardarán igualmente en tu copia.',
  /** Imagen que supera el tamaño permitido. */
  imageTooBig: 'La imagen supera el tamaño máximo permitido (20 MB).',
} as const;
