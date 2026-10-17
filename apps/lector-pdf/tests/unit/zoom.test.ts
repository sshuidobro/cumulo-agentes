import { describe, expect, it } from 'vitest';
import {
  AUTO_MAX_ZOOM,
  CSS_UNITS,
  DEFAULT_ZOOM_MODE,
  MAX_ZOOM,
  MIN_ZOOM,
  ZOOM_STEPS,
  clampZoom,
  fitZoom,
  formatZoom,
  nextZoom,
  parseZoomInput,
  resolveZoom,
  wheelZoom,
  zoomToScale,
} from '../../src/core/zoom';

const PAGE = { width: 612, height: 792 };
const VIEWPORT = { width: 1000, height: 800 };
const MARGIN = { width: 32, height: 32 };

describe('constantes de zoom', () => {
  it('usan 96/72 px CSS por punto y los pasos van de MIN a MAX en orden estricto', () => {
    expect(CSS_UNITS).toBeCloseTo(4 / 3, 12);
    expect(zoomToScale(1)).toBeCloseTo(4 / 3, 12);
    expect(ZOOM_STEPS[0]).toBe(MIN_ZOOM);
    expect(ZOOM_STEPS[ZOOM_STEPS.length - 1]).toBe(MAX_ZOOM);
    for (let i = 1; i < ZOOM_STEPS.length; i += 1) {
      expect(ZOOM_STEPS[i]).toBeGreaterThan(ZOOM_STEPS[i - 1] ?? Number.POSITIVE_INFINITY);
    }
  });

  it('el modo por defecto es automático', () => {
    expect(DEFAULT_ZOOM_MODE).toEqual({ kind: 'auto' });
  });
});

describe('clampZoom', () => {
  it('acota a [MIN_ZOOM, MAX_ZOOM] y deja intactos los valores válidos', () => {
    expect(clampZoom(0.01)).toBe(MIN_ZOOM);
    expect(clampZoom(20)).toBe(MAX_ZOOM);
    expect(clampZoom(1.5)).toBe(1.5);
  });

  it('rechaza valores no finitos', () => {
    expect(() => clampZoom(Number.NaN)).toThrow(RangeError);
    expect(() => clampZoom(Number.POSITIVE_INFINITY)).toThrow(RangeError);
  });
});

describe('nextZoom', () => {
  it('avanza y retrocede al paso estrictamente siguiente o anterior', () => {
    expect(nextZoom(1, 1)).toBe(1.1);
    expect(nextZoom(1.05, -1)).toBe(1);
    expect(nextZoom(1.1, -1)).toBe(1);
    expect(nextZoom(1, -1)).toBe(0.9);
    expect(nextZoom(0.5, 1)).toBe(0.67);
  });

  it('en el extremo devuelve el extremo', () => {
    expect(nextZoom(8, 1)).toBe(8);
    expect(nextZoom(MAX_ZOOM + 5, 1)).toBe(MAX_ZOOM);
    expect(nextZoom(0.1, -1)).toBe(0.1);
    expect(nextZoom(0.05, -1)).toBe(MIN_ZOOM);
  });

  it('no salta un paso por errores de coma flotante', () => {
    // 0.1 + 0.1 + 0.1 no es exactamente 0.3; el paso siguiente a 0.3 es 0.5.
    expect(nextZoom(0.1 + 0.1 + 0.1, 1)).toBe(0.5);
  });

  it('rechaza un zoom no finito', () => {
    expect(() => nextZoom(Number.NaN, 1)).toThrow(RangeError);
  });
});

describe('fitZoom', () => {
  it('ajusta el ancho descontando el margen', () => {
    expect(fitZoom('fit-width', PAGE, VIEWPORT, MARGIN)).toBeCloseTo(1.1863, 4);
  });

  it('ajusta la página completa: toma el menor de ancho y alto', () => {
    expect(fitZoom('fit-page', PAGE, VIEWPORT, MARGIN)).toBeCloseTo(0.7273, 4);
  });

  it('acota el resultado al rango válido', () => {
    expect(fitZoom('fit-width', PAGE, { width: 1, height: 1 }, MARGIN)).toBe(MIN_ZOOM);
    expect(fitZoom('fit-width', PAGE, { width: 100000, height: 1 }, MARGIN)).toBe(MAX_ZOOM);
  });

  it('en fit-page, si el alto manda, el resultado es el del alto', () => {
    expect(fitZoom('fit-page', PAGE, { width: 5000, height: 800 }, MARGIN)).toBeCloseTo(0.7273, 4);
  });
});

