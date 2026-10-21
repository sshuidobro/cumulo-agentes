import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { memorySource, platformError, type SaveData } from '@suite/platform';
import { err, ok } from '@suite/shared';
import { pdfError } from '../../src/core/errors';
import type { DocOpsClient } from '../../src/core/doc-ops/client';
import { openForSave } from '../../src/core/pdf';
import {
  addCombineFiles,
  combineFiles,
  moveCombineItem,
  openCombineDialog,
  removeCombineItem,
  useCombineDialog,
  type CombineItem,
} from '../../src/state/combine-actions';
import { registerDocumentParticipant } from '../../src/state/document-actions';
import { setDocOpsRunner } from '../../src/state/doc-ops';
import { registerOrganizeParticipant } from '../../src/state/organize-actions';
import { useOrganize, initialOrganizeState } from '../../src/state/organize-store';
import { resetTabsForTests, useTabs } from '../../src/state/tabs';
import { useViewer } from '../../src/state/viewer-store';
import { organizeMsg } from '../../src/ui/messages-organize';
import { openedFile } from '../helpers/fake-platform';
import { fixtureBytes, openFixture, setupSaveHarness } from '../helpers/save-harness';

const h = setupSaveHarness();

beforeEach(() => {
  registerDocumentParticipant();
  registerOrganizeParticipant();
});

afterEach(() => {
  setDocOpsRunner(null);
  useCombineDialog.setState({ open: false, items: [] });
  useOrganize.setState(initialOrganizeState);
  resetTabsForTests();
});

/** Próxima respuesta del diálogo «Añadir archivos» con estos PDF (nombre y bytes). */
function pickFiles(files: readonly { readonly name: string; readonly bytes: Uint8Array }[]): void {
  vi.mocked(h.platform.importFiles).mockResolvedValueOnce(ok(files));
}

function itemsNow(): readonly CombineItem[] {
  return useCombineDialog.getState().items;
}

function names(): string[] {
  return itemsNow().map((item) => item.name);
}

/** Lee el PDF que se ha guardado con «Guardar como» (el primer argumento de `saveAs` es el nombre sugerido). */
async function savedBytes(call = 0): Promise<{ readonly name: string; readonly bytes: Uint8Array }> {
  const [name, , data] = h.saveAs.mock.calls[call] as unknown as [string, unknown, SaveData];
  if (data.kind !== 'bytes') throw new Error('se esperaban bytes');
  return { name, bytes: data.bytes };
}

async function pageCountOf(bytes: Uint8Array): Promise<number> {
  const reader = await openForSave(memorySource(bytes));
  if (!reader.ok) throw new Error(reader.error.message);
  return reader.value.pageCount();
}

describe('combine: la lista', () => {
  it('con basic-5.pdf abierto, el diálogo empieza con ese documento (5 páginas) y sus cambios sin guardar', async () => {
    await openFixture();
    openCombineDialog();
    expect(useCombineDialog.getState().open).toBe(true);
    expect(itemsNow()).toEqual([expect.objectContaining({ name: 'basic-5.pdf', pages: 5, source: 'current' })]);
  });

  it('sin documento abierto el diálogo empieza vacío', () => {
    openCombineDialog();
    expect(itemsNow()).toEqual([]);
  });

  it('añadir archivos los pone al final en el orden elegido y omite el que no se puede leer, con aviso', async () => {
    openCombineDialog();
    pickFiles([
      { name: 'outline.pdf', bytes: fixtureBytes('outline.pdf') },
      { name: 'roto.pdf', bytes: new Uint8Array([1, 2, 3]) },
      { name: 'basic-5.pdf', bytes: fixtureBytes('basic-5.pdf') },
    ]);
    await addCombineFiles();

    expect(names()).toEqual(['outline.pdf', 'basic-5.pdf']);
    expect(itemsNow().map((item) => item.pages)).toEqual([30, 5]);
    expect(useViewer.getState().notice?.text).toBe(organizeMsg.importFailed('roto.pdf'));
  });

  it('un PDF protegido pide la contraseña y se guarda con ella', async () => {
    openCombineDialog();
    pickFiles([{ name: 'encrypted-aes-256.pdf', bytes: fixtureBytes('encrypted-aes-256.pdf') }]);
    const pending = addCombineFiles();
    const { usePasswordPrompt, submitPassword } = await import('../../src/state/password-prompt');
    await vi.waitFor(() => {
      expect(usePasswordPrompt.getState().request).not.toBeNull();
    });
    submitPassword('usuario');
    await pending;

    const [item] = itemsNow();
    expect(item?.source).toEqual({ bytes: expect.any(Uint8Array), password: 'usuario' });
    expect(item?.pages).toBe(5);
  });

  it('más de 50 ficheros en total avisa y no añade ninguno', async () => {
    await openFixture();
    openCombineDialog();
    const many = Array.from({ length: 50 }, () => ({ name: 'x.pdf', bytes: new Uint8Array([1]) }));
    pickFiles(many);
    await addCombineFiles();

    expect(useViewer.getState().notice?.text).toBe(organizeMsg.combineLimit);
    expect(itemsNow()).toHaveLength(1);
  });

  it('el selector que devuelve «demasiado grande» (out-of-range) avisa y no añade nada', async () => {
    openCombineDialog();
    vi.mocked(h.platform.importFiles).mockResolvedValueOnce(err(platformError('out-of-range')));
    await addCombineFiles();

    expect(useViewer.getState().notice?.text).toBe(organizeMsg.combineLimit);
    expect(itemsNow()).toEqual([]);
  });

  it('subir, bajar y quitar cambian el orden; en los extremos no pasa nada', async () => {
    openCombineDialog();
    pickFiles([
      { name: 'outline.pdf', bytes: fixtureBytes('outline.pdf') },
      { name: 'basic-5.pdf', bytes: fixtureBytes('basic-5.pdf') },
    ]);
    await addCombineFiles();
    const [first, second] = itemsNow();
    expect(first && second).toBeTruthy();
    if (first === undefined || second === undefined) return;

    moveCombineItem(first.id, -1);
    expect(names()).toEqual(['outline.pdf', 'basic-5.pdf']);
    moveCombineItem(first.id, 1);
    expect(names()).toEqual(['basic-5.pdf', 'outline.pdf']);
    removeCombineItem(second.id);
    expect(names()).toEqual(['outline.pdf']);
  });
});

