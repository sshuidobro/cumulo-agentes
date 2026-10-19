import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { memorySource, type SaveData } from '@suite/platform';
import { err, type AppError, type Result } from '@suite/shared';
import type { DocOpsClient, RunOptions, SourceInput } from '../../src/core/doc-ops/client';
import { openForSave } from '../../src/core/pdf';
import { readPageRotations } from '../../src/core/pdf/page-tree';
import { addAnnotation, registerAnnotationParticipant } from '../../src/state/annotation-actions';
import { useAnnotations } from '../../src/state/annotation-store';
import { inProcessDocOps, setDocOpsRunner } from '../../src/state/doc-ops';
import { openRequested, registerDocumentParticipant } from '../../src/state/document-actions';
import { registerPendingChanges, save } from '../../src/state/save-actions';
import {
  cancelOrganizeSave,
  closeOrganize,
  deleteSelected,
  insertBlank,
  moveSelected,
  openOrganize,
  organizeRedo,
  organizeUndo,
  registerOrganizeParticipant,
  rotateSelected,
  saveOrganize,
  setSelection,
} from '../../src/state/organize-actions';
import { initialOrganizeState, organizeDirty, useOrganize } from '../../src/state/organize-store';
import { confirmDiscardOrSave, hasUnsavedChanges } from '../../src/state/unsaved-guard';
import { activateTab, resetTabsForTests, useTabs } from '../../src/state/tabs';
import { useViewer } from '../../src/state/viewer-store';
import { openedFile } from '../helpers/fake-platform';
import { fixtureSource } from '../helpers/pdfjs-node';
import { answerChoice, CLEAN_TITLE, concat, DIRTY_TITLE, FIXTURE, openFixture, setupSaveHarness, waitForScan } from '../helpers/save-harness';
import { newAnnotation } from './annotations/factories';
import { organizeMsg } from '../../src/ui/messages-organize';
import { useChoice } from '../../src/state/choice';
import type { OrganizePlan } from '../../src/core/organize/plan';

const h = setupSaveHarness();

/** Cliente de operaciones que intercepta algunas (p. ej. `organize`); el resto va al ejecutor en el mismo hilo. */
function clientWith(intercept: (op: string, opts: RunOptions | undefined) => Promise<Result<unknown, AppError>> | null): DocOpsClient {
  const inner = inProcessDocOps();
  return {
    run<T>(op: string, args: unknown, sources: readonly SourceInput[], opts?: RunOptions): Promise<Result<T, AppError>> {
      const hit = intercept(op, opts);
      return (hit ?? inner.run<T>(op, args, sources, opts)) as Promise<Result<T, AppError>>;
    },
    dispose: () => inner.dispose(),
  };
}

beforeEach(() => {
  registerDocumentParticipant();
  registerAnnotationParticipant();
  registerOrganizeParticipant();
});

afterEach(() => {
  setDocOpsRunner(null);
  registerPendingChanges(null);
  useOrganize.setState(initialOrganizeState);
  resetTabsForTests();
});

/** Abre basic-5.pdf (5 páginas, claves o0…o4) y la vista Organizar. */
async function openView(): Promise<void> {
  await openFixture();
  await openOrganize();
  expect(useOrganize.getState().status).toBe('ready');
}

function select(key: string): void {
  setSelection({ keys: new Set([key]), anchor: key, focus: key });
}

function keysOf(plan: OrganizePlan): string[] {
  return plan.slots.map((s) => s.key);
}

/** Ficheros guardados como incremento: se reconstruye el documento completo y se lee su estructura. */
async function savedLayout(): Promise<{ readonly pages: number; readonly rotations: readonly number[] }> {
  const [, data] = h.save.mock.calls.at(-1) as unknown as [unknown, SaveData];
  if (data.kind !== 'append') throw new Error('se esperaba append');
  const reader = await openForSave(memorySource(concat(h.original, data.delta)));
  if (!reader.ok) throw new Error(reader.error.message);
  const rotations = await readPageRotations(reader.value);
  if (!rotations.ok) throw new Error(rotations.error.message);
  return { pages: await reader.value.pageCount(), rotations: rotations.value };
}

