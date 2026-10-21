import { describe, expect, it } from 'vitest';
import { lineHintAt, type TextItemLike } from '../../src/engine/line-hint';

/** Ítem horizontal en (x, base) con la anchura y altura dadas. */
function item(str: string, x: number, base: number, width: number, height = 18): TextItemLike {
  return { str, transform: [1, 0, 0, 1, x, base], width, height };
}

/**
 * Línea de la especificación: «Texto de» (100–150), «búsqueda» (155–215), «en la página dos.» (220–320), todos en
 * la base 676 con h = 18 y huecos de 5 pt; «Arriba» a 22 pt por encima; «lejos» a 40 pt de hueco.
 */
function specLine(): TextItemLike[] {
  return [
    item('Texto de', 100, 676, 50),
    item('búsqueda', 155, 676, 60),
    item('en la página dos.', 220, 676, 100),
    item('Arriba', 100, 698, 50),
    item('lejos', 360, 676, 40),
  ];
}

describe('lineHintAt', () => {
  it('devuelve los ítems de la misma línea base al pulsar en el segundo, con su texto y su caja', () => {
    const result = lineHintAt(specLine(), [180, 680]);
    expect(result).not.toBeNull();
    expect(result?.text).toBe('Texto de búsqueda en la página dos.');
    const [x0, y0, x1, y1] = result?.hint ?? [0, 0, 0, 0];
    expect(x0).toBeCloseTo(99.5, 6);
    expect(x1).toBeCloseTo(320.5, 6);
    expect(y0).toBeCloseTo(674.2, 6);
    expect(y1).toBeCloseTo(686.8, 6);
  });

  it('no incluye un ítem a 40 pt de hueco (más de una altura) ni el de otra línea', () => {
    const result = lineHintAt(specLine(), [380, 680]);
    expect(result?.text).toBe('lejos');
    expect(result?.hint[0]).toBeCloseTo(359.5, 6);
  });

  it('amplía a la derecha cuando se pulsa el primer ítem y a la izquierda cuando se pulsa el último', () => {
    expect(lineHintAt(specLine(), [110, 680])?.text).toBe('Texto de búsqueda en la página dos.');
    expect(lineHintAt(specLine(), [250, 680])?.text).toBe('Texto de búsqueda en la página dos.');
  });

  it('devuelve null si el clic cae fuera de todo texto', () => {
    expect(lineHintAt(specLine(), [0, 0])).toBeNull();
    expect(lineHintAt([], [0, 0])).toBeNull();
  });

  it('ignora los ítems que solo tienen espacios al elegir el ítem pulsado', () => {
    // El espacio de 100 a 120 es un ítem en blanco: el clic cae en él y en «Hola», que es el pulsado.
    const items = [item('   ', 100, 676, 20), item('Hola', 120, 676, 40)];
    expect(lineHintAt(items, [125, 680])?.text).toBe('   Hola');
    expect(lineHintAt(items, [105, 680])).toBeNull();
    expect(lineHintAt([item(' ', 100, 676, 20)], [105, 680])).toBeNull();
  });

  it('ignora los ítems girados: no se pueden pulsar ni forman parte de la línea', () => {
    const rotated: TextItemLike = { str: 'girado', transform: [0, 1, -1, 0, 100, 676], width: 50, height: 18 };
    expect(lineHintAt([rotated], [110, 680])).toBeNull();
    const items = [item('Recto', 100, 676, 40), { ...rotated, transform: [0, 1, -1, 0, 145, 676] }];
    expect(lineHintAt(items, [110, 680])?.text).toBe('Recto');
  });

  it('usa la altura de la matriz cuando el ítem no declara altura', () => {
    const items: TextItemLike[] = [{ str: 'Alto', transform: [1, 0, 0, 18, 100, 676], width: 40, height: 0 }];
    const result = lineHintAt(items, [110, 680]);
    expect(result?.hint[1]).toBeCloseTo(674.2, 6);
    expect(result?.hint[3]).toBeCloseTo(686.8, 6);
  });

  it('inserta un espacio entre ítems con hueco mayor que 0,15 altura y sin espacio en el borde', () => {
    const items = [item('uno', 100, 676, 30), item('dos', 135, 676, 30)];
    expect(lineHintAt(items, [110, 680])?.text).toBe('uno dos');
  });

  it('no inserta espacio con un hueco pequeño ni si ya hay espacio en un borde', () => {
    const tight = [item('a', 100, 676, 10), item('b', 111, 676, 10)];
    expect(lineHintAt(tight, [105, 680])?.text).toBe('ab');
    const spaced = [item('uno ', 100, 676, 35), item('dos', 140, 676, 30)];
    expect(lineHintAt(spaced, [105, 680])?.text).toBe('uno dos');
    const leading = [item('uno', 100, 676, 30), item(' dos', 135, 676, 30)];
    expect(lineHintAt(leading, [105, 680])?.text).toBe('uno dos');
  });

  it('acepta una línea base con una pequeña desviación y no incluye la que la supera', () => {
    const near = [item('alta', 100, 676, 40), item('ligera', 145, 678, 40)];
    expect(lineHintAt(near, [110, 680])?.text).toBe('alta ligera');
    const far = [item('alta', 100, 676, 40), item('mas alta', 145, 690, 40)];
    expect(lineHintAt(far, [110, 680])?.text).toBe('alta');
  });
});
