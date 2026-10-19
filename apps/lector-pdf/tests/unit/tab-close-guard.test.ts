import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createFakePlatform } from '../helpers/fake-platform';
import { initServices } from '../../src/state/services';
import { useAnnotations } from '../../src/state/annotation-store';
import { useChoice } from '../../src/state/choice';
import { beginNewTab, registerTabParticipant, resetTabsForTests, useTabs } from '../../src/state/tabs';
import { confirmAllTabs, hasUnsavedChanges, installCloseGuard } from '../../src/state/unsaved-guard';

/** Cambios sin guardar del documento activo (lo que leen la barra y el aviso de cierre). */
function setDirty(value: boolean): void {
  useAnnotations.setState((s) => ({ undo: { ...s.undo, isDirty: value } }));
}

/** Espera a la siguiente pregunta, responde con el botón `label` y devuelve la pestaña activa al preguntar. */
async function answerNext(label: string): Promise<string> {
  await vi.waitFor(() => {
    expect(useChoice.getState().active).not.toBeNull();
  });
  const asked = useTabs.getState().activeId ?? '';
  const option = useChoice.getState().active?.options.find((o) => o.label === label);
  if (option === undefined) throw new Error(`Sin botón «${label}»`);
  option.pick();
  return asked;
}

/** Abre pestañas (la última queda activa) con el estado «con cambios» indicado en cada una. */
function openTabs(dirty: readonly boolean[]): string[] {
  const ids: string[] = [];
  dirty.forEach((value, index) => {
    beginNewTab(`doc-${String(index)}.pdf`, null);
    ids.push(useTabs.getState().activeId ?? '');
    setDirty(value);
  });
  return ids;
}

beforeEach(() => {
  resetTabsForTests();
  setDirty(false);
  // Participante de anotaciones: al dejar una pestaña guarda si tenía cambios; al volver, los restaura.
  registerTabParticipant<boolean>({
    id: 'annotations',
    order: 20,
    suspend: () => hasUnsavedChanges(),
    resume: (dirty) => { setDirty(dirty); },
    dispose: async () => undefined,
  });
});

describe('confirmAllTabs', () => {
  it('pregunta por cada pestaña con cambios de izquierda a derecha y, con «No guardar», permite cerrar', async () => {
    const [a, , c] = openTabs([true, false, true]);

    const done = confirmAllTabs();
    const first = await answerNext('No guardar');
    const second = await answerNext('No guardar');

    expect(await done).toBe(true);
    expect([first, second]).toEqual([a, c]);
  });

  it('«Cancelar» detiene el proceso y deja la app en esa pestaña', async () => {
    const [, b] = openTabs([true, true, false]);

    const done = confirmAllTabs();
    await answerNext('No guardar');
    const asked = await answerNext('Cancelar');

    expect(await done).toBe(false);
    expect(asked).toBe(b);
    expect(useTabs.getState().activeId).toBe(b);
    expect(useChoice.getState().active).toBeNull();
  });

  it('sin pestañas con cambios no pregunta nada', async () => {
    openTabs([false, false]);

    expect(await confirmAllTabs()).toBe(true);
    expect(useChoice.getState().active).toBeNull();
  });
});

describe('installCloseGuard con varias pestañas', () => {
  it('cancela el cierre, confirma cada pestaña y cierra la ventana al terminar', async () => {
    let closeRequested = null as (() => boolean) | null;
    const platform = createFakePlatform({
      onCloseRequested: (cb: () => boolean) => {
        closeRequested = cb;
        return () => undefined;
      },
    });
    initServices({ platform, assetBaseUrl: 'http://localhost/' });
    installCloseGuard();
    openTabs([true, false, true]);

    expect(closeRequested).not.toBeNull();
    expect(closeRequested?.()).toBe(false);
    await answerNext('No guardar');
    await answerNext('No guardar');

    await vi.waitFor(() => {
      expect(platform.closeWindow).toHaveBeenCalledTimes(1);
    });
  });

  it('sin cambios en ninguna pestaña permite cerrar sin preguntar', () => {
    let closeRequested = null as (() => boolean) | null;
    const platform = createFakePlatform({
      onCloseRequested: (cb: () => boolean) => {
        closeRequested = cb;
        return () => undefined;
      },
    });
    initServices({ platform, assetBaseUrl: 'http://localhost/' });
    installCloseGuard();
    openTabs([false, false]);

    expect(closeRequested?.()).toBe(true);
    expect(useChoice.getState().active).toBeNull();
  });
});
