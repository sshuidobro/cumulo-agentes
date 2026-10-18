import { quadFromRect, type Quad, type RectPt } from './model';

/** Rectángulos más estrechos o más bajos que esto (pt) se descartan: son artefactos de medida. */
const MIN_SIDE_PT = 0.5;
/** Dos rectángulos son de la misma línea si se solapan en vertical al menos esta fracción de la altura del menor. */
const SAME_LINE_OVERLAP = 0.5;
/** Hueco máximo entre dos fragmentos de una línea para unirlos, como fracción de la altura del mayor. */
const MAX_GAP_RATIO = 0.5;

interface Line {
  /** Caja envolvente de todos los fragmentos de la línea. */
  box: RectPt;
  readonly parts: RectPt[];
}

/**
 * Convierte los rectángulos de una selección (puntos PDF, uno por fragmento de línea) en quads de marcado.
 * Los fragmentos de la misma línea que se tocan o están separados como mucho medio alto de línea (huecos
 * entre palabras) forman un único quad; los separados más, quads distintos. Orden: de arriba abajo y, en
 * cada línea, de izquierda a derecha. Puro: sin DOM.
 */
export function rectsToLineQuads(rects: readonly RectPt[]): Quad[] {
  const usable = rects.filter((r) => width(r) >= MIN_SIDE_PT && height(r) >= MIN_SIDE_PT);
  // Primero los más altos; a igual altura, los de la izquierda. Así cada línea empieza por su primer fragmento.
  const sorted = [...usable].sort((a, b) => b[3] - a[3] || a[0] - b[0]);

  const lines: Line[] = [];
  for (const r of sorted) {
    const line = lines.find((candidate) => sameLine(candidate.box, r));
    if (line === undefined) {
      lines.push({ box: r, parts: [r] });
    } else {
      line.parts.push(r);
      line.box = union(line.box, r);
    }
  }

  lines.sort((a, b) => b.box[3] - a.box[3]);
  const quads: Quad[] = [];
  for (const line of lines) {
    for (const group of mergeParts(line.parts)) quads.push(quadFromRect(group));
  }
  return quads;
}

/** Une, de izquierda a derecha, los fragmentos de una línea cuyo hueco no supera el umbral. */
function mergeParts(parts: readonly RectPt[]): RectPt[] {
  const ordered = [...parts].sort((a, b) => a[0] - b[0]);
  const groups: RectPt[] = [];
  let current: RectPt | undefined;
  for (const part of ordered) {
    if (current === undefined) {
      current = part;
      continue;
    }
    const gap = part[0] - current[2];
    const maxGap = MAX_GAP_RATIO * Math.max(height(current), height(part));
    if (gap <= maxGap) {
      current = union(current, part);
    } else {
      groups.push(current);
      current = part;
    }
  }
  if (current !== undefined) groups.push(current);
  return groups;
}

/** `true` si `r` se solapa en vertical con la línea `box` al menos la fracción acordada de la altura del menor. */
function sameLine(box: RectPt, r: RectPt): boolean {
  const overlap = Math.min(box[3], r[3]) - Math.max(box[1], r[1]);
  return overlap >= SAME_LINE_OVERLAP * Math.min(height(box), height(r));
}

function union(a: RectPt, b: RectPt): RectPt {
  return [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[2], b[2]), Math.max(a[3], b[3])];
}

function width(r: RectPt): number {
  return r[2] - r[0];
}

function height(r: RectPt): number {
  return r[3] - r[1];
}
