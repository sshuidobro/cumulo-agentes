import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { memorySource, type SaveData } from '@suite/platform';
import { err, ok, type AppError, type Result } from '@suite/shared';
import type { DocOpsClient, RunOptions, SourceInput } from '../../src/core/doc-ops/client';
import type { RectPt } from '../../src/core/annotations/model';
import { standardFontFor, type EditableLine } from '../../src/core/edit-text';
import type { SignatureStatus } from '../../src/core/signature/digital';
import type { LoadedPdf } from '../../src/engine/load';
import { inProcessDocOps, setDocOpsRunner } from '../../src/state/doc-ops';
import { registerDocumentParticipant, openRequested } from '../../src/state/document-actions';
import {
  beginLineEdit,
  cancelLineEdit,
  commitLineEdit,
  editTextRedo,
  editTextUndo,
  registerEditTextParticipant,
  removeLineEdit,
  saveTextEdits,
  setEditTextTool,
  validateLineText,
} from '../../src/state/edit-text-actions';
import { initialEditTextState, useEditText } from '../../src/state/edit-text-store';
import { useChoice } from '../../src/state/choice';
import { beginJob, cancelDocOp, endJob } from '../../src/state/extract-actions';
import { pendingChanges, registerPendingChanges } from '../../src/state/save-actions';
import { activateTab, resetTabsForTests, useTabs } from '../../src/state/tabs';
import { useViewer } from '../../src/state/viewer-store';
import { editTextMsg } from '../../src/ui/messages-edit-text';
import { openedFile } from '../helpers/fake-platform';
import { fixtureSource } from '../helpers/pdfjs-node';
import { answerChoice, FIXTURE, fixtureBytes, openFixture, setupSaveHarness, waitForScan } from '../helpers/save-harness';

const h = setupSaveHarness();

type Handler = (args: unknown, opts: RunOptions | undefined) => Promise<Result<unknown, AppError>>;

/** Operaciones interceptadas por el test; las demás van al ejecutor en el mismo hilo. */
const handlers = new Map<string, Handler>();
/** Llamadas recibidas por el cliente de operaciones, en orden. */
let calls: { readonly op: string; readonly args: unknown }[] = [];

/** Punto y caja de la línea «Hola» de la página de prueba. */
const POINT: readonly [number, number] = [110, 705];
const LINE_BOUNDS: RectPt = [100, 698, 140, 712];
/** Ítems de texto de la página de prueba (una sola línea, «Hola» en x 100–140, base 700). */
const ITEMS = [{ str: 'Hola', transform: [1, 0, 0, 1, 100, 700], width: 40, height: 12 }];

function editableLine(): EditableLine {
  return {
    pageIndex: 0,
    bounds: LINE_BOUNDS,
    origin: [100, 700],
    style: { font: standardFontFor('Helvetica', 0), fontSize: 12, color: [0, 0, 0] },
  };
}

/** Documento de pdf.js falso con una página cuyo texto son `items`. Solo se usa `getPage` → `getTextContent`. */
function fakePdf(items: readonly unknown[]): LoadedPdf {
  const page = { getTextContent: () => Promise.resolve({ items }) };
  return { doc: { getPage: () => Promise.resolve(page) } } as unknown as LoadedPdf;
}

function handle(op: string, fn: Handler): void {
  handlers.set(op, fn);
}

function callsOf(op: string): unknown[] {
  return calls.filter((c) => c.op === op).map((c) => c.args);
}

function installClient(): void {
  const inner = inProcessDocOps();
  const client: DocOpsClient = {
    run<T>(op: string, args: unknown, sources: readonly SourceInput[], opts?: RunOptions): Promise<Result<T, AppError>> {
      calls = [...calls, { op, args }];
      const hit = handlers.get(op);
      return (hit ? hit(args, opts) : inner.run<T>(op, args, sources, opts)) as Promise<Result<T, AppError>>;
    },
    dispose: () => inner.dispose(),
  };
  setDocOpsRunner(client);
}

