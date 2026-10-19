import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createStorageStore, memorySource, type Platform } from '@suite/platform';
import { createFakePlatform, openedFile } from '../../helpers/fake-platform';
import type { LoadedPdf } from '../../../src/engine';
import { reviewStateOf, repliesOf, type Annotation } from '../../../src/core/annotations';
import {
  addAnnotation,
  deleteAnnotation,
  endAnnotationSession,
  getEffective,
  startAnnotationSession,
  undo,
} from '../../../src/state/annotation-actions';
import { initialAnnotationState, useAnnotations } from '../../../src/state/annotation-store';
import { addReply, editReply, setReviewState } from '../../../src/state/reply-actions';
import { initServices } from '../../../src/state/services';
import { initialViewerState, useViewer } from '../../../src/state/viewer-store';
import { newAnnotation } from './factories';

/** Documento de 25 000 páginas en modo lazy: no se escanea ni se llama a `getPage` (ver annotation-actions.test). */
function lazyLoaded(): LoadedPdf {
  return { numPages: 25_000, doc: {} } as unknown as LoadedPdf;
}

function note(id = 'suite-nota'): Annotation {
  return { ...newAnnotation(id, 'note', 0), rect: [100, 600, 120, 620], origin: { kind: 'new' } };
}

function depth(): number {
  return useAnnotations.getState().undo.undoDepth;
}

beforeEach(() => {
  // Reloj falso (solo `Date`): las ráfagas de escritura se agrupan por tiempo.
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-10-19T10:00:00.000Z'));
  const platform: Platform = createFakePlatform({ prefs: createStorageStore(null, 'test.') });
  initServices({ platform, assetBaseUrl: '' });
  useViewer.setState({
    ...initialViewerState,
    status: 'ready',
    file: openedFile('annotated.pdf', memorySource(new Uint8Array([0x25]))),
  });
  endAnnotationSession();
  useAnnotations.setState(initialAnnotationState());
  startAnnotationSession(lazyLoaded(), new AbortController().signal);
  useAnnotations.setState({ author: 'Ana' });
  addAnnotation(note());
});

afterEach(() => {
  endAnnotationSession();
  useViewer.setState(initialViewerState);
  useAnnotations.setState(initialAnnotationState());
  vi.useRealTimers();
});

describe('addReply (PDF-109)', () => {
  it('crea una respuesta del autor actual con el texto recortado y el padre indicado', () => {
    const id = addReply('suite-nota', '  ok  ');

    expect(id).not.toBeNull();
    const reply = getEffective().get(id ?? '');
    expect(reply?.type).toBe('reply');
    expect(reply).toMatchObject({ contents: 'ok', author: 'Ana', pageIndex: 0 });
    if (reply?.type !== 'reply') throw new Error('no es una respuesta');
    expect(reply.parentId).toBe('suite-nota');
    expect(repliesOf(getEffective(), 'suite-nota').map((r) => r.id)).toEqual([id]);
  });

  it('con texto en blanco no crea nada y devuelve null', () => {
    const before = getEffective().size;
    const depthBefore = depth();

    expect(addReply('suite-nota', '   ')).toBeNull();
    expect(getEffective().size).toBe(before);
    expect(depth()).toBe(depthBefore);
  });

  it('con un padre que no existe no crea nada', () => {
    expect(addReply('suite-inexistente', 'hola')).toBeNull();
    expect(getEffective().size).toBe(1);
  });

  it('cada respuesta es una entrada de deshacer «responder»', () => {
    const depthBefore = depth();
    addReply('suite-nota', 'uno');

    expect(depth()).toBe(depthBefore + 1);
    expect(useAnnotations.getState().undo.undoLabel).toBe('responder');
  });
});