describe('organize: abrir, editar y guardar', () => {
  it('basic-5.pdf: abrir la vista da 5 huecos; girar la 2.ª, borrar la 4.ª y guardar escribe un incremento que abre con 4 páginas', async () => {
    await openView();
    const before = useOrganize.getState().rotations;
    expect(keysOf(useOrganize.getState().plan)).toEqual(['o0', 'o1', 'o2', 'o3', 'o4']);

    select('o1');
    rotateSelected(90);
    select('o3');
    deleteSelected();
    expect(await save()).toBe('saved');

    expect(h.save).toHaveBeenCalledTimes(1);
    const [, data] = h.save.mock.calls[0] as unknown as [unknown, SaveData];
    expect(data.kind).toBe('append');
    const layout = await savedLayout();
    const second = before[1];
    expect(layout.pages).toBe(4);
    expect(layout.rotations).toEqual([before[0], ((second ?? 0) + 90) % 360, before[2], before[4]]);
    expect(useOrganize.getState().open).toBe(false);
    expect(useViewer.getState().status).toBe('ready');
  });

  it('con un resaltado sin guardar en la página 1 y la página 1 al final: el resaltado queda en la última página, en un único guardado', async () => {
    await openView();
    addAnnotation(newAnnotation('suite-hl-1', 'highlight', 0));
    select('o0');
    moveSelected(useOrganize.getState().plan.slots.length);

    expect(await save()).toBe('saved');

    expect(h.save).toHaveBeenCalledTimes(1);
    await waitForScan();
    const annotations = [...useAnnotations.getState().baseline.values()];
    expect(annotations).toHaveLength(1);
    expect(annotations[0]).toMatchObject({ type: 'highlight', pageIndex: 4, origin: { kind: 'file' } });
  });

  it('insertar una página en blanco junto al foco añade un hueco en blanco en esa posición', async () => {
    await openView();
    select('o1');
    insertBlank('after');

    const { plan } = useOrganize.getState();
    expect(keysOf(plan)).toHaveLength(6);
    expect(plan.slots[2]?.kind).toBe('blank');
    expect(keysOf(plan)[1]).toBe('o1');
  });

  it('no se pueden borrar todas las páginas: aviso y el plan no cambia', async () => {
    await openView();
    setSelection({ keys: new Set(['o0', 'o1', 'o2', 'o3', 'o4']), anchor: 'o0', focus: 'o4' });
    const before = useOrganize.getState().plan;

    deleteSelected();

    expect(useOrganize.getState().plan).toBe(before);
    expect(useViewer.getState().notice?.text).toBe(organizeMsg.cannotDeleteAll);
  });
});

describe('organize: deshacer, rehacer y título', () => {
  it('deshacer y rehacer devuelven el plan exacto y el título marca los cambios sin guardar', async () => {
    await openView();
    const initial = useOrganize.getState().plan;
    select('o1');
    rotateSelected(90);
    const rotated = useOrganize.getState().plan;
    expect(h.setTitle).toHaveBeenLastCalledWith(DIRTY_TITLE);
    select('o0');
    deleteSelected();
    const deleted = useOrganize.getState().plan;

    organizeUndo();
    expect(useOrganize.getState().plan).toEqual(rotated);
    organizeUndo();
    expect(useOrganize.getState().plan).toEqual(initial);
    expect(organizeDirty()).toBe(false);
    expect(h.setTitle).toHaveBeenLastCalledWith(CLEAN_TITLE);

    organizeRedo();
    expect(useOrganize.getState().plan).toEqual(rotated);
    organizeRedo();
    expect(useOrganize.getState().plan).toEqual(deleted);
    expect(h.setTitle).toHaveBeenLastCalledWith(DIRTY_TITLE);
  });
});

