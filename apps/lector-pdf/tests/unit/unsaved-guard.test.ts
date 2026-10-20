import { afterEach, describe, expect, it, vi } from 'vitest';
import { memorySource } from '@suite/platform';
import { openRequested } from '../../src/state/document-actions';
import { addAnnotation } from '../../src/state/annotation-actions';
import { registerPendingChanges } from '../../src/state/save-actions';
import { confirmDiscardOrSave, hasUnsavedChanges, installCloseGuard } from '../../src/state/unsaved-guard';
import { useChoice } from '../../src/state/choice';
import { useViewer } from '../../src/state/viewer-store';
import { openedFile } from '../helpers/fake-platform';
import { answerChoice, FIXTURE, openFixture, setupSaveHarness } from '../helpers/save-harness';
import { newAnnotation } from './annotations/factories';

const h = setupSaveHarness();

const QUESTION = `¿Guardar los cambios en «${FIXTURE}»?`;

/** Registra el aviso de cierre y devuelve el callback que la plataforma invocaría al cerrar. */
function captureCloseCallback(): () => boolean {
  let callback: (() => boolean) | null = null;
  h.onCloseRequested.mockImplementation((cb: () => boolean) => {
    callback = cb;
    return () => undefined;
  });
  installCloseGuard();
  if (callback === null) throw new Error('installCloseGuard no registró el aviso de cierre');
  return callback;
}

/** Espera a que el cierre pedido por el aviso termine (o no) de decidir. */
async function settle(): Promise<void> {
  await vi.waitFor(() => {
    expect(useChoice.getState().active === null).toBe(true);
  });
  await new Promise((resolve) => { setTimeout(resolve, 0); });
}

describe('installCloseGuard', () => {
  it('sin cambios permite cerrar', async () => {
    const close = captureCloseCallback();
    await openFixture();
    expect(close()).toBe(true);
    expect(useChoice.getState().active).toBeNull();
  });

  it('con cambios cancela el cierre, pregunta y «No guardar» cierra la ventana', async () => {
    const close = captureCloseCallback();
    await openFixture();
    addAnnotation(newAnnotation('suite-hl-1', 'highlight', 0));

    expect(close()).toBe(false);
    expect(await answerChoice('No guardar')).toBe(QUESTION);
    await settle();

    expect(h.closeWindow).toHaveBeenCalledTimes(1);
    expect(h.save).not.toHaveBeenCalled();
  });

  it('con cambios y «Cancelar» no cierra la ventana', async () => {
    const close = captureCloseCallback();
    await openFixture();
    addAnnotation(newAnnotation('suite-hl-1', 'highlight', 0));

    expect(close()).toBe(false);
    await answerChoice('Cancelar');
    await settle();

    expect(h.closeWindow).not.toHaveBeenCalled();
    expect(h.save).not.toHaveBeenCalled();
  });

  it('con cambios y «Guardar» guarda y, al terminar bien, cierra la ventana', async () => {
    const close = captureCloseCallback();
    await openFixture();
    addAnnotation(newAnnotation('suite-hl-1', 'highlight', 0));

    expect(close()).toBe(false);
    await answerChoice('Guardar');
    await settle();

    expect(h.save).toHaveBeenCalledTimes(1);
    expect(h.closeWindow).toHaveBeenCalledTimes(1);
  });

  it('con cambios y «Guardar» que falla no cierra la ventana', async () => {
    const close = captureCloseCallback();
    await openFixture();
    addAnnotation(newAnnotation('suite-hl-1', 'highlight', 0));
    h.save.mockResolvedValueOnce({ ok: false, error: { code: 'io', message: 'fallo' } });

    expect(close()).toBe(false);
    await answerChoice('Guardar');
    await settle();

    expect(h.save).toHaveBeenCalledTimes(1);
    expect(h.closeWindow).not.toHaveBeenCalled();
  });
});

describe('confirmDiscardOrSave y abrir otro documento', () => {
  it('sin cambios no pregunta', async () => {
    await openFixture();
    expect(await confirmDiscardOrSave()).toBe('proceed');
    expect(useChoice.getState().active).toBeNull();
  });

  it('abrir otro documento con cambios no pregunta: el nuevo se abre y el anterior queda en su pestaña', async () => {
    await openFixture();
    addAnnotation(newAnnotation('suite-hl-1', 'highlight', 0));
    const other = openedFile('otro.pdf', memorySource(h.original));

    await openRequested(other);

    expect(useChoice.getState().active).toBeNull();
    expect(useViewer.getState().file?.name).toBe('otro.pdf');
    expect(h.save).not.toHaveBeenCalled();
  });
});

describe('cambios pendientes (organizar) en el aviso de cierre', () => {
  afterEach(() => {
    registerPendingChanges(null);
  });

  it('hasUnsavedChanges es true mientras hay cambios pendientes sucios', () => {
    let dirty = true;
    registerPendingChanges({ isDirty: () => dirty, save: vi.fn(async () => 'saved' as const), discard: () => undefined });
    expect(hasUnsavedChanges()).toBe(true);

    dirty = false;
    expect(hasUnsavedChanges()).toBe(false);
  });

  it('«No guardar» descarta también los cambios pendientes', async () => {
    await openFixture();
    const discard = vi.fn();
    registerPendingChanges({ isDirty: () => true, save: vi.fn(async () => 'saved' as const), discard });

    const decision = confirmDiscardOrSave();
    await answerChoice('No guardar');

    expect(await decision).toBe('proceed');
    expect(discard).toHaveBeenCalledTimes(1);
    expect(h.save).not.toHaveBeenCalled();
  });
});

