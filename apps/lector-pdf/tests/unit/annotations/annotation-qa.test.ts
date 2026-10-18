import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createStorageStore, type Platform } from '@suite/platform';
import { createFakePlatform } from '../../helpers/fake-platform';
import type { LoadedPdf } from '../../../src/engine';
import {
  addAnnotation,
  deleteAnnotation,
  endAnnotationSession,
  getEffective,
  redo,
  startAnnotationSession,
  undo,
} from '../../../src/state/annotation-actions';
import { useAnnotations } from '../../../src/state/annotation-store';
import { initServices } from '../../../src/state/services';
import { newAnnotation } from './factories';

const fake = { numPages: 25_000, doc: { numPages: 25_000, getPage: vi.fn() } } as unknown as LoadedPdf;

function setup(raw: Record<string, string> = {}): void {
  const store = createStorageStore(null, 'qa.');
  const platform: Platform = createFakePlatform({ prefs: store });
  for (const [k, v] of Object.entries(raw)) platform.prefs.set(k, JSON.parse(v));
  initServices({ platform, assetBaseUrl: '' });
}

beforeEach(() => {
  setup();
});
afterEach(() => {
  endAnnotationSession();
});

describe('QA: casos límite del historial', () => {
  it('undo/redo con la pila vacía no lanzan ni ensucian el documento', () => {
    startAnnotationSession(fake, new AbortController().signal);
    expect(() => {
      undo();
      redo();
    }).not.toThrow();
    expect(useAnnotations.getState().undo.isDirty).toBe(false);
  });

  it('una edición nueva tras deshacer descarta el rehacer', () => {
    startAnnotationSession(fake, new AbortController().signal);
    addAnnotation(newAnnotation('suite-1', 'note', 0));
    undo();
    addAnnotation(newAnnotation('suite-2', 'note', 0));
    redo();
    expect(getEffective().has('suite-1')).toBe(false);
    expect(getEffective().has('suite-2')).toBe(true);
  });

  it('borrar un id inexistente no crea entrada de deshacer', () => {
    startAnnotationSession(fake, new AbortController().signal);
    deleteAnnotation('no-existe');
    expect(useAnnotations.getState().undo.undoDepth).toBe(0);
  });

  it('la profundidad se limita a 100 entradas', () => {
    startAnnotationSession(fake, new AbortController().signal);
    for (let i = 0; i < 150; i += 1) addAnnotation(newAnnotation(`suite-${String(i)}`, 'note', 0));
    expect(useAnnotations.getState().undo.undoDepth).toBeLessThanOrEqual(100);
  });

  it('una sesión nueva reinicia las ediciones del documento anterior', () => {
    startAnnotationSession(fake, new AbortController().signal);
    addAnnotation(newAnnotation('suite-1', 'note', 0));
    startAnnotationSession(fake, new AbortController().signal);
    expect(getEffective().size).toBe(0);
    expect(useAnnotations.getState().undo.canUndo).toBe(false);
  });
});

describe('QA: preferencias corruptas', () => {
  it('valores inválidos en prefs caen a los valores por defecto', () => {
    setup({
      annotationAuthor: '42',
      annotationColors: '"rojo"',
      inkWidth: '3',
      fontSize: '999',
      commentBarOpen: '"si"',
    });
    startAnnotationSession(fake, new AbortController().signal);
    const s = useAnnotations.getState();
    expect(s.author).toBe('Usuario');
    expect(s.colors.highlight).toEqual([1, 0.92, 0.23]);
    expect([1, 2, 4, 8]).toContain(s.inkWidth);
    expect([8, 10, 12, 14, 18, 24]).toContain(s.fontSize);
    expect(typeof s.commentBarOpen).toBe('boolean');
  });
});
