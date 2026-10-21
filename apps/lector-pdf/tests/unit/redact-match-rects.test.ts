import { describe, expect, it } from 'vitest';
import { matchRects } from '../../src/engine/match-rects';
import type { PDFDocumentProxy } from '../../src/engine/pdfjs';
import type { SearchMatch } from '../../src/core/search/find';

interface FakeItem {
  readonly str: string;
  readonly width: number;
  readonly height: number;
  readonly transform: readonly number[];
}

/** Documento de pdf.js falso con una sola página cuyos ítems de texto son `items`. */
function fakeDoc(items: readonly FakeItem[]): PDFDocumentProxy {
  const page = {
    getTextContent: () =>
      Promise.resolve({
        items: items.map((item) => ({ ...item, dir: 'ltr', fontName: 'f', hasEOL: false })),
        styles: {},
      }),
  };
  return { getPage: () => Promise.resolve(page) } as unknown as PDFDocumentProxy;
}

/** Ítems de 10 pt de tamaño, sin rotar, en la línea de base y = 200. */
const LINE: readonly FakeItem[] = [
  { str: 'Hola ', width: 40, height: 10, transform: [10, 0, 0, 10, 100, 200] },
  { str: 'Página 3', width: 60, height: 10, transform: [10, 0, 0, 10, 140, 200] },
];

const span = (start: SearchMatch['start'], end: SearchMatch['end']): SearchMatch => ({ pageIndex: 0, start, end });

describe('matchRects (PDF-137)', () => {
  it('cubre solo el texto de la coincidencia dentro de un ítem, con altura 0,8/0,25 y 1 pt de margen', async () => {
    // «Página 3» empieza en el ítem 1, desplazamiento 0, y acaba en el 8: todo el ítem.
    const rects = await matchRects(fakeDoc(LINE), span({ item: 1, offset: 0 }, { item: 1, offset: 8 }));
    expect(rects).toHaveLength(1);
    const [rect] = rects;
    // x: 140..200 (+-1). y: 200-0,25*10 = 197,5 .. 200+0,8*10 = 208 (+-1).
    expect(rect).toEqual([139, 196.5, 201, 209]);
  });

  it('toma la parte proporcional del ancho cuando la coincidencia empieza dentro del ítem', async () => {
    // Desde el carácter 4 de «Página 3» (la «3») hasta el final: 4 de 8 caracteres, la mitad del ancho (30 pt).
    const rects = await matchRects(fakeDoc(LINE), span({ item: 1, offset: 4 }, { item: 1, offset: 8 }));
    const [rect] = rects;
    expect(rect?.[0]).toBeCloseTo(169, 6);
    expect(rect?.[2]).toBeCloseTo(201, 6);
  });

  it('une coincidencias que cruzan ítems: un rectángulo por ítem tocado', async () => {
    // Desde «la» de «Hola » (offset 2 del ítem 0) hasta «Pá» de «Página 3» (offset 2 del ítem 1).
    const rects = await matchRects(fakeDoc(LINE), span({ item: 0, offset: 2 }, { item: 1, offset: 2 }));
    expect(rects).toHaveLength(2);
    // Ítem 0: caracteres 2..5 de 5, es decir 24 pt a partir de x=100 (40 pt de ancho).
    expect(rects[0]?.[0]).toBeCloseTo(99 + 16, 6);
    expect(rects[0]?.[2]).toBeCloseTo(100 + 40 + 1, 6);
    // Ítem 1: caracteres 0..2 de 8, es decir 15 pt a partir de x=140.
    expect(rects[1]?.[0]).toBeCloseTo(139, 6);
    expect(rects[1]?.[2]).toBeCloseTo(140 + 15 + 1, 6);
  });

  it('sigue el transform: un texto girado 90° pone su caja en la dirección del texto', async () => {
    const vertical: readonly FakeItem[] = [{ str: 'AB', width: 20, height: 10, transform: [0, 10, -10, 0, 300, 100] }];
    const [rect] = await matchRects(fakeDoc(vertical), span({ item: 0, offset: 0 }, { item: 0, offset: 2 }));
    // El texto avanza hacia arriba (y crece de 100 a 120); la altura queda en x negativo (hacia la izquierda).
    expect(rect?.[1]).toBeCloseTo(99, 6);
    expect(rect?.[3]).toBeCloseTo(121, 6);
    expect(rect?.[0]).toBeCloseTo(300 - 8 - 1, 6);
    expect(rect?.[2]).toBeCloseTo(300 + 2.5 + 1, 6);
  });

  it('devuelve lista vacía si la coincidencia no cubre caracteres (vacía o fuera de los ítems)', async () => {
    expect(await matchRects(fakeDoc(LINE), span({ item: 1, offset: 3 }, { item: 1, offset: 3 }))).toEqual([]);
    expect(await matchRects(fakeDoc(LINE), span({ item: 9, offset: 0 }, { item: 9, offset: 2 }))).toEqual([]);
  });
});
