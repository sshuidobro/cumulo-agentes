import { describe, expect, it } from 'vitest';
import { placeMenu } from '../../src/ui/kit/menu-placement';

const viewport = { width: 1000, height: 700 };
const menu = { width: 224, height: 300 };

describe('placeMenu', () => {
  it('con sitio, debajo del botón y alineado con su borde izquierdo', () => {
    expect(placeMenu({ left: 100, top: 10, bottom: 46 }, menu, viewport)).toEqual({ left: 100, top: 50, maxHeight: 642 });
  });

  it('junto al borde derecho se desplaza a la izquierda para caber', () => {
    expect(placeMenu({ left: 950, top: 10, bottom: 46 }, menu, viewport).left).toBe(1000 - 224 - 8);
  });

  it('un menú más ancho que la ventana se queda pegado al margen izquierdo', () => {
    expect(placeMenu({ left: 300, top: 10, bottom: 46 }, { width: 500, height: 100 }, { width: 400, height: 700 }).left).toBe(8);
  });

  it('sin sitio debajo y con más sitio encima, se abre hacia arriba', () => {
    expect(placeMenu({ left: 100, top: 600, bottom: 640 }, menu, viewport)).toEqual({ left: 100, top: 296, maxHeight: 588 });
  });

  it('si no cabe en ningún lado se limita la altura al lado con más sitio', () => {
    const placed = placeMenu({ left: 100, top: 10, bottom: 46 }, { width: 224, height: 900 }, viewport);
    expect(placed).toEqual({ left: 100, top: 50, maxHeight: 642 });
  });
});
