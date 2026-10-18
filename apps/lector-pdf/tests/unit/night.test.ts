import { describe, expect, it } from 'vitest';
import {
  applyMatrix,
  applyNightMode,
  IDENTITY,
  imageRects,
  multiply,
  NIGHT_PAGE_COLORS,
  parseHexColor,
  SCAN_COVERAGE,
  type Matrix,
  type PaintStep,
} from '../../src/core/night';

const image = (m: Matrix): PaintStep => ({ kind: 'image', m });

describe('night · matrices', () => {
  it('multiply aplica b primero (igual que ctx.transform)', () => {
    expect(multiply([2, 0, 0, 2, 0, 0], [1, 0, 0, -1, 0, 842])).toEqual([2, 0, 0, -2, 0, 1684]);
  });

  it('multiply con la identidad no cambia la matriz', () => {
    const m: Matrix = [0.5, 0.25, -1, 2, 30, -40];
    expect(multiply(IDENTITY, m)).toEqual(m);
    expect(multiply(m, IDENTITY)).toEqual(m);
  });

  it('applyMatrix transforma un punto', () => {
    expect(applyMatrix([1, 0, 0, -1, 0, 842], 97, 450)).toEqual([97, 392]);
  });
});

describe('night · imageRects', () => {
  it('una imagen de página normal da su rectángulo en píxeles', () => {
    const rects = imageRects([image([400, 0, 0, 267, 97, 450])], [1.5, 0, 0, -1.5, 0, 1263], 893, 1263);
    expect(rects).toEqual([{ x: 145, y: 187, width: 601, height: 401 }]);
  });

  it('save, transform, restore deshace la escala; la imagen siguiente usa la CTM restaurada', () => {
    const steps: PaintStep[] = [
      { kind: 'save' },
      { kind: 'transform', m: [2, 0, 0, 2, 0, 0] },
      { kind: 'restore' },
      image(IDENTITY),
    ];
    expect(imageRects(steps, IDENTITY, 100, 100)).toEqual([{ x: 0, y: 0, width: 1, height: 1 }]);
  });

  it('restore con la pila vacía no lanza y no cambia la CTM', () => {
    const steps: PaintStep[] = [{ kind: 'restore' }, image([10, 0, 0, 10, 5, 5])];
    expect(imageRects(steps, IDENTITY, 100, 100)).toEqual([{ x: 5, y: 5, width: 10, height: 10 }]);
  });

  it('resetToBase vuelve a la base aunque haya transformaciones pendientes', () => {
    const base: Matrix = [1, 0, 0, 1, 20, 30];
    const steps: PaintStep[] = [
      { kind: 'transform', m: [3, 0, 0, 3, 0, 0] },
      { kind: 'resetToBase' },
      image([10, 0, 0, 10, 0, 0]),
    ];
    expect(imageRects(steps, base, 100, 100)).toEqual([{ x: 20, y: 30, width: 10, height: 10 }]);
  });

  it('una imagen girada 45° da su rectángulo envolvente', () => {
    const rects = imageRects([image([0.7071068, 0.7071068, -0.7071068, 0.7071068, 10, 10])], IDENTITY, 100, 100);
    expect(rects).toEqual([{ x: 9, y: 10, width: 2, height: 2 }]);
  });

  it('una imagen que sale del lienzo se recorta', () => {
    expect(imageRects([image([50, 0, 0, 50, 80, 80])], IDENTITY, 100, 100)).toEqual([
      { x: 80, y: 80, width: 20, height: 20 },
    ]);
  });

  it('una imagen que cubre ≥ 85 % del lienzo (escaneado) se descarta; por debajo se conserva', () => {
    expect(SCAN_COVERAGE).toBe(0.85);
    expect(imageRects([image([90, 0, 0, 100, 0, 0])], IDENTITY, 100, 100)).toEqual([]);
    expect(imageRects([image([80, 0, 0, 100, 0, 0])], IDENTITY, 100, 100)).toEqual([
      { x: 0, y: 0, width: 80, height: 100 },
    ]);
  });

  it('una imagen fuera del lienzo o de área cero no genera rectángulo', () => {
    expect(imageRects([image([10, 0, 0, 10, 200, 200])], IDENTITY, 100, 100)).toEqual([]);
    expect(imageRects([image([0, 0, 0, 10, 5, 5])], IDENTITY, 100, 100)).toEqual([]);
  });

  it('devuelve los rectángulos en orden de aparición', () => {
    const rects = imageRects(
      [image([10, 0, 0, 10, 0, 0]), image([10, 0, 0, 10, 50, 50])],
      IDENTITY,
      100,
      100,
    );
    expect(rects.map((r) => r.x)).toEqual([0, 50]);
  });
});

