/** Separación entre el menú y el botón, y margen mínimo con los bordes de la ventana (px). */
const GAP_PX = 4;
const EDGE_PX = 8;

export interface MenuPlacement {
  readonly left: number;
  readonly top: number;
  readonly maxHeight: number;
}

interface Box {
  readonly left: number;
  readonly top: number;
  readonly bottom: number;
}

interface Size {
  readonly width: number;
  readonly height: number;
}

/**
 * Coloca un menú dentro de la ventana: debajo del botón y alineado con su borde izquierdo, desplazado a la izquierda
 * si no cabe. Si tampoco cabe en vertical se abre hacia donde haya más sitio, con la altura limitada a ese sitio.
 */
export function placeMenu(button: Box, menu: Size, viewport: Size): MenuPlacement {
  const left = Math.max(EDGE_PX, Math.min(button.left, viewport.width - menu.width - EDGE_PX));
  const below = viewport.height - button.bottom - GAP_PX - EDGE_PX;
  const above = button.top - GAP_PX - EDGE_PX;
  if (menu.height <= below || below >= above) {
    return { left, top: button.bottom + GAP_PX, maxHeight: Math.max(below, 0) };
  }
  const maxHeight = Math.max(above, 0);
  return { left, top: button.top - GAP_PX - Math.min(menu.height, maxHeight), maxHeight };
}