beforeEach(() => {
  registerDocumentParticipant();
  registerEditTextParticipant();
  calls = [];
  handlers.clear();
  installClient();
  handle('edit-text-probe', () => Promise.resolve(ok({ line: editableLine() })));
  handle('verify-signatures', () => Promise.resolve(ok([])));
});

afterEach(() => {
  setDocOpsRunner(null);
  registerPendingChanges(null);
  useEditText.setState(initialEditTextState);
  resetTabsForTests();
});

/** Abre basic-5.pdf con una página de texto «Hola» conocida. */
async function openView(): Promise<void> {
  await openFixture();
  useViewer.setState({ pdf: fakePdf(ITEMS) });
}

/** Crea una edición de la línea «Hola» con el texto dado y cierra el cuadro. */
async function createEdit(text: string): Promise<void> {
  await beginLineEdit(0, POINT);
  commitLineEdit(text);
}

function texts(): string[] {
  return useEditText.getState().edits.map((edit) => edit.text);
}

describe('validateLineText', () => {
  it('admite el texto de la fuente estándar y rechaza emoji, saltos de línea y otros caracteres', () => {
    expect(validateLineText('Ñandú ¿qué? “sí”')).toBeNull();
    expect(validateLineText('Hola 😀')).toBe(editTextMsg.unsupportedChar('😀'));
    expect(validateLineText('uno\ndos')).toBe(editTextMsg.noLineBreaks);
    expect(validateLineText('a\tb')).toBe(editTextMsg.noLineBreaks);
    expect(validateLineText('中')).toBe(editTextMsg.unsupportedChar('中'));
  });
});

