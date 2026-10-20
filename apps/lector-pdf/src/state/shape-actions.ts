import { DEFAULT_LINE_PT, defaultPolygon, dragBox, dragLine } from '../core/annotations/shape-drag';
import {
  lineRect,
  newBoxShape,
  newLineShape,
  newPolygonShape,
  newStamp,
  resizeBox,
  stampCenterInside,
  verticesRect,
  type StampName,
} from '../core/annotations/shapes';
import type { BoxShapeAnnotation, LineShapeAnnotation, PolygonAnnotation, RectPt, Rgb } from '../core/annotations/model';
import { keyboardSignatureCenter } from '../core/signature/signature';
import {
  addAnnotation,
  getEffective,
  newAnnotationId,
  nowIso,
  rememberPendingStamp,
  rememberShapeWidth,
  select,
  setTool,
  updateAnnotation,
} from './annotation-actions';
import { useAnnotations, type AnnotationState, type AnnotationTool } from './annotation-store';
import { useViewer } from './viewer-store';

/** Herramientas que crean una forma arrastrando (PDF-108). */
export type ShapeTool = 'square' | 'circle' | 'line' | 'arrow';
/** Lo que se crea con teclado en la página actual: una forma (PDF-108), un polígono por defecto o un sello (PDF-115). */
export type KeyboardShapeTool = ShapeTool | 'polygon' | 'stamp';

const SHAPE_TOOLS: ReadonlySet<AnnotationTool> = new Set<AnnotationTool>(['square', 'circle', 'line', 'arrow']);

export function isShapeTool(t: AnnotationTool): t is ShapeTool {
  return SHAPE_TOOLS.has(t);
}

/**
 * Añade un rectángulo o una elipse en la página `pageIndex` con el color de su herramienta y el grosor de formas. La
 * selecciona y devuelve su id. La herramienta sigue activa.
 */
export function createBox(pageIndex: number, kind: 'square' | 'circle', rect: RectPt): string {
  const { colors, shapeWidth, author } = useAnnotations.getState();
  const box = newBoxShape({
    id: newAnnotationId(),
    pageIndex,
    rect,
    kind,
    width: shapeWidth,
    color: colors[kind],
    author,
    now: nowIso(),
  });
  addAnnotation(box);
  select(box.id);
  return box.id;
}

/**
 * Añade un polígono cerrado con esos vértices (`[x0, y0, x1, y1, ...]`) en la página `pageIndex`, con el color de su
 * herramienta y el grosor de formas. Lo selecciona y devuelve su id. La herramienta sigue activa (PDF-115).
 */
export function createPolygon(pageIndex: number, vertices: readonly number[]): string {
  const { colors, shapeWidth, author } = useAnnotations.getState();
  const polygon = newPolygonShape({
    id: newAnnotationId(),
    pageIndex,
    vertices,
    width: shapeWidth,
    color: colors.polygon,
    author,
    now: nowIso(),
  });
  addAnnotation(polygon);
  select(polygon.id);
  return polygon.id;
}

/**
 * Elige el sello de «Sello» (PDF-115): lo guarda como preferencia y activa la herramienta `stamp`. El siguiente clic en
 * la página lo coloca.
 */
export function chooseStamp(name: StampName): void {
  rememberPendingStamp(name);
  setTool('stamp');
}

/**
 * Coloca el sello pendiente centrado en `center` (puntos PDF) de la página `pageIndex`, desplazado para que quede dentro
 * de `pageBox`. Lo selecciona, devuelve la herramienta a «ninguna» (como la firma) y devuelve su id.
 */
export function placeStamp(pageIndex: number, center: readonly [number, number], pageBox: RectPt): string {
  const { pendingStamp, author } = useAnnotations.getState();
  const stamp = newStamp({
    id: newAnnotationId(),
    pageIndex,
    name: pendingStamp,
    center: stampCenterInside(pendingStamp, center, pageBox),
    author,
    now: nowIso(),
  });
  addAnnotation(stamp);
  setTool('none');
  select(stamp.id);
  return stamp.id;
}

/**
 * Añade una línea (o flecha si `arrow`) en la página `pageIndex` con el color de su herramienta y el grosor de formas.
 * La selecciona y devuelve su id. La herramienta sigue activa.
 */
