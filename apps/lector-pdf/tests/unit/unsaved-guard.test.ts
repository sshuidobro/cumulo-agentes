import { describe, expect, it, vi } from 'vitest';
import { memorySource } from '@suite/platform';
import { ok } from '@suite/shared';
import { openRequested } from '../../src/state/document-actions';
import { addAnnotation } from '../../src/state/annotation-actions';
import { confirmDiscardOrSave, installCloseGuard } from '../../src/state/unsaved-guard';
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

  it('abrir otro documento con cambios pregunta; «Cancelar» mantiene el actual y libera el nuevo', async () => {
    const current = await openFixture();
    addAnnotation(newAnnotation('suite-hl-1', 'highlight', 0));
    const other = openedFile('otro.pdf', memorySource(h.original));

    const opening = openRequested(other);
    expect(await answerChoice('Cancelar')).toBe(QUESTION);
    await opening;

    expect(useViewer.getState().file).toBe(current);
    expect(h.closeFile).toHaveBeenCalledWith(other);
  });

  it('abrir otro documento con cambios y «No guardar» abre el nuevo', async () => {
    await openFixture();
    addAnnotation(newAnnotation('suite-hl-1', 'highlight', 0));
    const other = openedFile('otro.pdf', memorySource(h.original));

    const opening = openRequested(other);
    await answerChoice('No guardar');
    await opening;

    expect(useViewer.getState().file?.name).toBe('otro.pdf');
    expect(h.save).not.toHaveBeenCalled();
  });

  it('abrir otro documento con cambios y «Guardar» guarda antes de abrir el nuevo', async () => {
    await openFixture();
    addAnnotation(newAnnotation('suite-hl-1', 'highlight', 0));
    const other = openedFile('otro.pdf', memorySource(h.original));
    h.save.mockResolvedValueOnce(ok(openedFile(FIXTURE, memorySource(h.original))));

    const opening = openRequested(other);
    await answerChoice('Guardar');
    await opening;

    expect(h.save).toHaveBeenCalledTimes(1);
    expect(useViewer.getState().file?.name).toBe('otro.pdf');
  });
});
