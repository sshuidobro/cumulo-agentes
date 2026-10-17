import { UndoStack } from '@suite/shared';
import { describe, expect, it } from 'vitest';
import { EMPTY_EDITS, addAnnotationCommand } from '../../src/core/annotations';
import type { AnnotationEdits } from '../../src/core/annotations';
import { newAnnotation } from '../unit/annotations/factories';
import { measureBest } from './measure';

// Asserts de tiempo de reloj (ADR-0012): solo se ejecutan con `pnpm perf`, nunca en `pnpm test` ni `pnpm coverage`.

describe('rendimiento de comandos de anotación', () => {
  it('5 000 addAnnotationCommand con UndoStack (maxDepth 100) en menos de 2 s', () => {
    const { value: depth, ms } = measureBest(() => {
      const stack = new UndoStack<AnnotationEdits>(EMPTY_EDITS, { maxDepth: 100, now: () => 0 });
      for (let i = 0; i < 5000; i++) {
        stack.execute(addAnnotationCommand(newAnnotation(`suite-${i}`, 'highlight', i % 50)));
      }
      return stack.getState().undoDepth;
    });
    expect(depth).toBe(100);
    expect(ms, `5 000 addAnnotationCommand: ${ms.toFixed(0)} ms`).toBeLessThan(2000);
    // Timeout del propio test: 1 calentamiento + 5 pasadas medidas; el presupuesto de 2 s es el assert.
  }, 60_000);
});