export function createLine(pageIndex: number, points: readonly [number, number, number, number], arrow: boolean): string {
  const { colors, shapeWidth, author } = useAnnotations.getState();
  const line = newLineShape({
    id: newAnnotationId(),
    pageIndex,
    points,
    arrow,
    width: shapeWidth,
    color: arrow ? colors.arrow : colors.line,
    author,
    now: nowIso(),
  });
  addAnnotation(line);
  select(line.id);
  return line.id;
}

/**
 * Teclado (PDF-108, PDF-115): forma por defecto (o el polígono por defecto, o el sello pendiente) centrada en el punto
 * que indica `keyboardSignatureCenter` (con la página entera visible) de la página actual. La selecciona y devuelve la
 * herramienta a «ninguna». Devuelve su id, o `null` si no hay documento o no hay página actual.
 */
export function addShapeFromKeyboard(tool: KeyboardShapeTool): string | null {
  const { dims, currentPage, currentYFraction, rotation } = useViewer.getState();
  if (dims === null || currentPage >= dims.count) return null;
  const i = currentPage;
  const width = dims.width(i);
  const height = dims.height(i);
  const [cx, cy] = keyboardSignatureCenter(width, height, (dims.rotation(i) + rotation) % 360, currentYFraction, 1);
  const page: RectPt = [0, 0, width, height];
  if (tool === 'stamp') return placeStamp(i, [cx, cy], page);
  let id: string;
  if (tool === 'polygon') id = createPolygon(i, defaultPolygon(cx, cy, page));
  else if (tool === 'line' || tool === 'arrow')
    id = createLine(i, dragLine(cx - DEFAULT_LINE_PT / 2, cy, cx + DEFAULT_LINE_PT / 2, cy, false, page), tool === 'arrow');
  else id = createBox(i, tool, dragBox(cx, cy, cx, cy, false, page));
  setTool('none');
  return id;
}

/** Forma seleccionada y visible (rectángulo, elipse, línea, flecha o polígono), o `undefined`. */
export function selectedShape(): BoxShapeAnnotation | LineShapeAnnotation | PolygonAnnotation | undefined {
  const id = useAnnotations.getState().selectedId;
  if (id === null) return undefined;
  const current = getEffective().get(id);
  if (current === undefined) return undefined;
  switch (current.type) {
    case 'square':
    case 'circle':
    case 'line':
    case 'polygon':
      return current;
    default:
      return undefined;
  }
}

/**
 * Grosor de formas (PDF-108): lo fija para las nuevas y, si hay una forma seleccionada, también para ella. Una línea o
 * un polígono recalcula su caja para que siga conteniendo el trazo (y las puntas); un rectángulo o elipse no cambia de
 * caja. Una sola entrada de deshacer «cambiar grosor».
 */
export function setShapeWidth(width: AnnotationState['shapeWidth']): void {
  rememberShapeWidth(width);
  const current = selectedShape();
  if (current === undefined || current.width === width) return;
  updateAnnotation(withWidth(current, width), 'cambiar grosor');
}

function withWidth(
  a: BoxShapeAnnotation | LineShapeAnnotation | PolygonAnnotation,
  width: number,
): BoxShapeAnnotation | LineShapeAnnotation | PolygonAnnotation {
  switch (a.type) {
    case 'line':
      return { ...a, width, rect: lineRect(a.points, width, a.endings) };
    case 'polygon':
      return { ...a, width, rect: verticesRect(a.vertices, width) };
    default:
      return { ...a, width };
  }
}

/** Color de la forma seleccionada (PDF-108): una entrada de deshacer «cambiar color». No cambia el de la herramienta. */
export function setShapeColor(color: Rgb): void {
  const current = selectedShape();
  if (current === undefined || current.color.every((v, i) => v === color[i])) return;
  updateAnnotation({ ...current, color }, 'cambiar color');
}

/**
 * Cambia el cuadro de un rectángulo, una elipse o un sello (tirador, PDF-108, PDF-115). Solo esos tipos; sin cambio real
 * no crea entrada. El sello llega ya con su proporción (la calcula el tirador con `resizeKeepingAspect`).
 */
export function resizeShape(id: string, rect: RectPt): void {
  const current = getEffective().get(id);
  if (current?.type !== 'square' && current?.type !== 'circle' && current?.type !== 'stamp') return;
  if (current.rect.every((v, i) => v === rect[i])) return;
  updateAnnotation(resizeBox(current, rect), 'cambiar tamaño');
}
