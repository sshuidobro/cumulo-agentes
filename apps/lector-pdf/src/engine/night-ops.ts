import type { Matrix, PaintStep } from '../core/night';
import { IDENTITY } from '../core/night';
import { pdfjs } from './pdfjs';

/** Forma mínima de la lista de operadores de pdf.js (`PDFPageProxy.getOperatorList`). */
export interface OperatorListLike {
  readonly fnArray: ArrayLike<number>;
  readonly argsArray: ArrayLike<unknown>;
}

/** Números finitos de un `Array` o de un `Float32Array`/`Float64Array`; `null` si no es una lista así. */
function finiteNumbers(v: unknown): readonly number[] | null {
  if (!Array.isArray(v) && !(v instanceof Float32Array) && !(v instanceof Float64Array)) return null;
  const values: unknown[] = Array.from(v as ArrayLike<unknown>);
  return values.every((x) => typeof x === 'number' && Number.isFinite(x)) ? (values as number[]) : null;
}

/** Matriz de 6 números finitos (`Array` o typed array); `null` si el valor no lo es. */
export function asMatrix(v: unknown): Matrix | null {
  const values = finiteNumbers(v);
  if (values === null || values.length !== 6) return null;
  const [a = 0, b = 0, c = 0, d = 0, e = 0, f = 0] = values;
  return [a, b, c, d, e, f];
}

/**
 * Traduce la lista de operadores de pdf.js a pasos de pintado para `imageRects`. Único sitio que conoce los
 * operadores. Los operadores de estructura (guardar/restaurar, formularios, grupos, anotaciones) siempre emiten
 * su `save`/`restore` para que las pilas queden equilibradas; un argumento inválido solo omite su transformación.
 * Las máscaras de imagen son tinta y no emiten nada.
 */
export function toPaintSteps(list: OperatorListLike): PaintStep[] {
  const OPS = pdfjs().OPS;
  const steps: PaintStep[] = [];
  const count = Math.min(list.fnArray.length, list.argsArray.length);

  const pushTransform = (m: unknown): void => {
    const matrix = asMatrix(m);
    if (matrix !== null) steps.push({ kind: 'transform', m: matrix });
  };

  for (let i = 0; i < count; i++) {
    const fn = list.fnArray[i];
    const args: unknown = list.argsArray[i];
    const a: readonly unknown[] = Array.isArray(args) ? args : [];

    switch (fn) {
      case OPS.save:
      case OPS.beginGroup:
      case OPS.paintFormXObjectBegin:
        steps.push({ kind: 'save' });
        if (fn === OPS.paintFormXObjectBegin) pushTransform(a[0]);
        break;
      case OPS.restore:
      case OPS.endGroup:
      case OPS.paintFormXObjectEnd:
      case OPS.endAnnotation:
        steps.push({ kind: 'restore' });
        break;
      case OPS.transform:
        pushTransform(args);
        break;
      case OPS.beginAnnotation:
        steps.push({ kind: 'save' }, { kind: 'resetToBase' });
        pushTransform(a[2]);
        pushTransform(a[3]);
        break;
      case OPS.paintImageXObject:
      case OPS.paintInlineImageXObject:
        steps.push({ kind: 'image', m: IDENTITY });
        break;
      case OPS.paintImageXObjectRepeat: {
        const scaleX = a[1];
        const scaleY = a[2];
        const positions = finiteNumbers(a[3]);
        if (typeof scaleX !== 'number' || typeof scaleY !== 'number' || positions === null) break;
        for (let p = 0; p + 1 < positions.length; p += 2) {
          steps.push({
            kind: 'image',
            m: [scaleX, 0, 0, scaleY, positions[p] ?? 0, positions[p + 1] ?? 0],
          });
        }
        break;
      }
      case OPS.paintInlineImageXObjectGroup: {
        const items: unknown = a[1];
        if (!Array.isArray(items)) break;
        for (const item of items as readonly unknown[]) {
          const transform = typeof item === 'object' && item !== null ? (item as { readonly transform?: unknown }).transform : undefined;
          const m = asMatrix(transform);
          if (m !== null) steps.push({ kind: 'image', m });
        }
        break;
      }
      default:
        // Máscaras de imagen, trazos, texto y el resto: son tinta o no afectan a la CTM de las imágenes.
        break;
    }
  }
  return steps;
}
