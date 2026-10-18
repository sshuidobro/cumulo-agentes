import { describe, expect, it, vi, afterEach } from 'vitest';
import { memorySource, platformError, type SaveData } from '@suite/platform';
import { err, ok } from '@suite/shared';
import { PDF_ERROR_MESSAGES } from '../../src/core/errors';
import { addAnnotation, endAnnotationSession } from '../../src/state/annotation-actions';
import { useAnnotations } from '../../src/state/annotation-store';
import { PDF_FILTERS, openDocument } from '../../src/state/document-actions';
import { setCurrentPage } from '../../src/state/navigation';
import { isSaving, save, saveAs } from '../../src/state/save-actions';
import { startPositionSync } from '../../src/state/position-sync';
import { setZoomMode } from '../../src/state/view-actions';
import { useViewer } from '../../src/state/viewer-store';
import { openedFile } from '../helpers/fake-platform';
import {
  answerChoice,
  CLEAN_TITLE,
  concat,
  DIRTY_TITLE,
  FIXTURE,
  fixtureBytes,
  openFixture,
  replaceableSource,
  setupSaveHarness,
  waitForScan,
} from '../helpers/save-harness';
import { newAnnotation } from './annotations/factories';
import { appendIncrementalUpdate } from '../fixtures/pdf-builder';

const h = setupSaveHarness();

afterEach(() => {
  vi.unstubAllGlobals();
});

/** Resaltado nuevo en la página 1 del documento de prueba. */
function addHighlight(): void {
  addAnnotation(newAnnotation('suite-hl-1', 'highlight', 0));
}

describe('save: guardar en sitio', () => {
  it('anexa el resaltado con append y reabre el fichero: la línea base lo contiene y no queda nada por deshacer', async () => {
    const file = await openFixture();
    addHighlight();
    expect(useAnnotations.getState().undo.isDirty).toBe(true);

    expect(await save()).toBe('saved');

    expect(h.save).toHaveBeenCalledTimes(1);
    const [target, data] = h.save.mock.calls[0] as unknown as [unknown, SaveData];
    expect(target).toBe(file);
    expect(data.kind).toBe('append');
    if (data.kind !== 'append') throw new Error('se esperaba append');
    expect(data.expectedSize).toBe(file.size);
    expect(data.delta.byteLength).toBeGreaterThan(0);

    expect(useViewer.getState().file).not.toBe(file);
    await waitForScan();
    const baseline = [...useAnnotations.getState().baseline.values()];
    expect(baseline).toHaveLength(1);
    expect(baseline[0]).toMatchObject({ type: 'highlight', pageIndex: 0, origin: { kind: 'file' } });
    expect(useAnnotations.getState().undo.canUndo).toBe(false);
    expect(h.setTitle).toHaveBeenLastCalledWith(CLEAN_TITLE);
    expect(h.setTitle).not.toHaveBeenLastCalledWith(DIRTY_TITLE);
    expect(useViewer.getState().notice?.text).toBe('Guardado.');
  });

  it('una llamada mientras se guarda devuelve cancelled sin tocar la plataforma', async () => {
    await openFixture();
    addHighlight();

    const first = save();
    expect(isSaving()).toBe(true);
    expect(await saveAs()).toBe('cancelled');
    expect(await save()).toBe('cancelled');

    expect(await first).toBe('saved');
    expect(h.save).toHaveBeenCalledTimes(1);
    expect(h.saveAs).not.toHaveBeenCalled();
    expect(isSaving()).toBe(false);
  });

  it('sin cambios → nothing y la plataforma no se llama', async () => {
    await openFixture();
    expect(await save()).toBe('nothing');
    expect(h.save).not.toHaveBeenCalled();
    expect(h.saveAs).not.toHaveBeenCalled();
  });

  it('PDF cifrado → aviso de save-encrypted y la plataforma no se llama', async () => {
    const source = replaceableSource(h.original);
    await openFixture(source.source);
    source.replace(appendIncrementalUpdate(h.original, new Map([[1, '<< /Type /Catalog /Pages 2 0 R >>']]), '/Encrypt 9 0 R'));
    addHighlight();

    expect(await save()).toBe('failed');
    expect(useViewer.getState().notice?.text).toBe(PDF_ERROR_MESSAGES['save-encrypted']);
    expect(h.save).not.toHaveBeenCalled();
  });

  it('PDF dañado tras abrirlo → aviso de save-unreadable y la plataforma no se llama', async () => {
    const source = replaceableSource(h.original);
    await openFixture(source.source);
    source.replace(fixtureBytes('corrupt-bad-startxref.pdf'));
    addHighlight();

    expect(await save()).toBe('failed');
    expect(useViewer.getState().notice?.text).toBe(PDF_ERROR_MESSAGES['save-unreadable']);
    expect(h.save).not.toHaveBeenCalled();
  });

  it('changed-on-disk → diálogo con el mensaje de la plataforma; «Guardar como…» llama a saveAs', async () => {
    await openFixture();
    addHighlight();
    h.save.mockResolvedValueOnce(err(platformError('changed-on-disk')));

    const pending = save();
    expect(await answerChoice('Guardar como…')).toBe('El fichero ha cambiado');

    expect(await pending).toBe('cancelled');
    expect(h.saveAs).toHaveBeenCalledTimes(1);
    expect(h.saveAs).toHaveBeenCalledWith(FIXTURE, PDF_FILTERS, expect.objectContaining({ kind: 'append' }));
  });

  it('changed-on-disk con «Cancelar» no llama a saveAs', async () => {
    await openFixture();
    addHighlight();
    h.save.mockResolvedValueOnce(err(platformError('changed-on-disk')));

    const pending = save();
    await answerChoice('Cancelar');

    expect(await pending).toBe('cancelled');
    expect(h.saveAs).not.toHaveBeenCalled();
  });

  it('la posición (página 3, zoom 150 %) se mantiene tras guardar', async () => {
    vi.stubGlobal('window', { addEventListener: () => undefined, removeEventListener: () => undefined });
    const stop = startPositionSync();
    try {
      await openFixture();
      // Lo que haría el visor al desplazarse: página 3 (índice 2) con zoom 150 %.
      setCurrentPage(2);
      setZoomMode({ kind: 'custom', zoom: 1.5 });
      addHighlight();

      expect(await save()).toBe('saved');

      expect(useViewer.getState().status).toBe('ready');
      // La restauración pide ir a la página 3; el visor la aplica al pintarse (aquí no hay visor).
      expect(useViewer.getState().navRequest?.page).toBe(2);
      expect(useViewer.getState().zoomMode).toEqual({ kind: 'custom', zoom: 1.5 });
    } finally {
      stop();
    }
  });
});

