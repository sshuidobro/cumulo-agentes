/**
 * Reconstruye el orden de lectura y los párrafos de una página a partir de la posición de sus textos. Un PDF solo
 * guarda trozos de texto colocados en la página: las líneas, las columnas y los párrafos hay que deducirlos.
 */

/** Trozo de texto colocado. Coordenadas con la `y` hacia abajo; `rotation` en radianes, en sentido horario. */
export interface LayoutItem {
  readonly text: string;
  readonly x: number;
  /** Línea base. */
  readonly y: number;
  readonly width: number;
  /** Tamaño de la fuente. */
  readonly size: number;
  readonly rotation: number;
}

/** Forma mínima de un ítem de texto de pdf.js con su posición. */
export interface PdfTextItem {
  readonly str: string;
  readonly transform: readonly number[];
  readonly width: number;
  readonly height: number;
}

interface Segment {
  readonly items: readonly LayoutItem[];
  readonly x: number;
  readonly right: number;
  readonly y: number;
  readonly size: number;
}

interface Line {
  readonly text: string;
  readonly x: number;
  readonly right: number;
  readonly y: number;
  readonly size: number;
  /** Tiene celdas separadas por huecos grandes (una fila de tabla). */
  readonly tabular: boolean;
}

/** Diferencia de ángulo (radianes) para considerar que dos textos van en la misma dirección. */
const SAME_DIRECTION = 0.05;
/** Separación vertical máxima entre textos de una misma línea, relativa a la fuente (admite superíndices). */
const SAME_LINE = 0.5;
/** Hueco horizontal que separa dos palabras, relativo a la fuente. */
const WORD_GAP = 0.2;
/** Hueco horizontal que separa dos celdas o columnas de una línea, relativo a la fuente. */
const CELL_GAP = 3;
/** Ancho mínimo del pasillo entre dos columnas, relativo a la fuente. */
const GUTTER = 1.5;
/** Una línea más ancha que esta fracción del texto (un título) no cuenta para buscar columnas. */
const WIDE_LINE = 0.6;
/** Una columna de verdad tiene al menos estas líneas, de al menos estos caracteres de mediana (descarta tablas). */
const MIN_COLUMN_LINES = 3;
const MIN_COLUMN_CHARS = 20;
/** Interlineado que marca un punto y aparte, relativo al habitual del bloque. */
const PARAGRAPH_GAP = 1.35;
/** Con solo dos líneas no hay interlineado habitual: se compara con la fuente. */
const LONE_GAP = 1.8;
/** Cambio relativo de tamaño de fuente que separa un título del texto. */
const SIZE_CHANGE = 0.15;
/** Sangría mínima, relativa a la fuente. */
const INDENT = 0.7;
/** Parte del ancho del bloque que una línea puede quedarse corta sin que eso indique un fin de párrafo. */
const RAGGED_SLACK = 0.12;
const LIST_MARKER = /^(?:[•·▪◦‣*–—-]\s|\d{1,3}[.)]\s|[a-zA-Z][.)]\s)/u;
const LINE_END_HYPHEN = /\p{L}[-­‐]$/u;
const LOWERCASE_START = /^\p{Ll}/u;

/** Convierte un ítem de texto de pdf.js (coordenadas con la `y` hacia arriba). */
export function layoutItemFromPdf(item: PdfTextItem): LayoutItem {
  const [a = 1, b = 0, c = 0, d = 1, e = 0, f = 0] = item.transform;
  return {
    text: item.str,
    x: e,
    y: -f,
    width: item.width,
    size: Math.hypot(c, d) || item.height,
    rotation: Math.atan2(-b, a),
  };
}

/** Texto de los párrafos en orden de lectura, separados por una línea en blanco. */
export function paragraphText(items: readonly LayoutItem[]): string {
  return paragraphsOf(items).join('\n\n');
}

/** Párrafos en orden de lectura. Los textos en otra dirección que la principal (marcas de agua) van al final. */
export function paragraphsOf(items: readonly LayoutItem[]): readonly string[] {
  const visible = items.filter((item) => item.text.trim() !== '');
  const angle = dominantRotation(visible);
  const main = visible.filter((item) => sameDirection(item.rotation, angle)).map((item) => unrotated(item, angle));
  const others = visible.filter((item) => !sameDirection(item.rotation, angle));
  const blocks = readingBlocks(segmentsOf(main));
  return [...blocks.flatMap((block) => paragraphsOfLines(linesOf(block))), ...others.map((item) => clean(item.text))];
}

/** Dirección que reúne más texto. */
function dominantRotation(items: readonly LayoutItem[]): number {
  const totals = new Map<number, number>();
  for (const item of items) {
    const key = [...totals.keys()].find((angle) => sameDirection(angle, item.rotation)) ?? item.rotation;
    totals.set(key, (totals.get(key) ?? 0) + item.text.length);
  }
  let best = 0;
  let bestTotal = -1;
  for (const [angle, total] of totals) {
    if (total > bestTotal) {
      best = angle;
      bestTotal = total;
    }
  }
  return best;
}

