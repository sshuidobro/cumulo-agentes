import { describe, expect, it } from 'vitest';
import { applyNightMode, type PixelRect } from '../../src/core/night';
import { measureBest } from './measure';

// Asserts de tiempo de reloj (ADR-0012 y ADR-0015): solo se ejecutan con `pnpm perf`.

describe('rendimiento del modo noche', () => {
  it('applyNightMode sobre 2 000 000 píxeles con una imagen de 400×267 tarda menos de 100 ms', () => {
    const width = 2000;
    const height = 1000;
    const data = new Uint8ClampedArray(width * height * 4);
    // Patrón determinista: el coste no depende de los valores, pero evita un lienzo uniforme.
    for (let i = 0; i < data.length; i++) data[i] = (i * 31) & 255;
    const keep: PixelRect[] = [{ x: 800, y: 300, width: 400, height: 267 }];

    const { ms } = measureBest(() => {
      applyNightMode(data, width, height, keep);
    });
    expect(ms).toBeLessThan(100);
  });
});
