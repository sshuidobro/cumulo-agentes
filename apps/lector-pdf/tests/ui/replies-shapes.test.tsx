// @vitest-environment jsdom
import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { newReply, newReviewState, type Annotation } from '../../src/core/annotations';
import { AnnotationShape, ZoneShape } from '../../src/ui/viewer/annotation-shapes';
import { newAnnotation } from '../unit/annotations/factories';

const NOW = '2026-10-19T10:00:00.000Z';

function parent(): Annotation {
  return { ...newAnnotation('suite-nota', 'note', 0), rect: [100, 600, 120, 620] };
}

describe('respuestas y estados en la capa de la página (PDF-058)', () => {
  it('ni la forma ni la zona dibujan nada para una respuesta ni para un estado', () => {
    const p = parent();
    const reply = newReply({ id: 'suite-r', parent: p, contents: 'Sí', author: 'Ana', now: NOW });
    const review = newReviewState({ id: 'suite-s', parent: p, state: 'Accepted', author: 'Ana', now: NOW });
    for (const a of [reply, review]) {
      const shape = render(<svg>{<AnnotationShape a={a} />}</svg>);
      expect(shape.container.querySelector('svg')?.children.length).toBe(0);
      shape.unmount();
      const zone = render(<svg>{<ZoneShape a={a} />}</svg>);
      expect(zone.container.querySelector('svg')?.children.length).toBe(0);
      zone.unmount();
    }
  });
});