describe('combine: combinar y guardar', () => {
  it('con menos de dos elementos no hace nada', async () => {
    await openFixture();
    openCombineDialog();
    expect(await combineFiles()).toBe('failed');
    expect(h.saveAs).not.toHaveBeenCalled();
  });

  it('basic-5.pdf abierto + outline.pdf: guarda basic-5-combinado.pdf con 35 páginas y cierra el diálogo', async () => {
    await openFixture();
    openCombineDialog();
    pickFiles([{ name: 'outline.pdf', bytes: fixtureBytes('outline.pdf') }]);
    await addCombineFiles();
    h.saveAs.mockResolvedValueOnce(ok({ kind: 'downloaded', name: 'basic-5-combinado.pdf' }));

    expect(await combineFiles()).toBe('downloaded');
    const { name, bytes } = await savedBytes();
    expect(name).toBe('basic-5-combinado.pdf');
    expect(await pageCountOf(bytes)).toBe(35);
    expect(useCombineDialog.getState().open).toBe(false);
    expect(useViewer.getState().notice?.text).toBe(organizeMsg.combined('basic-5-combinado.pdf'));
  });

  it('guardado en el sistema: se abre el resultado en una pestaña nueva', async () => {
    await openFixture();
    openCombineDialog();
    pickFiles([{ name: 'outline.pdf', bytes: fixtureBytes('outline.pdf') }]);
    await addCombineFiles();
    const before = useTabs.getState().tabs.length;
    h.saveAs.mockImplementationOnce(async (suggested: string, _filters: unknown, data: SaveData) => {
      if (data.kind !== 'bytes') throw new Error('bytes');
      return ok({ kind: 'saved' as const, file: openedFile(suggested, memorySource(data.bytes)) });
    });

    expect(await combineFiles()).toBe('saved');
    expect(useTabs.getState().tabs.length).toBe(before + 1);
    expect(useViewer.getState().file?.name).toBe('basic-5-combinado.pdf');
  });

  it('cancelar el diálogo de guardar no guarda nada y deja la lista', async () => {
    await openFixture();
    openCombineDialog();
    pickFiles([{ name: 'outline.pdf', bytes: fixtureBytes('outline.pdf') }]);
    await addCombineFiles();
    h.saveAs.mockResolvedValueOnce(ok({ kind: 'cancelled' as const }));

    expect(await combineFiles()).toBe('cancelled');
    expect(itemsNow()).toHaveLength(2);
  });

  it('un error de la operación se avisa en español y no guarda', async () => {
    await openFixture();
    openCombineDialog();
    pickFiles([{ name: 'outline.pdf', bytes: fixtureBytes('outline.pdf') }]);
    await addCombineFiles();
    const failing: DocOpsClient = {
      run: async () => err(pdfError('save-unreadable')),
      dispose: () => undefined,
    };
    setDocOpsRunner(failing);

    expect(await combineFiles()).toBe('failed');
    expect(h.saveAs).not.toHaveBeenCalled();
    expect(useViewer.getState().notice?.text).toBeTruthy();
  });
});
