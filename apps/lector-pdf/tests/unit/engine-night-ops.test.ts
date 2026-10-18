import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { IDENTITY, imageRects, type Matrix, type PaintStep } from '../../src/core/night';
import { AnnotationMode, getDocument, OPS } from '../../src/engine/pdfjs';
import { asMatrix, toPaintSteps, type OperatorListLike } from '../../src/engine/night-ops';
import { FIXTURES_DIR } from '../fixtures/paths.ts';
import { ensureFixtures } from '../fixtures/ensure.ts';

/** Lista de operadores sintética con las mismas posiciones en `fnArray` y `argsArray`. */
function listOf(...ops: readonly (readonly [number, unknown])[]): OperatorListLike {
  return { fnArray: ops.map(([fn]) => fn), argsArray: ops.map(([, args]) => args) };
}

describe('night-ops · asMatrix', () => {
  it('acepta arrays y typed arrays de 6 números finitos', () => {
    expect(asMatrix([1, 0, 0, 1, 2, 3])).toEqual([1, 0, 0, 1, 2, 3]);
    expect(asMatrix(new Float32Array([1, 0, 0, 1, 2, 3]))).toEqual([1, 0, 0, 1, 2, 3]);
    expect(asMatrix(new Float64Array([1, 0, 0, 1, 2, 3]))).toEqual([1, 0, 0, 1, 2, 3]);
  });

  it('rechaza longitud distinta de 6, no finitos y valores que no son listas', () => {
    expect(asMatrix([1, 0, 0, 1, 2])).toBeNull();
    expect(asMatrix([1, 0, 0, 1, 2, Number.NaN])).toBeNull();
    expect(asMatrix([1, 0, 0, 1, 2, '3'])).toBeNull();
    expect(asMatrix(null)).toBeNull();
    expect(asMatrix(undefined)).toBeNull();
    expect(asMatrix('1,0,0,1,2,3')).toBeNull();
  });
});

describe('night-ops · toPaintSteps', () => {
  const m: Matrix = [2, 0, 0, 2, 0, 0];

  it('save, restore, grupos y formularios se traducen a pilas equilibradas', () => {
    const steps = toPaintSteps(
      listOf(
        [OPS.save, []],
        [OPS.restore, []],
        [OPS.beginGroup, []],
        [OPS.endGroup, []],
        [OPS.paintFormXObjectBegin, [[2, 0, 0, 2, 0, 0], [0, 0, 1, 1]]],
        [OPS.paintFormXObjectEnd, []],
      ),
    );
    expect(steps).toEqual<PaintStep[]>([
      { kind: 'save' },
      { kind: 'restore' },
      { kind: 'save' },
      { kind: 'restore' },
      { kind: 'save' },
      { kind: 'transform', m },
      { kind: 'restore' },
    ]);
  });

  it('paintFormXObjectBegin sin matriz solo apila', () => {
    expect(toPaintSteps(listOf([OPS.paintFormXObjectBegin, [null, null]]))).toEqual([{ kind: 'save' }]);
  });

  it('transform aplica sus 6 números; con argumentos inválidos se ignora', () => {
    expect(toPaintSteps(listOf([OPS.transform, m]))).toEqual([{ kind: 'transform', m }]);
    expect(toPaintSteps(listOf([OPS.transform, [1, 2, 3]]))).toEqual([]);
  });

  it('beginAnnotation apila, resetea a la base y aplica sus dos matrices; endAnnotation desapila', () => {
    const transform: Matrix = [1, 0, 0, -1, 0, 842];
    const matrix: Matrix = [1, 0, 0, 1, 10, 10];
    const steps = toPaintSteps(
      listOf(
        [OPS.beginAnnotation, ['id', [0, 0, 1, 1], transform, matrix, true, 'c']],
        [OPS.endAnnotation, []],
      ),
    );
    expect(steps).toEqual<PaintStep[]>([
      { kind: 'save' },
      { kind: 'resetToBase' },
      { kind: 'transform', m: transform },
      { kind: 'transform', m: matrix },
      { kind: 'restore' },
    ]);
  });

  it('paintImageXObject y paintInlineImageXObject emiten una imagen con la identidad', () => {
    expect(toPaintSteps(listOf([OPS.paintImageXObject, ['Im0']]))).toEqual([{ kind: 'image', m: IDENTITY }]);
    expect(toPaintSteps(listOf([OPS.paintInlineImageXObject, [{}]]))).toEqual([{ kind: 'image', m: IDENTITY }]);
  });

  it('paintImageXObjectRepeat con 2 posiciones emite 2 imágenes', () => {
    const steps = toPaintSteps(listOf([OPS.paintImageXObjectRepeat, ['Im0', 10, 20, [1, 2, 3, 4]]]));
    expect(steps).toEqual<PaintStep[]>([
      { kind: 'image', m: [10, 0, 0, 20, 1, 2] },
      { kind: 'image', m: [10, 0, 0, 20, 3, 4] },
    ]);
  });

  it('paintInlineImageXObjectGroup emite una imagen por elemento con transform', () => {
    const steps = toPaintSteps(
      listOf([OPS.paintInlineImageXObjectGroup, [{}, [{ transform: [5, 0, 0, 5, 0, 0] }, { transform: [6, 0, 0, 6, 1, 1] }]]]),
    );
    expect(steps).toEqual<PaintStep[]>([
      { kind: 'image', m: [5, 0, 0, 5, 0, 0] },
      { kind: 'image', m: [6, 0, 0, 6, 1, 1] },
    ]);
  });

  it('las máscaras de imagen y el resto de operadores no emiten pasos', () => {
    expect(
      toPaintSteps(
        listOf(
          [OPS.paintImageMaskXObject, ['Mask', 1, 1]],
          [OPS.paintSolidColorImageMask, []],
          [OPS.paintImageMaskXObjectRepeat, [1, 1, [0, 0]]],
          [OPS.moveTo, [0, 0]],
          [OPS.fill, []],
        ),
      ),
    ).toEqual([]);
  });

  it('una lista con argumentos inválidos no lanza', () => {
    expect(() =>
      toPaintSteps(
        listOf(
          [OPS.paintImageXObjectRepeat, [null]],
          [OPS.paintInlineImageXObjectGroup, [null, 'no-lista']],
          [OPS.beginAnnotation, null],
        ),
      ),
    ).not.toThrow();
  });
});

describe('night-ops · integración con pdf.js (Node)', () => {
  it('images-200.pdf: la imagen de la página 1 ocupa su rectángulo en un lienzo de 612×792 (tamaño real de la página)', async () => {
    ensureFixtures();
    const data = new Uint8Array(readFileSync(join(FIXTURES_DIR, 'images-200.pdf')));
    const task = getDocument({ data, verbosity: 0 });
    const doc = await task.promise;
    try {
      const page = await doc.getPage(1);
      const list = await page.getOperatorList({ intent: 'display', annotationMode: AnnotationMode.ENABLE_STORAGE });
      const viewport = page.getViewport({ scale: 1 });
      const vt = asMatrix(viewport.transform);
      expect(vt).not.toBeNull();
      if (vt === null) return;
      // La página mide 612×792 (viewport [1,0,0,-1,0,792]) y la imagen tiene y0 = 450 con alto 267: arriba = 792 - 717.
      // La ficha PDF-020 pone y = 125 con un lienzo de 595×842, cifras que no corresponden a este fichero.
      const rects = imageRects(toPaintSteps(list), vt, 612, 792);
      expect(rects).toEqual([{ x: 97, y: 75, width: 400, height: 267 }]);
    } finally {
      await task.destroy();
    }
  });
});