describe('night · colores', () => {
  it('parseHexColor convierte #rrggbb', () => {
    expect(parseHexColor('#1f1f23')).toEqual([31, 31, 35]);
  });

  it('parseHexColor lanza con un formato distinto de #rrggbb', () => {
    expect(() => parseHexColor('red')).toThrow();
    expect(() => parseHexColor('#fff')).toThrow();
  });

  it('los colores por defecto son los de ADR-0015', () => {
    expect(NIGHT_PAGE_COLORS).toEqual({ background: '#1f1f23', foreground: '#e6e6e6' });
  });
});

describe('night · applyNightMode', () => {
  /** Un píxel RGBA (alfa 255 salvo que se indique). */
  function pixel(r: number, g: number, b: number, a = 255): number[] {
    return [r, g, b, a];
  }

  function applyTo(pixels: number[][], keep: Parameters<typeof applyNightMode>[3] = []): number[] {
    const data = new Uint8ClampedArray(pixels.flat());
    applyNightMode(data, pixels.length, 1, keep);
    return Array.from(data);
  }

  it('blanco pasa al fondo de noche (31, 31, 35)', () => {
    expect(applyTo([pixel(255, 255, 255)])).toEqual([31, 31, 35, 255]);
  });

  it('negro pasa al texto de noche (230, 230, 230)', () => {
    expect(applyTo([pixel(0, 0, 0)])).toEqual([230, 230, 230, 255]);
  });

  it('rojo puro conserva el tono: (230, 31, 35)', () => {
    expect(applyTo([pixel(255, 0, 0)])).toEqual([230, 31, 35, 255]);
  });

  it('gris medio pasa a (130, 130, 132)', () => {
    expect(applyTo([pixel(128, 128, 128)])).toEqual([130, 130, 132, 255]);
  });

  it('el alfa no cambia', () => {
    expect(applyTo([pixel(255, 255, 255, 17)])[3]).toBe(17);
  });

  it('los píxeles dentro de keep quedan idénticos y los de fuera cambian', () => {
    const width = 2;
    const height = 2;
    const original = [
      pixel(255, 0, 0), pixel(255, 255, 255),
      pixel(255, 255, 255), pixel(0, 0, 255),
    ];
    const data = new Uint8ClampedArray(original.flat());
    // Solo el píxel (1, 0) (blanco) pertenece a la imagen.
    applyNightMode(data, width, height, [{ x: 1, y: 0, width: 1, height: 1 }]);
    expect(Array.from(data.slice(4, 8))).toEqual([255, 255, 255, 255]);
    expect(Array.from(data.slice(0, 4))).toEqual([230, 31, 35, 255]);
    expect(Array.from(data.slice(8, 12))).toEqual([31, 31, 35, 255]);
  });

  it('un rectángulo keep de varias filas se restaura fila a fila', () => {
    const width = 3;
    const height = 2;
    const original = Array.from({ length: width * height }, () => pixel(10, 200, 30));
    const data = new Uint8ClampedArray(original.flat());
    applyNightMode(data, width, height, [{ x: 1, y: 0, width: 2, height: 2 }]);
    // Columna 0 cambia; columnas 1 y 2 de ambas filas se conservan.
    expect(Array.from(data.slice(0, 4))).not.toEqual([10, 200, 30, 255]);
    for (const i of [4, 8, 16, 20]) expect(Array.from(data.slice(i, i + 4))).toEqual([10, 200, 30, 255]);
  });

  it('con datos de longitud incorrecta lanza', () => {
    expect(() => {
      applyNightMode(new Uint8ClampedArray(7), 2, 1, []);
    }).toThrow();
  });

  it('con colores propios usa esa gama', () => {
    const data = new Uint8ClampedArray([255, 255, 255, 255]);
    applyNightMode(data, 1, 1, [], { background: '#000000', foreground: '#ffffff' });
    expect(Array.from(data)).toEqual([0, 0, 0, 255]);
  });
});