function sameDirection(a: number, b: number): boolean {
  const diff = Math.abs(a - b) % (2 * Math.PI);
  return Math.min(diff, 2 * Math.PI - diff) < SAME_DIRECTION;
}

/** Gira el ítem para que su texto quede en horizontal. */
function unrotated(item: LayoutItem, angle: number): LayoutItem {
  if (angle === 0) return item;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  return { ...item, x: item.x * cos + item.y * sin, y: item.y * cos - item.x * sin, rotation: 0 };
}

/** Agrupa los ítems por línea base y parte cada línea por los huecos grandes. */
function segmentsOf(items: readonly LayoutItem[]): readonly Segment[] {
  const sorted = [...items].sort((a, b) => a.y - b.y);
  const segments: Segment[] = [];
  let row: LayoutItem[] = [];
  const flush = (): void => {
    segments.push(...splitRow(row));
    row = [];
  };
  for (const item of sorted) {
    const first = row[0];
    if (first !== undefined && item.y - first.y > SAME_LINE * Math.min(first.size, item.size)) flush();
    row.push(item);
  }
  flush();
  return segments;
}

function splitRow(row: readonly LayoutItem[]): readonly Segment[] {
  const segments: Segment[] = [];
  let current: LayoutItem[] = [];
  let right = -Infinity;
  const flush = (): void => {
    const first = current[0];
    if (first !== undefined) {
      segments.push({ items: current, x: first.x, right, y: first.y, size: Math.max(...current.map((i) => i.size)) });
    }
    current = [];
  };
  for (const item of [...row].sort((a, b) => a.x - b.x)) {
    const previous = current[current.length - 1];
    // Negrita simulada: el mismo texto se pinta dos veces casi en el mismo sitio.
    if (previous?.text === item.text && Math.abs(previous.x - item.x) < WORD_GAP * item.size) continue;
    if (previous !== undefined && item.x - right > CELL_GAP * item.size) {
      flush();
      right = -Infinity;
    }
    current.push(item);
    right = Math.max(right, item.x + item.width);
  }
  flush();
  return segments;
}

/** Bloques en orden de lectura. Con columnas: cada banda entre títulos anchos se lee columna a columna. */
function readingBlocks(segments: readonly Segment[]): readonly (readonly Segment[])[] {
  const gutter = findGutter(segments);
  if (gutter === null) return segments.length > 0 ? [segments] : [];
  const blocks: (readonly Segment[])[] = [];
  let left: Segment[] = [];
  let right: Segment[] = [];
  const flush = (): void => {
    blocks.push(...readingBlocks(left), ...readingBlocks(right));
    left = [];
    right = [];
  };
  for (const segment of segments) {
    if (segment.x < gutter && segment.right > gutter) {
      flush();
      blocks.push([segment]);
    } else if (segment.right <= gutter) {
      left.push(segment);
    } else {
      right.push(segment);
    }
  }
  flush();
  return blocks;
}

/** Posición del pasillo vertical entre dos columnas, o `null` si el texto no está en columnas. */
function findGutter(segments: readonly Segment[]): number | null {
  if (segments.length < 2 * MIN_COLUMN_LINES) return null;
  const textLeft = Math.min(...segments.map((s) => s.x));
  const textRight = Math.max(...segments.map((s) => s.right));
  const body = segments
    .filter((s) => s.right - s.x <= WIDE_LINE * (textRight - textLeft))
    .sort((a, b) => a.x - b.x);
  let reach = -Infinity;
  for (const segment of body) {
    if (reach !== -Infinity && segment.x - reach >= GUTTER * segment.size) {
      const gutter = (segment.x + reach) / 2;
      if (isColumnSplit(body, gutter)) return gutter;
    }
    reach = Math.max(reach, segment.right);
  }
  return null;
}

function isColumnSplit(body: readonly Segment[], gutter: number): boolean {
  const left = body.filter((s) => s.right <= gutter);
  const right = body.filter((s) => s.x >= gutter);
  if (!isColumn(left) || !isColumn(right)) return false;
  const overlapTop = Math.max(Math.min(...left.map((s) => s.y)), Math.min(...right.map((s) => s.y)));
  const overlapBottom = Math.min(Math.max(...left.map((s) => s.y)), Math.max(...right.map((s) => s.y)));
  return overlapTop < overlapBottom;
}

function isColumn(segments: readonly Segment[]): boolean {
  if (segments.length < MIN_COLUMN_LINES) return false;
  const lengths = segments.map((s) => s.items.reduce((sum, item) => sum + item.text.length, 0));
  return lowerMedian(lengths) >= MIN_COLUMN_CHARS;
}

