/**
 * Modo noche de las páginas (ADR-0015): lógica pura, sin pdf.js ni DOM.
 *
 * pdf.js dibuja la página normal; después se invierte la luminosidad de los píxeles del lienzo conservando el
 * tono, salvo los rectángulos de las imágenes. Este módulo calcula esos rectángulos a partir de los pasos de
 * pintado (`src/engine/night-ops.ts` los extrae de `getOperatorList`) y transforma los píxeles.
 */

export interface NightColors {
  /** Color que sustituye al blanco del papel. '#rrggbb'. */
  readonly background: string;
  /** Color que sustituye al negro del texto. '#rrggbb'. */
  readonly foreground: string;
}

/** Colores por defecto del modo noche: fondo gris muy oscuro y texto casi blanco (no blanco puro, menos deslumbrante). */
export const NIGHT_PAGE_COLORS = { background: '#1f1f23', foreground: '#e6e6e6' } as const satisfies NightColors;

/** Imagen que cubre al menos esta fracción del lienzo = página escaneada: se transforma como el resto. */
export const SCAN_COVERAGE = 0.85;

/** Matriz afín de canvas/PDF `[a, b, c, d, e, f]`. */
export type Matrix = readonly [number, number, number, number, number, number];

export interface PixelRect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/** Paso de pintado relevante para localizar imágenes. */
export type PaintStep =
  | { readonly kind: 'save' } // apila la CTM
  | { readonly kind: 'restore' } // desapila; si la pila está vacía, se ignora
  | { readonly kind: 'transform'; readonly m: Matrix } // CTM = multiply(CTM, m)
  | { readonly kind: 'resetToBase' } // CTM = base
  | { readonly kind: 'image'; readonly m: Matrix }; // imagen en el cuadrado unidad bajo multiply(CTM, m)

export const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0];

/** Producto de matrices: aplica `b` primero (igual que `ctx.transform`). */
export function multiply(a: Matrix, b: Matrix): Matrix {
  return [
    a[0] * b[0] + a[2] * b[1],
    a[1] * b[0] + a[3] * b[1],
    a[0] * b[2] + a[2] * b[3],
    a[1] * b[2] + a[3] * b[3],
    a[0] * b[4] + a[2] * b[5] + a[4],
    a[1] * b[4] + a[3] * b[5] + a[5],
  ];
}

/** Transforma el punto `(x, y)` con la matriz `m`. */
export function applyMatrix(m: Matrix, x: number, y: number): readonly [number, number] {
  return [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
}

/**
 * Rectángulos en píxeles del lienzo que ocupan las imágenes (en orden de aparición). Cada imagen es el cuadrado
 * unidad transformado: se redondea hacia fuera, se recorta al lienzo y se descarta si está vacío o si es una
 * página escaneada (cubre ≥ `SCAN_COVERAGE` del lienzo).
 */
export function imageRects(
  steps: Iterable<PaintStep>,
  base: Matrix,
  canvasWidth: number,
  canvasHeight: number,
): PixelRect[] {
  const rects: PixelRect[] = [];
  const stack: Matrix[] = [];
  let ctm: Matrix = base;
  const canvasArea = canvasWidth * canvasHeight;

  for (const step of steps) {
    switch (step.kind) {
      case 'save':
        stack.push(ctm);
        break;
      case 'restore': {
        const previous = stack.pop();
        if (previous !== undefined) ctm = previous;
        break;
      }
      case 'transform':
        ctm = multiply(ctm, step.m);
        break;
      case 'resetToBase':
        ctm = base;
        break;
      case 'image': {
        const m = multiply(ctm, step.m);
        const corners = [
          applyMatrix(m, 0, 0),
          applyMatrix(m, 1, 0),
          applyMatrix(m, 0, 1),
          applyMatrix(m, 1, 1),
        ];
        let minX = Infinity;
        let minY = Infinity;
        let maxX = -Infinity;
        let maxY = -Infinity;
        for (const [px, py] of corners) {
          minX = Math.min(minX, px);
          minY = Math.min(minY, py);
          maxX = Math.max(maxX, px);
          maxY = Math.max(maxY, py);
        }
        const x0 = Math.max(0, Math.floor(minX));
        const y0 = Math.max(0, Math.floor(minY));
        const x1 = Math.min(canvasWidth, Math.ceil(maxX));
        const y1 = Math.min(canvasHeight, Math.ceil(maxY));
        if (x1 <= x0 || y1 <= y0) break;
        const area = (x1 - x0) * (y1 - y0);
        if (area >= SCAN_COVERAGE * canvasArea) break;
        rects.push({ x: x0, y: y0, width: x1 - x0, height: y1 - y0 });
        break;
      }
    }
  }
  return rects;
}

const HEX_COLOR = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i;

/** Convierte '#rrggbb' en `[r, g, b]`. Un formato distinto es un bug de quien llama, no un error esperable. */
export function parseHexColor(hex: string): readonly [number, number, number] {
  const match = HEX_COLOR.exec(hex);
  if (match === null) throw new Error(`color no válido (se espera #rrggbb): ${hex}`);
  return [
    Number.parseInt(match[1] ?? '00', 16),
    Number.parseInt(match[2] ?? '00', 16),
    Number.parseInt(match[3] ?? '00', 16),
  ];
}

/**
 * Aplica el modo noche a `data` (RGBA, en el sitio). Invierte la luminosidad conservando el tono
 * (`c' = c + 255 - max - min`) y lleva el resultado a la gama entre `colors.foreground` (negro) y
 * `colors.background` (blanco). Los píxeles de `keep` no cambian. El alfa no cambia.
 */
export function applyNightMode(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  keep: readonly PixelRect[],
  colors: NightColors = NIGHT_PAGE_COLORS,
): void {
  if (data.length !== width * height * 4) {
    throw new Error(`applyNightMode: ${String(data.length)} bytes para ${String(width)}×${String(height)}`);
  }

  // 1. Copia de los píxeles que se conservan, fila a fila.
  const saved: { readonly start: number; readonly rows: readonly Uint8ClampedArray[] }[] = keep.map((rect) => {
    const rows: Uint8ClampedArray[] = [];
    for (let row = 0; row < rect.height; row++) {
      const start = ((rect.y + row) * width + rect.x) * 4;
      rows.push(data.slice(start, start + rect.width * 4));
    }
    return { start: (rect.y * width + rect.x) * 4, rows };
  });

  // 2. Tablas de consulta por canal: v (0..255) → valor en la gama de noche.
  const bg = parseHexColor(colors.background);
  const fg = parseHexColor(colors.foreground);
  const lutFor = (channel: 0 | 1 | 2): Uint8Array => {
    const lut = new Uint8Array(256);
    const from = bg[channel];
    const to = fg[channel];
    for (let v = 0; v < 256; v++) lut[v] = Math.round(from + ((to - from) * v) / 255);
    return lut;
  };
  const lutR = lutFor(0);
  const lutG = lutFor(1);
  const lutB = lutFor(2);

  // 3. Inversión de luminosidad conservando el tono; el alfa queda igual.
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i] ?? 0;
    const g = data[i + 1] ?? 0;
    const b = data[i + 2] ?? 0;
    const d = 255 - Math.max(r, g, b) - Math.min(r, g, b);
    data[i] = lutR[r + d] ?? 0;
    data[i + 1] = lutG[g + d] ?? 0;
    data[i + 2] = lutB[b + d] ?? 0;
  }

  // 4. Restaura las imágenes.
  for (const { start, rows } of saved) {
    let offset = start;
    for (const row of rows) {
      data.set(row, offset);
      offset += width * 4;
    }
  }
}