describe('resolveZoom', () => {
  it('auto usa el ajuste a ancho sin pasar de AUTO_MAX_ZOOM', () => {
    expect(resolveZoom({ kind: 'auto' }, PAGE, VIEWPORT, MARGIN)).toBeCloseTo(1.1863, 4);
    expect(resolveZoom({ kind: 'auto' }, PAGE, { width: 3000, height: 800 }, MARGIN)).toBe(AUTO_MAX_ZOOM);
    expect(AUTO_MAX_ZOOM).toBe(1.25);
  });

  it('fit-width y fit-page delegan en fitZoom', () => {
    expect(resolveZoom({ kind: 'fit-width' }, PAGE, VIEWPORT, MARGIN)).toBeCloseTo(1.1863, 4);
    expect(resolveZoom({ kind: 'fit-page' }, PAGE, VIEWPORT, MARGIN)).toBeCloseTo(0.7273, 4);
  });

  it('custom usa el zoom indicado, acotado', () => {
    expect(resolveZoom({ kind: 'custom', zoom: 2 }, PAGE, VIEWPORT, MARGIN)).toBe(2);
    expect(resolveZoom({ kind: 'custom', zoom: 50 }, PAGE, VIEWPORT, MARGIN)).toBe(MAX_ZOOM);
  });
});

describe('formatZoom', () => {
  it('muestra el porcentaje redondeado con espacio antes del %', () => {
    expect(formatZoom(1.25)).toBe('125 %');
    expect(formatZoom(0.67)).toBe('67 %');
    expect(formatZoom(1)).toBe('100 %');
  });
});

describe('parseZoomInput', () => {
  it('acepta números con o sin % y con coma decimal', () => {
    expect(parseZoomInput('150')).toBe(1.5);
    expect(parseZoomInput('150%')).toBe(1.5);
    expect(parseZoomInput('150 %')).toBe(1.5);
    expect(parseZoomInput('  75  ')).toBe(0.75);
    expect(parseZoomInput('150,5')).toBe(1.505);
  });

  it('devuelve null si no es un número', () => {
    expect(parseZoomInput('abc')).toBeNull();
    expect(parseZoomInput('')).toBeNull();
    expect(parseZoomInput('%')).toBeNull();
    expect(parseZoomInput('-50')).toBeNull();
    expect(parseZoomInput('1,2,3')).toBeNull();
  });

  it('acota lo que queda fuera de rango', () => {
    expect(parseZoomInput('5000')).toBe(8);
    expect(parseZoomInput('1')).toBe(0.1);
    expect(parseZoomInput('0')).toBe(MIN_ZOOM);
  });
});

describe('wheelZoom', () => {
  it('multiplica por exp(-deltaY * k) según la unidad del evento', () => {
    expect(wheelZoom(1, -100, 0)).toBeCloseTo(1.2214, 4);
    expect(wheelZoom(1, 100, 0)).toBeCloseTo(0.8187, 4);
    expect(wheelZoom(1, -1, 1)).toBeCloseTo(1.0513, 4);
    expect(wheelZoom(1, 1, 2)).toBeCloseTo(0.6065, 4);
  });

  it('acota el resultado: líneas grandes en páginas llevan al mínimo', () => {
    expect(wheelZoom(1, 100, 1)).toBe(MIN_ZOOM);
    expect(wheelZoom(8, -100, 0)).toBe(MAX_ZOOM);
  });

  it('rechaza un deltaY no finito', () => {
    expect(() => wheelZoom(1, Number.NaN, 0)).toThrow(RangeError);
  });
});