describe('organize: Ctrl+S, cambios pendientes y cierre', () => {
  it('Ctrl+S con la vista abierta y cambios guarda el plan; hasUnsavedChanges es true mientras está sucio', async () => {
    await openView();
    select('o0');
    rotateSelected(90);
    expect(hasUnsavedChanges()).toBe(true);

    expect(await save()).toBe('saved');

    expect(h.save).toHaveBeenCalledTimes(1);
    expect(hasUnsavedChanges()).toBe(false);
  });

  it('«No guardar» en el aviso de cierre descarta el plan', async () => {
    await openView();
    select('o0');
    rotateSelected(90);

    const decision = confirmDiscardOrSave();
    await answerChoice(organizeMsg.discard);

    expect(await decision).toBe('proceed');
    expect(useOrganize.getState().open).toBe(false);
    expect(hasUnsavedChanges()).toBe(false);
    expect(h.save).not.toHaveBeenCalled();
  });

  it('cerrar con cambios y «Cancelar» deja la vista con el plan', async () => {
    await openView();
    select('o0');
    rotateSelected(90);
    const plan = useOrganize.getState().plan;

    const closing = closeOrganize();
    await answerChoice(organizeMsg.cancel);

    expect(await closing).toBe('cancelled');
    expect(useOrganize.getState().open).toBe(true);
    expect(useOrganize.getState().plan).toBe(plan);
    expect(useChoice.getState().active).toBeNull();
  });

  it('cerrar con cambios y «Guardar» guarda y cierra', async () => {
    await openView();
    select('o0');
    rotateSelected(90);

    const closing = closeOrganize();
    await answerChoice(organizeMsg.save);

    expect(await closing).toBe('closed');
    expect(h.save).toHaveBeenCalledTimes(1);
    expect(useOrganize.getState().open).toBe(false);
  });
});

describe('organize: cancelación, errores y pestañas', () => {
  it('cancelar el guardado a mitad: nada escrito y la vista sigue con el plan', async () => {
    // Operación lenta: `organize` solo termina cuando la cancelan.
    let markStarted: () => void = () => undefined;
    const started = new Promise<void>((resolve) => {
      markStarted = resolve;
    });
    setDocOpsRunner(
      clientWith((op, opts) =>
        op !== 'organize'
          ? null
          : new Promise((resolve) => {
              markStarted();
              opts?.signal?.addEventListener('abort', () => resolve(err({ code: 'cancelled', message: 'Cancelado.' })), { once: true });
            }),
      ),
    );
    await openView();
    select('o0');
    rotateSelected(90);
    const plan = useOrganize.getState().plan;

    const pending = saveOrganize();
    await started;
    expect(useOrganize.getState().status).toBe('saving');
    cancelOrganizeSave();

    expect(await pending).toBe('cancelled');
    expect(h.save).not.toHaveBeenCalled();
    expect(useOrganize.getState()).toMatchObject({ open: true, status: 'ready' });
    expect(useOrganize.getState().plan).toBe(plan);
    expect(organizeDirty()).toBe(true);
  });

  it('error del Worker: aviso con el mensaje, vista abierta y plan intacto', async () => {
    setDocOpsRunner(
      clientWith((op) =>
        op === 'organize' ? Promise.resolve(err({ code: 'corrupt', message: 'El PDF está dañado.' })) : null,
      ),
    );
    await openView();
    select('o0');
    rotateSelected(90);
    const plan = useOrganize.getState().plan;

    expect(await saveOrganize()).toBe('failed');

    expect(h.save).not.toHaveBeenCalled();
    expect(useViewer.getState().notice?.text).toBe('El PDF está dañado.');
    expect(useOrganize.getState()).toMatchObject({ open: true, status: 'ready' });
    expect(useOrganize.getState().plan).toBe(plan);
  });

  it('cambiar de pestaña con la vista abierta y volver conserva plan, selección e historial', async () => {
    // El primer documento entra como pestaña (openRequested), para que el cambio de pestaña lo suspenda.
    await openRequested(openedFile(FIXTURE, memorySource(h.original)));
    await vi.waitFor(() => {
      expect(useViewer.getState().status).toBe('ready');
    });
    await openOrganize();
    select('o1');
    rotateSelected(90);
    const { plan, selection, undo } = useOrganize.getState();

    await openRequested(openedFile('page-labels.pdf', fixtureSource('page-labels.pdf')));
    await vi.waitFor(() => {
      expect(useViewer.getState().status).toBe('ready');
    });
    expect(useOrganize.getState().open).toBe(false);

    const original = useTabs.getState().tabs.find((t) => t.title === FIXTURE);
    expect(original).toBeDefined();
    activateTab(original?.id ?? '');
    await vi.waitFor(() => {
      expect(useViewer.getState().status).toBe('ready');
    });

    const restored = useOrganize.getState();
    expect(restored.open).toBe(true);
    expect(restored.plan).toEqual(plan);
    expect(restored.selection.keys).toEqual(selection.keys);
    expect(restored.undo).toEqual(undo);
    expect(organizeDirty()).toBe(true);
  });
});
