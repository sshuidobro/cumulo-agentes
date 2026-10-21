/**
 * Línea de texto bajo un punto de la página (PDF-146, ADR-0042): función pura sobre los ítems de texto de pdf.js.
 * Todas las coordenadas están en espacio de usuario de la página (puntos).
 */
import type { RectPt } from '../core/annotations/model';

/** Lo que de un ítem de pdf.js hace falta para localizar su línea. */
export interface TextItemLike {
  readonly str: string;
  readonly transform: readonly number[];
  readonly width: number;
  readonly height: number;
}

/** Caja de la línea (`hint`, para localizarla en el Worker) y su texto tal como lo extrae pdf.js. */
export interface LineHint {
  readonly hint: RectPt;
  readonly text: string;
}

/** Caja de un ítem: x de inicio y fin, línea base y altura efectiva. */
interface Box {
  readonly item: TextItemLike;
  readonly x0: number;
  readonly x1: number;
  readonly base: number;
  readonly h: number;
  readonly blank: boolean;
  readonly rotated: boolean;
}

/** Por debajo y por encima de la línea base, en fracciones de la altura del ítem. */
const BOX_BELOW = 0.25;
const BOX_ABOVE = 0.8;
/** Un ítem está girado si su seno supera esta fracción de la altura. */
const ROTATION_TOLERANCE = 0.01;
/** Dos ítems están en la misma línea si sus líneas base distan como mucho esta fracción de la altura. */
const SAME_LINE_TOLERANCE = 0.25;
/** El hueco máximo entre dos ítems de la misma línea, en alturas. */
const MAX_GAP = 1.0;
/** Hueco a partir del cual se inserta un espacio entre dos ítems, en alturas. */
const SPACE_GAP = 0.15;
/** Margen horizontal y vertical de la caja de la línea (pt y fracciones de la altura). */
const HINT_PAD_X = 0.5;
const HINT_BELOW = 0.1;
const HINT_ABOVE = 0.6;

function at(values: readonly number[], index: number): number {
  return values[index] ?? 0;
}

function toBox(item: TextItemLike): Box {
  const t = item.transform;
  const h = item.height !== 0 ? item.height : Math.hypot(at(t, 2), at(t, 3));
  return {
    item,
    x0: at(t, 4),
    x1: at(t, 4) + item.width,
    base: at(t, 5),
    h,
    blank: item.str.trim() === '',
    rotated: Math.abs(at(t, 1)) > ROTATION_TOLERANCE * h,
  };
}

function contains(box: Box, x: number, y: number): boolean {
  return x >= box.x0 && x <= box.x1 && y >= box.base - BOX_BELOW * box.h && y <= box.base + BOX_ABOVE * box.h;
}

/** Hueco horizontal entre dos cajas consecutivas (negativo si se solapan). */
function gap(left: Box, right: Box): number {
  return right.x0 - left.x1;
}

/** Texto de la línea: los ítems concatenados, con un espacio donde hay hueco y ningún espacio en los bordes. */
function joinText(run: readonly Box[], h0: number): string {
  let text = '';
  run.forEach((box, i) => {
    const prev = run[i - 1];
    if (prev !== undefined && gap(prev, box) > SPACE_GAP * h0 && !/\s$/u.test(prev.item.str) && !/^\s/u.test(box.item.str)) {
      text += ' ';
    }
    text += box.item.str;
  });
  return text;
}

/**
 * Línea de texto bajo `point`: el primer ítem (no vacío ni girado) cuya caja lo contiene, y los ítems de su misma
 * línea base que quedan a un hueco ≤ 1 altura, a izquierda y derecha. `null` si el punto no cae en ningún texto.
 */
export function lineHintAt(items: readonly TextItemLike[], point: readonly [number, number]): LineHint | null {
  const boxes = items.map(toBox).filter((box) => !box.rotated);
  const [x, y] = point;
  const pressed = boxes.find((box) => !box.blank && contains(box, x, y));
  if (pressed === undefined) return null;

  const h0 = pressed.h;
  const f0 = pressed.base;
  const row = boxes
    .filter((box) => Math.abs(box.base - f0) <= SAME_LINE_TOLERANCE * h0)
    .sort((a, b) => a.x0 - b.x0);
  const center = row.indexOf(pressed);

  let first = center;
  while (first > 0) {
    const left = row[first - 1];
    const right = row[first];
    if (left === undefined || right === undefined || gap(left, right) > MAX_GAP * h0) break;
    first -= 1;
  }
  let last = center;
  while (last < row.length - 1) {
    const left = row[last];
    const right = row[last + 1];
    if (left === undefined || right === undefined || gap(left, right) > MAX_GAP * h0) break;
    last += 1;
  }

  const run = row.slice(first, last + 1);
  const minX = Math.min(...run.map((box) => box.x0));
  const maxX = Math.max(...run.map((box) => box.x1));
  return {
    hint: [minX - HINT_PAD_X, f0 - HINT_BELOW * h0, maxX + HINT_PAD_X, f0 + HINT_ABOVE * h0],
    text: joinText(run, h0),
  };
}
