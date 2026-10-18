// @vitest-environment jsdom
import { createElement } from 'react';
import { act, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import type { PageViewport } from '../../src/engine/pdfjs';
import { endAnnotationSession, select, addAnnotations } from '../../src/state/annotation-actions';
import { initialAnnotationState, useAnnotations } from '../../src/state/annotation-store';
import { AnnotationLayer } from '../../src/ui/viewer/AnnotationLayer';
import { newAnnotation } from '../unit/annotations/factories';
import { measureBest } from './measure';

// Asserts de tiempo de reloj (ADR-0012): solo con `pnpm perf`. Mide el coste de pintar una página con 500 anotaciones.
// Sin JSX a propósito: la suite de rendimiento solo recoge ficheros `*.perf.test.ts`.

const PAGE_ANNOTATIONS = 500;

function viewport(): PageViewport {
  return {
    width: 612,
    height: 792,
    transform: [1, 0, 0, -1, 0, 792],
    convertToPdfPoint: (x: number, y: number) => [x, 792 - y],
  } as unknown as PageViewport;
}

function layer() {
  return createElement(AnnotationLayer, { pageIndex: 0, viewport: viewport() });
}

afterEach(() => {
  endAnnotationSession();
  useAnnotations.setState(initialAnnotationState());
});

describe('rendimiento de la capa de anotaciones', () => {
  it('pintar una página con 500 anotaciones tarda menos de 100 ms (y cambiar la selección también)', () => {
    const list = Array.from({ length: PAGE_ANNOTATIONS }, (_, i) =>
      newAnnotation(`suite-${i}`, i % 2 === 0 ? 'highlight' : 'note', 0),
    );
    addAnnotations('añadir anotaciones de prueba', list);
    const first = list[0];
    if (first === undefined) throw new Error('lista vacía');

    const { ms: mount } = measureBest(() => {
      const { unmount } = render(layer());
      unmount();
    });
    expect(mount, `montar 500 anotaciones: ${mount.toFixed(1)} ms`).toBeLessThan(100);

    const screen = render(layer());
    const { ms: change } = measureBest(() => {
      act(() => {
        select(first.id);
      });
      act(() => {
        select(null);
      });
    });
    screen.unmount();
    expect(change, `cambiar la selección: ${change.toFixed(1)} ms`).toBeLessThan(100);
  }, 60_000);
});