describe('saveAs: guardar como', () => {
  it('sin guardado en sitio (canSaveInPlace false) usa saveAs; descargado → título limpio y el documento no se reabre', async () => {
    const file = await openFixture(undefined, FIXTURE, false);
    addHighlight();
    h.saveAs.mockResolvedValueOnce(ok({ kind: 'downloaded', name: FIXTURE }));

    expect(await save()).toBe('downloaded');

    expect(h.save).not.toHaveBeenCalled();
    expect(h.saveAs).toHaveBeenCalledWith(FIXTURE, PDF_FILTERS, expect.objectContaining({ kind: 'append', base: file }));
    expect(useViewer.getState().file).toBe(file);
    expect(h.closeFile).not.toHaveBeenCalled();
    expect(useAnnotations.getState().undo.isDirty).toBe(false);
    expect(h.setTitle).toHaveBeenLastCalledWith(CLEAN_TITLE);
    expect(useViewer.getState().notice?.text).toBe(`Se ha descargado «${FIXTURE}» con tus anotaciones.`);
  });

  it('guardado en disco con otro nombre → reabre el nuevo fichero y avisa «Guardado.»', async () => {
    await openFixture();
    addHighlight();
    const copy = openedFile('copia.pdf', memorySource(concat(h.original, new Uint8Array(0))));
    h.saveAs.mockResolvedValueOnce(ok({ kind: 'saved', file: copy }));

    expect(await saveAs()).toBe('saved');

    expect(useViewer.getState().file?.name).toBe('copia.pdf');
    expect(useViewer.getState().notice?.text).toBe('Guardado.');
  });

  it('sin cambios, guardar como pide una copia con delta vacío', async () => {
    const file = await openFixture();
    h.saveAs.mockResolvedValueOnce(ok({ kind: 'cancelled' }));

    expect(await saveAs()).toBe('cancelled');

    expect(h.saveAs).toHaveBeenCalledWith(FIXTURE, PDF_FILTERS, {
      kind: 'append',
      base: file,
      expectedSize: file.size,
      delta: new Uint8Array(0),
    });
  });

  it('sin documento abierto no hace nada', async () => {
    endAnnotationSession();
    await openDocument(openedFile(FIXTURE, memorySource(new Uint8Array(0))));
    expect(await save()).toBe('nothing');
    expect(h.save).not.toHaveBeenCalled();
  });
});