/** Une los segmentos de un bloque en líneas: los huecos pequeños son espacios, los grandes, tabuladores. */
function linesOf(block: readonly Segment[]): readonly Line[] {
  const lines: Line[] = [];
  let row: Segment[] = [];
  const flush = (): void => {
    if (row.length > 0) lines.push(lineOf(row));
    row = [];
  };
  for (const segment of block) {
    const first = row[0];
    if (first !== undefined && segment.y - first.y > SAME_LINE * Math.min(first.size, segment.size)) flush();
    row.push(segment);
  }
  flush();
  return lines;
}

function lineOf(row: readonly Segment[]): Line {
  const cells = [...row].sort((a, b) => a.x - b.x);
  const first = cells[0];
  if (first === undefined) throw new Error('lineOf: línea sin segmentos');
  return {
    text: cells.map(segmentText).join('\t'),
    x: first.x,
    right: Math.max(...cells.map((cell) => cell.right)),
    y: first.y,
    size: Math.max(...cells.map((cell) => cell.size)),
    tabular: cells.length > 1,
  };
}

function segmentText(segment: Segment): string {
  let text = '';
  let right = -Infinity;
  for (const item of segment.items) {
    const piece = clean(item.text);
    const gapped = right !== -Infinity && item.x - right > WORD_GAP * item.size;
    if (gapped && !text.endsWith(' ') && !piece.startsWith(' ')) text += ' ';
    text += text.endsWith(' ') ? piece.trimStart() : piece;
    right = Math.max(right, item.x + item.width);
  }
  return text.trim();
}

/** Sin caracteres nulos ni blancos repetidos. */
function clean(text: string): string {
  return text.replace(/\0/gu, '').replace(/\s+/gu, ' ');
}

function paragraphsOfLines(lines: readonly Line[]): readonly string[] {
  const gaps = lines.slice(1).map((line, i) => line.y - (lines[i]?.y ?? line.y));
  const usualGap = gaps.length > 0 ? lowerMedian(gaps) : 0;
  const left = Math.min(...lines.map((line) => line.x));
  const right = Math.max(...lines.map((line) => line.right));

  const paragraphs: string[] = [];
  let text = '';
  let count = 0;
  let previous: Line | null = null;
  for (const line of lines) {
    if (previous === null) {
      text = line.text;
      count = 1;
    } else if (previous.tabular && line.tabular && !isGapBreak(previous, line, usualGap, gaps.length)) {
      text += `\n${line.text}`;
      count += 1;
    } else if (startsParagraph(previous, line, { text, count, left, right, usualGap, gapCount: gaps.length })) {
      paragraphs.push(text);
      text = line.text;
      count = 1;
    } else {
      text = joinLines(text, line.text);
      count += 1;
    }
    previous = line;
  }
  if (previous !== null) paragraphs.push(text);
  return paragraphs;
}

interface BlockContext {
  /** Texto del párrafo en curso y cuántas líneas lleva. */
  readonly text: string;
  readonly count: number;
  readonly left: number;
  readonly right: number;
  readonly usualGap: number;
  readonly gapCount: number;
}

function startsParagraph(previous: Line, line: Line, block: BlockContext): boolean {
  if (previous.tabular || line.tabular) return true;
  if (isGapBreak(previous, line, block.usualGap, block.gapCount)) return true;
  const sizeChange = Math.abs(previous.size - line.size) / Math.max(previous.size, line.size);
  if (sizeChange > SIZE_CHANGE) return true;
  if (LIST_MARKER.test(line.text)) return true;

  const margin = INDENT * line.size;
  const inList = LIST_MARKER.test(block.text);
  if (!inList && line.x - previous.x > margin && previous.x - block.left < margin) return true;
  if (previous.x - line.x > margin && block.count > 1) return true;
  return !LINE_END_HYPHEN.test(previous.text) && nextWordFits(previous, line, block);
}

function isGapBreak(previous: Line, line: Line, usualGap: number, gapCount: number): boolean {
  const gap = line.y - previous.y;
  return gap > PARAGRAPH_GAP * usualGap || (gapCount === 1 && gap > LONE_GAP * line.size);
}

/**
 * Si la primera palabra de `line` cabía de sobra al final de `previous`, el salto de línea fue intencionado. El margen
 * evita cortar los párrafos sin justificar, cuyas líneas acaban a distinta altura sin que eso signifique nada.
 */
function nextWordFits(previous: Line, line: Line, block: BlockContext): boolean {
  const word = line.text.split(/\s/u)[0] ?? '';
  const charWidth = (line.right - line.x) / Math.max(line.text.length, 1);
  const slack = RAGGED_SLACK * (block.right - block.left);
  return previous.right + (word.length + 1) * charWidth + slack < block.right;
}

function joinLines(text: string, next: string): string {
  if (LINE_END_HYPHEN.test(text) && LOWERCASE_START.test(next)) return `${text.slice(0, -1)}${next}`;
  return `${text.trimEnd()} ${next}`;
}

function lowerMedian(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor((sorted.length - 1) / 2)] ?? 0;
}