describe('beginLineEdit', () => {
  it('si pdf.js no puede leer el texto de la página avisa, no lanza y deja el estado en reposo', async () => {
    await openFixture();
    const page = { getTextContent: () => Promise.reject(new Error('fallo de lectura')) };
    useViewer.setState({ pdf: { doc: { getPage: () => Promise.resolve(page) } } as unknown as LoadedPdf });
    await expect(beginLineEdit(0, POINT)).resolves.toBeUndefined();
    expect(useViewer.getState().notice?.text).toBe(editTextMsg.readFailed);
    expect(useEditText.getState().editing).toBeNull();
    expect(useEditText.getState().status).toBe('idle');
    expect(callsOf('edit-text-probe')).toEqual([]);
  });

  it('una segunda petición mientras se consulta la línea no lanza otra consulta', async () => {
    await openView();
    let release: (() => void) | undefined;
    handle('edit-text-probe', () => new Promise((resolve) => {
      release = () => resolve(ok({ line: editableLine() }));
    }));
    const first = beginLineEdit(0, POINT);
    await vi.waitFor(() => {
      expect(useEditText.getState().status).toBe('probing');
    });
    await beginLineEdit(0, POINT);
    await vi.waitFor(() => {
      expect(release).toBeDefined();
    });
    release?.();
    await first;
    expect(callsOf('edit-text-probe')).toHaveLength(1);
    expect(useEditText.getState().editing?.original).toBe('Hola');
  });

  it('con un motivo de la consulta avisa con su mensaje y no abre el cuadro', async () => {
    await openView();
    handle('edit-text-probe', () => Promise.resolve(ok({ issue: 'rotated' })));
    await beginLineEdit(0, POINT);
    expect(useViewer.getState().notice?.text).toBe(editTextMsg.issue.rotated);
    expect(useEditText.getState().editing).toBeNull();
    expect(callsOf('edit-text-probe')).toEqual([{ password: null, pageIndex: 0, hint: expect.any(Array) }]);
  });

  it('con una línea editable abre el cuadro con el texto de pdf.js y sin edición previa', async () => {
    await openView();
    await beginLineEdit(0, POINT);
    const editing = useEditText.getState().editing;
    expect(editing).toEqual({
      pageIndex: 0,
      hint: [99.5, 698.8, 140.5, 707.2],
      line: editableLine(),
      original: 'Hola',
      editId: null,
    });
    expect(useEditText.getState().status).toBe('idle');
  });

  it('en un punto sin texto avisa y no consulta al Worker', async () => {
    await openView();
    await beginLineEdit(0, [0, 0]);
    expect(useViewer.getState().notice?.text).toBe(editTextMsg.noText);
    expect(callsOf('edit-text-probe')).toHaveLength(0);
  });

  it('si el Worker falla muestra su mensaje y no abre el cuadro', async () => {
    await openView();
    handle('edit-text-probe', () => Promise.resolve(err({ code: 'pdf-error', message: 'Fallo de prueba.' } as AppError)));
    await beginLineEdit(0, POINT);
    expect(useViewer.getState().notice?.text).toBe('Fallo de prueba.');
    expect(useEditText.getState().editing).toBeNull();
  });

  it('con cambios de otra herramienta pendientes avisa y no consulta', async () => {
    await openView();
    registerPendingChanges({ isDirty: () => true, save: () => Promise.resolve('nothing'), discard: () => undefined });
    await expect(beginLineEdit(0, POINT)).resolves.toBeUndefined();
    expect(useViewer.getState().notice?.text).toBe(editTextMsg.otherPending);
    expect(useEditText.getState().editing).toBeNull();
    expect(callsOf('edit-text-probe')).toHaveLength(0);
  });

  it('sin documento o con la consulta en curso no hace nada', async () => {
    await openView();
    useViewer.setState({ pdf: null });
    await beginLineEdit(0, POINT);
    expect(useEditText.getState().editing).toBeNull();
    expect(callsOf('edit-text-probe')).toHaveLength(0);

    useViewer.setState({ pdf: fakePdf(ITEMS) });
    useEditText.setState({ status: 'saving' });
    await beginLineEdit(0, POINT);
    expect(callsOf('edit-text-probe')).toHaveLength(0);
    useEditText.setState({ status: 'idle' });
  });

  it('descarta la respuesta si el documento cambia mientras se consulta', async () => {
    await openView();
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    handle('edit-text-probe', async () => {
      await gate;
      return ok({ line: editableLine() });
    });
    const pending = beginLineEdit(0, POINT);
    await vi.waitFor(() => {
      expect(callsOf('edit-text-probe')).toHaveLength(1);
    });
    useViewer.setState({ file: null });
    release();
    await pending;
    expect(useEditText.getState().editing).toBeNull();
    expect(useEditText.getState().status).toBe('idle');
  });

  it('una línea que ya tiene edición abre su cuadro sin consultar al Worker', async () => {
    await openView();
    await createEdit('Hola mundo');
    handle('edit-text-probe', () => Promise.reject(new Error('no debía consultarse')));
    await beginLineEdit(0, POINT);
    const editing = useEditText.getState().editing;
    expect(editing?.editId).toBe(useEditText.getState().edits[0]?.id);
    expect(editing?.original).toBe('Hola');
    expect(callsOf('edit-text-probe')).toHaveLength(1);
  });
});

