/** Estilo del trazo en vista previa (PDF-076). */
export interface InkPreviewStyle {
  readonly color: string;
  /** Grosor en puntos PDF (el contexto ya está en coordenadas PDF). */
  readonly widthPt: number;
}

/** Subconjunto del viewport de pdf.js que necesita la vista previa. */
export interface InkViewport {
  readonly width: number;
  readonly height: number;
  readonly transform: readonly number[];
}

/** Subconjunto del contexto 2D que usa la vista previa (permite simularlo en pruebas). */
export type InkContext = Pick<CanvasRenderingContext2D, 'beginPath' | 'moveTo' | 'lineTo' | 'stroke'>;

/** Contexto de dibujo de la vista previa: lienzo del DOM o, si está transferido, `OffscreenCanvas` (PDF-105). */
export type InkDrawingContext = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

/**
 * Ajusta el lienzo al viewport y a `dpr`, y deja el contexto en coordenadas PDF con el estilo del trazo.
 * Con `transferControlToOffscreen` (PDF-105) los fotogramas van al compositor sin pasar por el `Commit` del hilo
 * principal. `null` si no hay contexto 2D.
 */
export function prepareInkCanvas(
  canvas: HTMLCanvasElement,
  viewport: InkViewport,
  dpr: number,
  style: InkPreviewStyle,
): InkDrawingContext | null {
  canvas.style.width = `${viewport.width}px`;
  canvas.style.height = `${viewport.height}px`;
  const pxW = Math.round(viewport.width * dpr);
  const pxH = Math.round(viewport.height * dpr);
  // Si el lienzo ya estuviera transferido, `transferControlToOffscreen` lanza: es un bug y se deja propagar.
  let ctx: InkDrawingContext | null;
  if (typeof canvas.transferControlToOffscreen === 'function') {
    const off = canvas.transferControlToOffscreen();
    off.width = pxW;
    off.height = pxH;
    ctx = off.getContext('2d');
  } else {
    canvas.width = pxW;
    canvas.height = pxH;
    ctx = canvas.getContext('2d');
  }
  if (ctx === null) return null;
  const [a = 1, b = 0, c = 0, d = 1, e = 0, f = 0] = viewport.transform;
  ctx.setTransform(a * dpr, b * dpr, c * dpr, d * dpr, e * dpr, f * dpr);
  ctx.lineWidth = style.widthPt;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.strokeStyle = style.color;
  return ctx;
}

/**
 * Dibuja los segmentos de `points` ([x0, y0, x1, y1, ...]) que faltan desde `drawn` (coordenadas ya dibujadas; 0 al
 * empezar), unidos con el último punto ya dibujado. Devuelve el nuevo `drawn`. O(puntos nuevos).
 */
export function drawInkSegments(ctx: InkContext, points: readonly number[], drawn: number): number {
  const start = Math.max(0, drawn - 2);
  if (points.length - start < 4) return drawn;
  ctx.beginPath();
  ctx.moveTo(points[start] ?? 0, points[start + 1] ?? 0);
  for (let i = start + 2; i + 1 < points.length; i += 2) ctx.lineTo(points[i] ?? 0, points[i + 1] ?? 0);
  ctx.stroke();
  return points.length;
}