describe('editReply (PDF-109)', () => {
  it('cambia el texto recortado de la respuesta', () => {
    const id = addReply('suite-nota', 'uno') ?? '';
    editReply(id, '  dos  ');

    expect(getEffective().get(id)).toMatchObject({ contents: 'dos' });
  });

  it('un texto vacío o igual al vigente no hace nada', () => {
    const id = addReply('suite-nota', 'uno') ?? '';
    const depthBefore = depth();

    editReply(id, '   ');
    editReply(id, 'uno');
    expect(getEffective().get(id)).toMatchObject({ contents: 'uno' });
    expect(depth()).toBe(depthBefore);
  });

  it('una ráfaga de ediciones seguidas es una sola entrada de deshacer', () => {
    const id = addReply('suite-nota', 'u') ?? '';
    const depthBefore = depth();
    editReply(id, 'un');
    editReply(id, 'uno');

    expect(depth()).toBe(depthBefore + 1);
    undo();
    expect(getEffective().get(id)).toMatchObject({ contents: 'u' });
  });

  it('no cambia un id que no es una respuesta', () => {
    const depthBefore = depth();
    editReply('suite-nota', 'otro texto');

    expect(getEffective().get('suite-nota')).toMatchObject({ contents: '' });
    expect(depth()).toBe(depthBefore);
  });
});

describe('setReviewState (PDF-109)', () => {
  it('fijar «Aceptado» dos veces seguidas deja un solo estado', () => {
    setReviewState('suite-nota', 'Accepted');
    setReviewState('suite-nota', 'Accepted');

    const reviews = [...getEffective().values()].filter((a) => a.type === 'review');
    expect(reviews).toHaveLength(1);
    expect(reviewStateOf(getEffective(), 'suite-nota')?.state).toBe('Accepted');
    expect(depth()).toBe(2);
  });

  it('el estado vigente es el último fijado; «Ninguno» lo quita', () => {
    setReviewState('suite-nota', 'Accepted');
    vi.setSystemTime(new Date('2026-10-19T10:00:01.000Z'));
    setReviewState('suite-nota', 'Rejected');
    expect(reviewStateOf(getEffective(), 'suite-nota')?.state).toBe('Rejected');

    vi.setSystemTime(new Date('2026-10-19T10:00:02.000Z'));
    setReviewState('suite-nota', 'None');
    expect(reviewStateOf(getEffective(), 'suite-nota')).toBeNull();
  });

  it('«Ninguno» sin estado previo no crea nada', () => {
    const depthBefore = depth();
    setReviewState('suite-nota', 'None');

    expect(depth()).toBe(depthBefore);
    expect([...getEffective().values()].some((a) => a.type === 'review')).toBe(false);
  });
});

describe('deleteAnnotation con respuestas (PDF-109)', () => {
  it('borrar una nota con 2 respuestas y un estado quita los 4 y sube el deshacer en uno; deshacer los devuelve', () => {
    addReply('suite-nota', 'primera');
    addReply('suite-nota', 'segunda');
    setReviewState('suite-nota', 'Accepted');
    const replyIds = repliesOf(getEffective(), 'suite-nota').map((r) => r.id);
    expect(getEffective().size).toBe(4);
    const depthBefore = depth();

    deleteAnnotation('suite-nota');

    expect(getEffective().size).toBe(0);
    expect(depth()).toBe(depthBefore + 1);
    expect(useAnnotations.getState().undo.undoLabel).toBe('borrar nota');

    undo();
    expect(getEffective().has('suite-nota')).toBe(true);
    for (const id of replyIds) expect(getEffective().has(id)).toBe(true);
    expect(getEffective().size).toBe(4);
  });

  it('borra también las respuestas de las respuestas', () => {
    const first = addReply('suite-nota', 'uno') ?? '';
    addReply(first, 'respuesta a la respuesta');

    deleteAnnotation('suite-nota');

    expect(getEffective().size).toBe(0);
  });

  it('no toca las anotaciones ajenas al comentario borrado', () => {
    addAnnotation(newAnnotation('suite-otra', 'highlight', 0));
    addReply('suite-nota', 'respuesta');

    deleteAnnotation('suite-nota');

    expect([...getEffective().keys()]).toEqual(['suite-otra']);
  });
});
