import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { memorySource } from '@suite/platform';
import { err, ok, type AppError, type Result } from '@suite/shared';
import type { DocOpsClient, RunOptions, SourceInput } from '../../src/core/doc-ops/client';
import { inProcessDocOps, setDocOpsRunner } from '../../src/state/doc-ops';
import {
  addMark,
  applyRedactions,
  markSearchResults,
  redactRedo,
  redactUndo,
  registerRedactParticipant,
  removeMark,
} from '../../src/state/redact-actions';
import { initialRedactState, useRedact } from '../../src/state/redact-store';
import { initialSearchState, useSearch } from '../../src/state/search-store';
import { pendingChanges } from '../../src/state/save-actions';
import { useViewer } from '../../src/state/viewer-store';
import { redactMsg } from '../../src/ui/messages-redact';
import { openedFile } from '../helpers/fake-platform';
import { answerChoice, openFixture, setupSaveHarness } from '../helpers/save-harness';

const h = setupSaveHarness();

/** Cliente que falla en la operación `failing` y deja pasar el resto al ejecutor en el mismo hilo. */
function failingClient(failing: string, error: AppError): DocOpsClient {
  const inner = inProcessDocOps();
  return {
    run<T>(op: string, args: unknown, sources: readonly SourceInput[], opts?: RunOptions): Promise<Result<T, AppError>> {
      if (op === failing) return Promise.resolve(err(error) as Result<T, AppError>);
      return inner.run<T>(op, args, sources, opts);
    },
    dispose: () => inner.dispose(),
  };
}

beforeEach(() => {
  registerRedactParticipant();
});

afterEach(() => {
  setDocOpsRunner(null);
  useRedact.setState(initialRedactState);
  useSearch.setState(initialSearchState);
});

describe('marcas de redacción: historial y registro de cambios pendientes (PDF-137)', () => {
  it('añadir, deshacer, rehacer y quitar marcas; con marcas el cierre pregunta (cambios pendientes)', async () => {
    await openFixture();
    expect(pendingChanges()).toBeNull();

    addMark(0, [10, 10, 100, 50]);
    expect(useRedact.getState().marks).toHaveLength(1);
    expect(pendingChanges()?.isDirty()).toBe(true);

    redactUndo();
    expect(useRedact.getState().marks).toHaveLength(0);
    expect(pendingChanges()).toBeNull();

    redactRedo();
    const [mark] = useRedact.getState().marks;
    expect(mark?.rect).toEqual([10, 10, 100, 50]);

    removeMark('no-existe');
    expect(useRedact.getState().marks).toHaveLength(1);
    if (mark !== undefined) removeMark(mark.id);
    expect(useRedact.getState().marks).toHaveLength(0);
    expect(useRedact.getState().undo.canUndo).toBe(true);
  });

  it('no marca nada sin documento listo', () => {
    useViewer.setState({ status: 'empty', file: null });
    addMark(0, [0, 0, 10, 10]);
    expect(useRedact.getState().marks).toHaveLength(0);
  });

  it('marcar resultados de búsqueda crea una zona por fragmento y devuelve el número de coincidencias', async () => {
    await openFixture();
    const pdf = useViewer.getState().pdf;
    expect(pdf).not.toBeNull();
    useSearch.setState({
      matchesByPage: new Map([[0, [{ pageIndex: 0, start: { item: 0, offset: 0 }, end: { item: 0, offset: 1 } }]]]),
      total: 1,
    });
    const count = await markSearchResults();
    expect(count).toBe(1);
    expect(useRedact.getState().marks.length).toBeGreaterThanOrEqual(1);
    expect(useRedact.getState().marks.every((m) => m.pageIndex === 0)).toBe(true);
  });

  it('sin búsqueda, marcar resultados no cambia nada', async () => {
    await openFixture();
    expect(await markSearchResults()).toBe(0);
    expect(useRedact.getState().marks).toHaveLength(0);
  });
});

describe('aplicar redacciones (PDF-137)', () => {
  it('«Cancelar» en la confirmación no cambia el documento ni las marcas', async () => {
    await openFixture();
    addMark(0, [10, 10, 100, 50]);
    const pending = applyRedactions();
    await answerChoice(redactMsg.cancel);
    expect(await pending).toBe('cancelled');
    expect(h.save).not.toHaveBeenCalled();
    expect(useRedact.getState().marks).toHaveLength(1);
  });

  it('un error de la operación muestra un aviso en español, no escribe el fichero y conserva las marcas', async () => {
    await openFixture();
    addMark(0, [10, 10, 100, 50]);
    setDocOpsRunner(failingClient('redact-plan', { code: 'redact-failed', message: 'Fallo de prueba.' }));
    const pending = applyRedactions();
    await answerChoice(redactMsg.confirmApply);
    expect(await pending).toBe('failed');
    expect(h.save).not.toHaveBeenCalled();
    expect(useViewer.getState().notice?.text).toBe('Fallo de prueba.');
    expect(useRedact.getState().marks).toHaveLength(1);
  });

  it('aplica: escribe el PDF reescrito, quita las marcas y avisa de las páginas', async () => {
    await openFixture();
    addMark(0, [0, 0, 612, 792]);
    h.save.mockImplementationOnce(async (target, data) => {
      if (data.kind !== 'bytes') throw new Error('se esperaba una escritura completa');
      return ok({ ...openedFile(target.name, memorySource(data.bytes)), canSaveInPlace: target.canSaveInPlace });
    });
    const pending = applyRedactions();
    await answerChoice(redactMsg.confirmApply);
    expect(await pending).toBe('saved');
    const written = h.save.mock.calls[0]?.[1];
    expect(written?.kind).toBe('bytes');
    if (written?.kind === 'bytes') expect(new TextDecoder().decode(written.bytes.slice(0, 5))).toBe('%PDF-');
    expect(useRedact.getState().marks).toHaveLength(0);
    expect(useViewer.getState().notice?.text).toBe(redactMsg.done(1));
  });

  it('sin marcas no hace nada', async () => {
    await openFixture();
    expect(await applyRedactions()).toBe('nothing');
    expect(h.save).not.toHaveBeenCalled();
  });
});
