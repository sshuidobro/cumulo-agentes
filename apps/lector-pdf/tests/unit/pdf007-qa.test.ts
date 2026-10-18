import { describe, expect, it } from 'vitest';
import { RenderQueue } from '../../src/core/render-queue';
import { MAX_ZOOM, nextZoom, parseZoomInput, resolveZoom, wheelZoom, ZOOM_STEPS, formatZoom } from '../../src/core/zoom';
import { planCanvas } from '../../src/core/canvas-size';

describe('PDF-007 QA adversarial', () => {
  it('nextZoom recorre todos los pasos sin saltos ni bucles', () => {
    let z = 0.1;
    const seen = [z];
    for (let i = 0; i < 40; i++) {
      const n = nextZoom(z, 1);
      if (n === z) break;
      z = n;
      seen.push(z);
    }
    expect(seen).toEqual([...ZOOM_STEPS]);
    for (let i = ZOOM_STEPS.length - 1; i > 0; i--)
      expect(nextZoom(ZOOM_STEPS[i] as number, -1)).toBe(ZOOM_STEPS[i - 1]);
  });
  it('parseZoomInput casos raros', () => {
    for (const t of ['', '  ', '%', '-', 'NaN', 'Infinity', '1e3x', '１５０']) expect(parseZoomInput(t)).toBeNull();
    expect(parseZoomInput('  150  % ')).toBe(1.5);
    expect(parseZoomInput('0')).toBe(0.1);
    expect(parseZoomInput('-50')).not.toBe(Number.NaN);
  });
  it('wheelZoom y formatZoom estables', () => {
    expect(wheelZoom(8, -1e5, 0)).toBe(MAX_ZOOM);
    expect(wheelZoom(1, 0, 0)).toBe(1);
    expect(formatZoom(0.675)).toMatch(/^\d+ %$/);
  });
  it('resolveZoom con viewport minúsculo hace clamp', () => {
    expect(
      resolveZoom(
        { kind: 'fit-width' },
        { width: 612, height: 792 },
        { width: 10, height: 10 },
        { width: 32, height: 32 },
      ),
    ).toBe(0.1);
  });
  it('planCanvas extremos', () => {
    const p = planCanvas(0, 0, 1);
    expect(p.width).toBeGreaterThanOrEqual(1);
    const q = planCanvas(10, 40000, 3);
    expect(q.height).toBeLessThanOrEqual(32767);
    expect(q.capped).toBe(true);
  });
  it('cola: cancelAll con en curso, luego request nuevo funciona y onIdle resuelve', async () => {
    const q = new RenderQueue(2);
    let active = 0,
      max = 0;
    const mk = (key: string, priority: number) => ({
      key,
      priority,
      run: (s: AbortSignal) =>
        new Promise<void>((res) => {
          active++;
          max = Math.max(max, active);
          const t = setTimeout(() => {
            active--;
            res();
          }, 5);
          s.addEventListener('abort', () => {
            clearTimeout(t);
            active--;
            res();
          });
        }),
    });
    for (let i = 0; i < 20; i++) q.request(mk('k' + (i % 5), i % 3));
    await Promise.resolve();
    q.cancelAll();
    expect(q.pendingCount).toBe(0);
    q.request(mk('z', 0));
    await q.onIdle();
    expect(q.runningCount).toBe(0);
    expect(max).toBeLessThanOrEqual(2);
  });
  it('cola: run que lanza síncrono no rompe; concurrencia inválida lanza', async () => {
    const q = new RenderQueue();
    let ran = false;
    q.request({
      key: 'a',
      priority: 0,
      run: () => {
        throw new Error('x');
      },
    });
    q.request({
      key: 'b',
      priority: 0,
      run: async () => {
        ran = true;
      },
    });
    await q.onIdle();
    expect(ran).toBe(true);
    expect(() => new RenderQueue(0)).toThrow(RangeError);
  });
  it('cola: setPriority reordena pendientes', async () => {
    const q = new RenderQueue(1);
    const order: string[] = [];
    const mk = (key: string, p: number) => ({
      key,
      priority: p,
      run: async () => {
        order.push(key);
      },
    });
    q.request(mk('a', 1));
    q.request(mk('b', 2));
    q.request(mk('c', 3));
    q.setPriority('c', 0);
    await q.onIdle();
    expect(order).toEqual(['c', 'a', 'b']);
  });
});
