import { describe, expect, it } from 'vitest';
import { layoutItemFromPdf, paragraphsOf, type LayoutItem } from '../../src/core/text/paragraphs';

const CHAR = 5;

/** Línea de texto en (x, y) con un ancho proporcional a sus caracteres. */
function at(x: number, y: number, text: string, size = 10): LayoutItem {
  return { text, x, y, width: text.length * CHAR, size, rotation: 0 };
}

const FULL = 'x'.repeat(80);

describe('paragraphsOf', () => {
  it('une las líneas de un párrafo y separa por el interlineado mayor', () => {
    const items = [at(0, 0, `${FULL} a`), at(0, 14, `${FULL} b`), at(0, 28, 'fin uno.'), at(0, 56, 'Otro párrafo.')];
    expect(paragraphsOf(items)).toEqual([`${FULL} a ${FULL} b fin uno.`, 'Otro párrafo.']);
  });

  it('quita el guion de una palabra partida entre líneas, pero no el de una mayúscula', () => {
    expect(paragraphsOf([at(0, 0, `${FULL} compro-`), at(0, 14, 'bación')])).toEqual([`${FULL} comprobación`]);
    expect(paragraphsOf([at(0, 0, `${FULL} ida-`), at(0, 14, 'Vuelta')])).toEqual([`${FULL} ida- Vuelta`]);
  });

  it('una sangría en la primera línea empieza párrafo sin espacio vertical', () => {
    const items = [at(0, 0, FULL), at(0, 14, FULL), at(18, 28, FULL), at(0, 42, FULL)];
    expect(paragraphsOf(items)).toEqual([`${FULL} ${FULL}`, `${FULL} ${FULL}`]);
  });

  it('una línea corta cuya siguiente palabra cabía termina el párrafo', () => {
    expect(paragraphsOf([at(0, 0, FULL), at(0, 14, 'corta'), at(0, 28, 'Otra línea')])).toEqual([`${FULL} corta`, 'Otra línea']);
  });

  it('un párrafo sin justificar no se corta por una línea algo más corta, ni por un guion final', () => {
    const shorter = 'x'.repeat(74);
    expect(paragraphsOf([at(0, 0, FULL), at(0, 14, shorter), at(0, 28, 'sigue')])).toEqual([`${FULL} ${shorter} sigue`]);
    expect(paragraphsOf([at(0, 0, FULL), at(0, 14, 'compro-'), at(0, 28, 'bación')])).toEqual([`${FULL} comprobación`]);
  });

  it('un título con otra fuente y cada elemento de una lista son párrafos propios', () => {
    const items = [at(0, 0, 'Título', 18), at(0, 24, FULL), at(0, 38, '1. Uno'), at(0, 52, '2. Dos')];
    expect(paragraphsOf(items)).toEqual(['Título', FULL, '1. Uno', '2. Dos']);
  });

  it('lee dos columnas una detrás de otra aunque el fichero las mezcle, con el título ancho delante', () => {
    const text = 'c'.repeat(30);
    const items: LayoutItem[] = [at(0, 0, 't'.repeat(90))];
    for (const i of [0, 1, 2, 3]) {
      items.push(at(300, 40 + i * 14, `D${String(i)}${text}`), at(0, 40 + i * 14, `I${String(i)}${text}`));
    }
    expect(paragraphsOf(items).join(' ')).toBe(
      ['t'.repeat(90), ...[0, 1, 2, 3].map((i) => `I${String(i)}${text}`), ...[0, 1, 2, 3].map((i) => `D${String(i)}${text}`)].join(' '),
    );
  });

  it('una tabla no se toma por columnas: sus filas siguen en una línea cada una', () => {
    const items = [0, 1, 2, 3].flatMap((i) => [at(0, i * 14, `n${String(i)}`), at(200, i * 14, `v${String(i)}`)]);
    expect(paragraphsOf(items)).toEqual(['n0\tv0\nn1\tv1\nn2\tv2\nn3\tv3']);
  });

  it('pone los espacios que faltan por la posición y no duplica la negrita simulada', () => {
    const items = [at(0, 0, 'Hola'), at(25, 0, 'mundo'), at(0.5, 0, 'Hola')];
    expect(paragraphsOf(items)).toEqual(['Hola mundo']);
  });

  it('ordena de izquierda a derecha los trozos desordenados de una línea', () => {
    expect(paragraphsOf([at(25, 0, 'mundo'), at(0, 0, 'Hola')])).toEqual(['Hola mundo']);
  });

  it('el texto en otra dirección (marca de agua) va al final', () => {
    const items = [{ ...at(100, 100, 'BORRADOR'), rotation: Math.PI / 4 }, at(0, 0, 'Texto principal del documento')];
    expect(paragraphsOf(items)).toEqual(['Texto principal del documento', 'BORRADOR']);
  });

  it('una página girada 90° se lee igual que sin girar', () => {
    const items = [at(0, 0, `${FULL} a`), at(0, 14, 'fin.'), at(0, 42, 'Otro.')].map((item) => ({
      ...item,
      x: -item.y,
      y: item.x,
      rotation: Math.PI / 2,
    }));
    expect(paragraphsOf(items)).toEqual([`${FULL} a fin.`, 'Otro.']);
  });

  it('sin texto, sin párrafos; los ítems en blanco no cuentan', () => {
    expect(paragraphsOf([])).toEqual([]);
    expect(paragraphsOf([at(0, 0, '   ')])).toEqual([]);
  });
});

describe('layoutItemFromPdf', () => {
  it('pasa la y a hacia abajo y saca el tamaño de la matriz', () => {
    expect(layoutItemFromPdf({ str: 'a', transform: [12, 0, 0, 12, 72, 700], width: 6, height: 12 })).toEqual({
      text: 'a',
      x: 72,
      y: -700,
      width: 6,
      size: 12,
      rotation: -0,
    });
  });
});