describe('commitLineEdit y cancelLineEdit', () => {
  it('«Hola 😀» no crea edición y deja el cuadro abierto para corregirlo', async () => {
    await openView();
    await beginLineEdit(0, POINT);
    commitLineEdit('Hola 😀');
    expect(useEditText.getState().edits).toHaveLength(0);
    expect(useEditText.getState().editing).not.toBeNull();
    expect(pendingChanges()).toBeNull();
  });

  it('con el mismo texto que el original no crea edición ni registra cambios pendientes', async () => {
    await openView();
    await beginLineEdit(0, POINT);
    commitLineEdit('Hola');
    expect(useEditText.getState().edits).toHaveLength(0);
    expect(useEditText.getState().editing).toBeNull();
    expect(pendingChanges()).toBeNull();
  });

  it('con texto nuevo crea la edición, la registra como cambio pendiente y cierra el cuadro', async () => {
    await openView();
    await createEdit('Hola mundo');
    const [edit] = useEditText.getState().edits;
    expect(edit).toMatchObject({ pageIndex: 0, original: 'Hola', text: 'Hola mundo', hint: [99.5, 698.8, 140.5, 707.2] });
    expect(edit?.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(useEditText.getState().editing).toBeNull();
    expect(pendingChanges()).not.toBeNull();
    expect(pendingChanges()?.isDirty()).toBe(true);
  });

  it('sin cuadro abierto no hace nada, y cancelar cierra el cuadro sin cambios', async () => {
    await openView();
    commitLineEdit('Hola mundo');
    expect(useEditText.getState().edits).toHaveLength(0);
    await beginLineEdit(0, POINT);
    cancelLineEdit();
    expect(useEditText.getState().editing).toBeNull();
    expect(useEditText.getState().edits).toHaveLength(0);
  });

  it('modificar una edición con el mismo texto no añade un paso al historial', async () => {
    await openView();
    await createEdit('Hola A');
    await beginLineEdit(0, POINT);
    commitLineEdit('Hola A');
    editTextUndo();
    expect(texts()).toEqual([]);
  });
});

describe('deshacer y rehacer', () => {
  it('crear, modificar y restaurar una edición son tres pasos que se recorren en orden', async () => {
    await openView();
    await createEdit('Hola A');
    await beginLineEdit(0, POINT);
    commitLineEdit('Hola B');
    await beginLineEdit(0, POINT);
    commitLineEdit('Hola');
    expect(texts()).toEqual([]);
    expect(pendingChanges()).toBeNull();

    editTextUndo();
    expect(texts()).toEqual(['Hola B']);
    expect(pendingChanges()?.isDirty()).toBe(true);
    editTextUndo();
    expect(texts()).toEqual(['Hola A']);
    editTextUndo();
    expect(texts()).toEqual([]);
    expect(pendingChanges()).toBeNull();
    editTextUndo();
    expect(texts()).toEqual([]);

    editTextRedo();
    expect(texts()).toEqual(['Hola A']);
    editTextRedo();
    expect(texts()).toEqual(['Hola B']);
    editTextRedo();
    expect(texts()).toEqual([]);
    editTextRedo();
    expect(texts()).toEqual([]);
  });

  it('quitar una edición la restaura al original y el paso se puede deshacer', async () => {
    await openView();
    await createEdit('Hola A');
    const id = useEditText.getState().edits[0]?.id ?? '';
    removeLineEdit('id-que-no-existe');
    expect(texts()).toEqual(['Hola A']);
    removeLineEdit(id);
    expect(texts()).toEqual([]);
    expect(pendingChanges()).toBeNull();
    editTextUndo();
    expect(texts()).toEqual(['Hola A']);
  });

  it('no hace nada con el historial vacío', async () => {
    await openView();
    editTextUndo();
    editTextRedo();
    expect(texts()).toEqual([]);
  });
});

describe('setEditTextTool', () => {
  it('activa y desactiva la herramienta, y al desactivar cierra el cuadro', async () => {
    await openView();
    setEditTextTool(true);
    expect(useEditText.getState().active).toBe(true);
    await beginLineEdit(0, POINT);
    setEditTextTool(false);
    expect(useEditText.getState().active).toBe(false);
    expect(useEditText.getState().editing).toBeNull();
  });

  it('al desactivar con un texto válido lo confirma; con uno no válido mantiene el cuadro', async () => {
    await openView();
    setEditTextTool(true);
    await beginLineEdit(0, POINT);
    setEditTextTool(false, 'Hola 😀');
    expect(useEditText.getState()).toMatchObject({ active: true, edits: [] });
    expect(useEditText.getState().editing).not.toBeNull();
    setEditTextTool(false, 'Hola confirmado');
    expect(useEditText.getState()).toMatchObject({ active: false, editing: null });
    expect(texts()).toEqual(['Hola confirmado']);
  });
});

describe('saveTextEdits', () => {
  it('sin ediciones no hace nada', async () => {
    await openView();
    expect(await saveTextEdits()).toBe('nothing');
    expect(callsOf('edit-text')).toHaveLength(0);
  });

  it('«Cancelar» no llama a la operación y deja las ediciones intactas', async () => {
    await openView();
    await createEdit('Hola A');
    const pending = saveTextEdits();
    expect(await answerChoice(editTextMsg.cancel)).toBe(editTextMsg.confirmTitle);
    expect(await pending).toBe('cancelled');
    expect(callsOf('edit-text')).toHaveLength(0);
    expect(texts()).toEqual(['Hola A']);
    expect(useEditText.getState().status).toBe('idle');
  });

  it('«Guardar» reescribe el fichero con las ediciones y deja el documento sin cambios pendientes', async () => {
    await openView();
    await createEdit('Hola A');
    const reopened = fixtureBytes(FIXTURE);
    handle('edit-text', () => Promise.resolve(ok({ bytes: reopened })));
    h.save.mockImplementationOnce(async (target, data: SaveData) => {
      if (data.kind !== 'bytes') throw new Error('se esperaba una escritura completa');
      return ok({ ...openedFile(target.name, memorySource(data.bytes)), canSaveInPlace: target.canSaveInPlace });
    });
    const pending = saveTextEdits();
    await answerChoice(editTextMsg.save);
    expect(await pending).toBe('saved');
    expect(callsOf('edit-text')).toEqual([
      { password: null, edits: [{ pageIndex: 0, hint: [99.5, 698.8, 140.5, 707.2], text: 'Hola A' }], now: expect.any(String) },
    ]);
    expect(h.save.mock.calls[0]?.[1]?.kind).toBe('bytes');
    expect(useEditText.getState().edits).toHaveLength(0);
    expect(pendingChanges()).toBeNull();
    expect(useViewer.getState().notice?.text).toBe(editTextMsg.done(1));
  });

  it('con firmas digitales la confirmación incluye el aviso; sin firmas, no', async () => {
    await openView();
    await createEdit('Hola A');
    handle('verify-signatures', () => Promise.resolve(ok([{} as unknown as SignatureStatus])));
    const pending = saveTextEdits();
    await vi.waitFor(() => {
      expect(useChoice.getState().active).not.toBeNull();
    });
    expect(useChoice.getState().active?.message).toBe(`${editTextMsg.confirmBody(1)} ${editTextMsg.signaturesWarning}`);
    await answerChoice(editTextMsg.cancel);
    await pending;

    handle('verify-signatures', () => Promise.resolve(ok([])));
    const second = saveTextEdits();
    await vi.waitFor(() => {
      expect(useChoice.getState().active).not.toBeNull();
    });
    expect(useChoice.getState().active?.message).toBe(editTextMsg.confirmBody(1));
    await answerChoice(editTextMsg.cancel);
    expect(await second).toBe('cancelled');
  });

  it('un error de la operación muestra su aviso y deja las ediciones intactas', async () => {
    await openView();
    await createEdit('Hola A');
    handle('edit-text', () => Promise.resolve(err({ code: 'pdf-error', message: 'No se pudo escribir.' } as AppError)));
    const pending = saveTextEdits();
    await answerChoice(editTextMsg.save);
    expect(await pending).toBe('failed');
    expect(useViewer.getState().notice?.text).toBe('No se pudo escribir.');
    expect(texts()).toEqual(['Hola A']);
    expect(useEditText.getState().status).toBe('idle');
  });

  it('un error al comprobar las firmas impide guardar', async () => {
    await openView();
    await createEdit('Hola A');
    handle('verify-signatures', () => Promise.resolve(err({ code: 'pdf-error', message: 'Firmas ilegibles.' } as AppError)));
    expect(await saveTextEdits()).toBe('failed');
    expect(useViewer.getState().notice?.text).toBe('Firmas ilegibles.');
    expect(callsOf('edit-text')).toHaveLength(0);
    expect(texts()).toEqual(['Hola A']);
  });

  it('cancelar la operación en curso no escribe nada y deja las ediciones', async () => {
    await openView();
    await createEdit('Hola A');
    let started = false;
    handle('edit-text', (_args, opts) => {
      started = true;
      return new Promise((resolve) => {
        opts?.signal?.addEventListener('abort', () => {
          resolve(err({ code: 'cancelled', message: 'Cancelado.' } as AppError));
        });
      });
    });
    const pending = saveTextEdits();
    await answerChoice(editTextMsg.save);
    await vi.waitFor(() => {
      expect(started).toBe(true);
    });
    cancelDocOp();
    expect(await pending).toBe('cancelled');
    expect(h.save).not.toHaveBeenCalled();
    expect(texts()).toEqual(['Hola A']);
    expect(useEditText.getState().status).toBe('idle');
  });

  it('si hay otro trabajo en curso no guarda y lo indica como cancelado', async () => {
    await openView();
    await createEdit('Hola A');
    const busy = beginJob('Otra operación');
    expect(busy).not.toBeNull();
    const pending = saveTextEdits();
    await answerChoice(editTextMsg.save);
    expect(await pending).toBe('cancelled');
    expect(callsOf('edit-text')).toHaveLength(0);
    if (busy !== null) endJob(busy);
  });

  it('si el documento cambia mientras se confirma, no escribe', async () => {
    await openView();
    await createEdit('Hola A');
    const pending = saveTextEdits();
    await vi.waitFor(() => {
      expect(useChoice.getState().active).not.toBeNull();
    });
    useViewer.setState({ file: null });
    await answerChoice(editTextMsg.save);
    expect(await pending).toBe('cancelled');
    expect(callsOf('edit-text')).toHaveLength(0);
    expect(texts()).toEqual([]);
  });

  it('con un guardado ya en curso devuelve cancelado', async () => {
    await openView();
    await createEdit('Hola A');
    useEditText.setState({ status: 'saving' });
    expect(await saveTextEdits()).toBe('cancelled');
    useEditText.setState({ status: 'idle' });
  });

  it('el cambio pendiente guarda con su función y se descarta sin preguntar', async () => {
    await openView();
    await createEdit('Hola A');
    const changes = pendingChanges();
    expect(changes?.isDirty()).toBe(true);
    const pending = changes?.save();
    await answerChoice(editTextMsg.cancel);
    expect(await pending).toBe('cancelled');
    expect(texts()).toEqual(['Hola A']);
    pendingChanges()?.discard();
    expect(texts()).toEqual([]);
    expect(pendingChanges()).toBeNull();
  });
});

describe('herramienta y pestañas', () => {
  it('cambiar de pestaña conserva las ediciones y el historial; volver los restaura', async () => {
    await openRequested(openedFile(FIXTURE, memorySource(h.original)));
    await vi.waitFor(() => {
      expect(useViewer.getState().status).toBe('ready');
    });
    await waitForScan();
    useViewer.setState({ pdf: fakePdf(ITEMS) });
    setEditTextTool(true);
    await createEdit('Hola A');

    await openRequested(openedFile('page-labels.pdf', fixtureSource('page-labels.pdf')));
    await vi.waitFor(() => {
      expect(useViewer.getState().status).toBe('ready');
    });
    expect(texts()).toEqual([]);
    expect(useEditText.getState().active).toBe(false);
    expect(pendingChanges()).toBeNull();

    const original = useTabs.getState().tabs.find((t) => t.title === FIXTURE);
    activateTab(original?.id ?? '');
    await vi.waitFor(() => {
      expect(useViewer.getState().status).toBe('ready');
    });
    expect(texts()).toEqual(['Hola A']);
    expect(useEditText.getState().active).toBe(true);
    expect(pendingChanges()?.isDirty()).toBe(true);
    editTextUndo();
    expect(texts()).toEqual([]);
  });
});
