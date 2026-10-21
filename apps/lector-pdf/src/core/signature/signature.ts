/**
 * Firma visual (PDF-043, ADR-0020): geometría de colocar y redimensionar una firma, y la anotación nueva que se
 * crea al colocarla. Puro: sin React, sin DOM. Coordenadas en puntos PDF, `RectPt` = `[x1, y1, x2, y2]`.
 */
import type { RectPt, Rgb, SignatureAnnotation, SignatureArt } from '../annotations/model';

/** Ancho con el que aparece una firma recién colocada, en puntos PDF. */
export const DEFAULT_SIGNATURE_WIDTH_PT = 150;
/** Ancho con el que aparece una imagen colocada en la página (PDF-130), en puntos PDF. */
export const PAGE_IMAGE_WIDTH_PT = 200;
/** Ancho mínimo de una firma al redimensionarla, en puntos PDF. */
export const MIN_SIGNATURE_WIDTH_PT = 20;
/** Comentario de las firmas (aparece en el panel de comentarios). */
export const SIGNATURE_CONTENTS = 'Firma';

const BLACK: Rgb = [0, 0, 0];

/** Proporción ancho / alto de la firma: `box` para los trazos, píxeles para las imágenes. */
export function signatureAspect(art: SignatureArt): number {
  return art.kind === 'ink' ? art.box[0] / art.box[1] : art.pixelWidth / art.pixelHeight;
}

/**
 * Rectángulo de una firma de `width` de ancho (por defecto `DEFAULT_SIGNATURE_WIDTH_PT`) y la proporción de `art`,
 * centrado en `center`. Si queda fuera de `pageBox`, se desplaza para entrar en la página.
 */
export function signatureRectAt(
  art: SignatureArt,
  center: readonly [number, number],
  pageBox: RectPt,
  width = DEFAULT_SIGNATURE_WIDTH_PT,
): RectPt {
  const [cx, cy] = center;
  const height = width / signatureAspect(art);
  const [bx1, by1, bx2, by2] = pageBox;
  const x1 = inside(cx - width / 2, bx1, bx2, width);
  const y1 = inside(cy - height / 2, by1, by2, height);
  return [x1, y1, x1 + width, y1 + height];
}

/** Origen de un intervalo de `size` dentro de `[start, end]`, lo más cerca posible de `value`. */
function inside(value: number, start: number, end: number, size: number): number {
  return Math.max(start, Math.min(value, end - size));
}

/**
 * Redimensiona una firma arrastrando una esquina, con la esquina superior izquierda fija y la proporción constante.
 * `dx` y `dy` son los incrementos de ancho y de alto en puntos (positivos = más grande). Se usa el eje que más
 * cambia. Nunca baja de `minWidth` de ancho.
 */
export function resizeKeepingAspect(
  rect: RectPt,
  corner: 'se',
  dx: number,
  dy: number,
  minWidth = MIN_SIGNATURE_WIDTH_PT,
): RectPt {
  const [x1, y1, x2, y2] = rect;
  if (corner !== 'se') return rect;
  const width = x2 - x1;
  const height = y2 - y1;
  const aspect = width / height;
  const byWidth = Math.abs(dx / width) >= Math.abs(dy / height);
  const wanted = byWidth ? width + dx : (height + dy) * aspect;
  const newWidth = Math.max(minWidth, wanted);
  const newHeight = newWidth / aspect;
  return [x1, y2 - newHeight, x1 + newWidth, y2];
}

/** Punto de la página (puntos PDF, sin girar) de un punto de la vista en puntos desde su esquina superior izquierda. */
export function viewPointToPage(
  widthPt: number,
  heightPt: number,
  rotation: number,
  vx: number,
  vy: number,
): readonly [number, number] {
  switch (((rotation % 360) + 360) % 360) {
    case 90:
      return [vy, vx];
    case 180:
      return [widthPt - vx, vy];
    case 270:
      return [widthPt - vy, heightPt - vx];
    default:
      return [vx, heightPt - vy];
  }
}

/**
 * Centro de una firma colocada con teclado (PDF-043): horizontalmente centrado en la vista y a un tercio de lo visible
 * desde su borde superior. `yFraction` es la posición del borde superior visible dentro de la página actual, y
 * `visibleFraction` la parte de la página que cabe en la pantalla (0..1). `rotation` es la rotación total de la vista.
 */
export function keyboardSignatureCenter(
  widthPt: number,
  heightPt: number,
  rotation: number,
  yFraction: number,
  visibleFraction: number,
): readonly [number, number] {
  const r = ((rotation % 360) + 360) % 360;
  const sideways = r === 90 || r === 270;
  const viewWidth = sideways ? heightPt : widthPt;
  const viewHeight = sideways ? widthPt : heightPt;
  const fraction = Math.min(1, Math.max(0, yFraction + visibleFraction / 3));
  return viewPointToPage(widthPt, heightPt, r, viewWidth / 2, fraction * viewHeight);
}

export interface NewSignatureInput {
  readonly id: string;
  readonly pageIndex: number;
  readonly rect: RectPt;
  readonly art: SignatureArt;
  readonly author: string;
  /** Instante de creación en ISO 8601. */
  readonly now: string;
  /** Imagen de la página (PDF-130): se aplana como contenido al guardar (ADR-0036). */
  readonly flatten?: true;
}

/** Firma nueva: negra, opacidad plena, comentario «Firma». Se guarda como `/Stamp` (ADR-0020). */
export function newSignatureAnnotation(input: NewSignatureInput): SignatureAnnotation {
  return {
    id: input.id,
    type: 'signature',
    pageIndex: input.pageIndex,
    rect: input.rect,
    art: input.art,
    color: BLACK,
    opacity: 1,
    contents: SIGNATURE_CONTENTS,
    author: input.author,
    modified: input.now,
    created: input.now,
    origin: { kind: 'new' },
    ...(input.flatten === true ? { flatten: true as const } : {}),
  };
}
