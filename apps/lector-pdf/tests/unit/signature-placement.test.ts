import { describe, expect, it } from 'vitest';
import type { SignatureArt } from '../../src/core/annotations/model';
import {
  DEFAULT_SIGNATURE_WIDTH_PT,
  keyboardSignatureCenter,
  newSignatureAnnotation,
  resizeKeepingAspect,
  signatureAspect,
  signatureRectAt,
  viewPointToPage,
} from '../../src/core/signature/signature';

const INK_300X100: SignatureArt = { kind: 'ink', paths: [[0, 0, 300, 100]], width: 2, box: [300, 100] };
const IMAGE_300X100: SignatureArt = { kind: 'image', format: 'jpeg', data: 'AAAA', pixelWidth: 300, pixelHeight: 100 };
/** Página A4 en puntos. */
const A4: readonly [number, number, number, number] = [0, 0, 595, 842];

describe('signatureRectAt', () => {
  it('con un arte de 300 × 100 centrado en (100, 100) de A4 ocupa 150 × 50 pt: [25, 75, 175, 125]', () => {
    expect(signatureRectAt(INK_300X100, [100, 100], A4)).toEqual([25, 75, 175, 125]);
  });

  it('usa la proporción de una imagen (píxeles) igual que la de un trazo (caja)', () => {
    expect(signatureRectAt(IMAGE_300X100, [100, 100], A4)).toEqual([25, 75, 175, 125]);
    expect(signatureAspect(IMAGE_300X100)).toBe(3);
    expect(signatureAspect(INK_300X100)).toBe(3);
  });

  it('cerca del borde derecho se desplaza para quedar dentro de la página', () => {
    const [x1, , x2] = signatureRectAt(INK_300X100, [590, 100], A4);
    expect(x2).toBeLessThanOrEqual(595);
    expect(x2 - x1).toBe(DEFAULT_SIGNATURE_WIDTH_PT);
    expect(x2).toBe(595);
  });

  it('cerca del borde inferior se desplaza hacia arriba', () => {
    const [, y1, , y2] = signatureRectAt(INK_300X100, [100, 2], A4);
    expect(y1).toBe(0);
    expect(y2 - y1).toBeCloseTo(50);
  });
});

describe('resizeKeepingAspect', () => {
  it('con dx = 30 sobre 150 × 50 da 180 × 60 con la esquina superior izquierda fija', () => {
    expect(resizeKeepingAspect([10, 50, 160, 100], 'se', 30, 0)).toEqual([10, 40, 190, 100]);
  });

  it('con dy = 30 sobre 150 × 50 crece por el alto: 240 × 80', () => {
    expect(resizeKeepingAspect([10, 50, 160, 100], 'se', 0, 30)).toEqual([10, 20, 250, 100]);
  });

  it('nunca baja de 20 pt de ancho, y mantiene la proporción', () => {
    const [x1, y1, x2, y2] = resizeKeepingAspect([10, 50, 160, 100], 'se', -500, 0);
    expect(x2 - x1).toBe(20);
    expect(y2 - y1).toBeCloseTo(20 / 3);
    expect(x1).toBe(10);
    expect(y2).toBe(100);
  });
});

describe('keyboardSignatureCenter y viewPointToPage', () => {
  it('sin girar, la página se ve tal cual: el punto de vista (x, y) es (x, alto − y)', () => {
    expect(viewPointToPage(595, 842, 0, 10, 20)).toEqual([10, 822]);
  });

  it('girada 90°, el origen de la vista es la esquina inferior izquierda de la página', () => {
    expect(viewPointToPage(595, 842, 90, 0, 0)).toEqual([0, 0]);
    expect(viewPointToPage(595, 842, 90, 10, 20)).toEqual([20, 10]);
  });

  it('centra horizontalmente y coloca a un tercio de lo visible desde arriba', () => {
    // Borde superior visible en la parte alta de la página; la mitad de la página cabe en pantalla.
    const [x, y] = keyboardSignatureCenter(595, 842, 0, 0, 0.5);
    expect(x).toBeCloseTo(297.5);
    // Un tercio de 0,5 = 0,1667 de la página desde arriba: 842 × (1 − 0,1667) ≈ 701,7 pt.
    expect(y).toBeCloseTo(842 - 842 * (0.5 / 3));
  });

  it('no sale de la página aunque el borde superior visible esté al final', () => {
    const [, y] = keyboardSignatureCenter(595, 842, 0, 1, 1);
    expect(y).toBeGreaterThanOrEqual(0);
    expect(y).toBeLessThanOrEqual(842);
  });
});

describe('newSignatureAnnotation', () => {
  it('crea una firma negra, opaca, con comentario «Firma» y origen nuevo', () => {
    const a = newSignatureAnnotation({
      id: 'suite-s1',
      pageIndex: 2,
      rect: [25, 75, 175, 125],
      art: INK_300X100,
      author: 'Ana',
      now: '2026-10-18T10:00:00.000Z',
    });
    expect(a).toEqual({
      id: 'suite-s1',
      type: 'signature',
      pageIndex: 2,
      rect: [25, 75, 175, 125],
      art: INK_300X100,
      color: [0, 0, 0],
      opacity: 1,
      contents: 'Firma',
      author: 'Ana',
      modified: '2026-10-18T10:00:00.000Z',
      created: '2026-10-18T10:00:00.000Z',
      origin: { kind: 'new' },
    });
  });
});
