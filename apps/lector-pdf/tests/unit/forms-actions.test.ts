import { createStorageStore, memorySource, type Platform } from '@suite/platform';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EMPTY_EDITS } from '../../src/core/annotations/model';
import type { FieldValue } from '../../src/core/forms';
import { loadPdf, type LoadedPdf, type PDFDocumentProxy } from '../../src/engine';
import {
  endAnnotationSession,
  recoverEdits,
  redo,
  startAnnotationSession,
  undo,
} from '../../src/state/annotation-actions';
import { useAnnotations } from '../../src/state/annotation-store';
import { endFormSession, fieldValue, setFieldValue, setFormHighlight, startFormSession } from '../../src/state/form-actions';
import { useForms } from '../../src/state/form-store';
import { initServices } from '../../src/state/services';
import { initialViewerState, useViewer } from '../../src/state/viewer-store';
import { createFakePlatform, openedFile } from '../helpers/fake-platform';
import { fixtureSource, nodeAssetBase } from '../helpers/pdfjs-node';

const OPEN_TIMEOUT = 30_000;
const TEXT_NAME = 'nombre';
const TEXT_VALUE: FieldValue = { kind: 'text', text: 'Luis' };

const opened: LoadedPdf[] = [];

async function openForm(): Promise<LoadedPdf> {
  const result = await loadPdf(fixtureSource('form-full.pdf'), { assetBaseUrl: nodeAssetBase() });
  if (!result.ok) throw new Error(`No se pudo abrir form-full.pdf: ${result.error.code}`);
  opened.push(result.value);
  return result.value;
}

/** Abre el documento como la app: primero las anotaciones, después los formularios. Espera al escaneo. */
async function openDocument(): Promise<LoadedPdf> {
  const pdf = await openForm();
  useViewer.setState({
    ...initialViewerState,
    status: 'ready',
    file: openedFile('form-full.pdf', memorySource(new Uint8Array([0x25]))),
  });
  startAnnotationSession(pdf, new AbortController().signal);
  startFormSession(pdf);
  await vi.waitFor(
    () => {
      expect(useAnnotations.getState().scan).toBe('done');
    },
    { timeout: OPEN_TIMEOUT },
  );
  return pdf;
}

/** Ids de pdf.js de los widgets de un campo. */
function widgetIds(name: string): readonly string[] {
  const field = useForms.getState().fields.get(name);
  if (field === undefined) throw new Error(`Falta el campo «${name}»`);
  return field.widgets.map((w) => w.id);
}

/** Valor que el lienzo leería del storage de un widget. */
function storedValue(doc: PDFDocumentProxy, id: string): unknown {
  const entry: unknown = doc.annotationStorage.getValue(id, {});
  return typeof entry === 'object' && entry !== null && 'value' in entry ? entry.value : undefined;
}

function pageVersionOf(index: number): number {
  return useAnnotations.getState().pageVersion.get(index) ?? 0;
}

let doc: PDFDocumentProxy;

beforeEach(() => {
  const platform: Platform = createFakePlatform({ prefs: createStorageStore(null, 'test.') });
  initServices({ platform, assetBaseUrl: '' });
  endFormSession();
  endAnnotationSession();
  useViewer.setState(initialViewerState);
});

afterEach(async () => {
  endFormSession();
  endAnnotationSession();
  useViewer.setState(initialViewerState);
  for (const pdf of opened.splice(0)) await pdf.destroy();
});

describe('sesión de formularios sobre form-full.pdf', () => {
  it('importa los 14 campos y agrupa por página los de la primera', async () => {
    const pdf = await openDocument();
    doc = pdf.doc;
    const { fields, byPage } = useForms.getState();
    expect(fields.size).toBe(14);
    expect((byPage.get(0) ?? []).slice(0, 3)).toEqual(['nombre', 'comentarios', 'codigo']);
  });

  it('setFieldValue escribe el valor en los dos widgets, sube la versión de sus páginas y deja una entrada de deshacer', async () => {
    const pdf = await openDocument();
    doc = pdf.doc;
    const ids = widgetIds(TEXT_NAME);
    expect(ids).toHaveLength(2);
    const before0 = pageVersionOf(0);
    const before1 = pageVersionOf(1);

    setFieldValue(TEXT_NAME, TEXT_VALUE);

    for (const id of ids) expect(storedValue(doc, id)).toBe('Luis');
    expect(pageVersionOf(0)).toBe(before0 + 1);
    expect(pageVersionOf(1)).toBe(before1 + 1);
    expect(useAnnotations.getState().undo.undoLabel).toBe('rellenar «nombre»');
    expect(useAnnotations.getState().undo.isDirty).toBe(true);
    expect(fieldValue(TEXT_NAME)).toEqual(TEXT_VALUE);
  });

  it('undo quita las claves del storage y deja el documento limpio; redo las vuelve a poner', async () => {
    const pdf = await openDocument();
    doc = pdf.doc;
    const ids = widgetIds(TEXT_NAME);
    setFieldValue(TEXT_NAME, TEXT_VALUE);

    undo();
    for (const id of ids) expect(storedValue(doc, id)).toBeUndefined();
    expect(useAnnotations.getState().undo.isDirty).toBe(false);
    expect(fieldValue(TEXT_NAME)).toEqual(useForms.getState().fields.get(TEXT_NAME)?.initial);

    redo();
    for (const id of ids) expect(storedValue(doc, id)).toBe('Luis');
    expect(useAnnotations.getState().undo.isDirty).toBe(true);
  });

  it('un campo de solo lectura o inexistente no cambia nada ni deja entrada de deshacer', async () => {
    await openDocument();
    setFieldValue('solo_lectura', { kind: 'text', text: 'Otro' });
    setFieldValue('no_existe', { kind: 'text', text: 'x' });
    expect(useAnnotations.getState().undo.undoDepth).toBe(0);
    expect(fieldValue('no_existe')).toBeNull();
  });

  it('una opción de grupo se marca solo en el widget de la opción elegida', async () => {
    const pdf = await openDocument();
    doc = pdf.doc;
    const widgets = useForms.getState().fields.get('color')?.widgets ?? [];
    expect(widgets).toHaveLength(3);

    setFieldValue('color', { kind: 'radio', selected: 'Azul' });

    const marked = widgets.filter((w) => storedValue(doc, w.id) === true).map((w) => w.onState);
    const unmarked = widgets.filter((w) => storedValue(doc, w.id) === false).map((w) => w.onState);
    expect(marked).toEqual(['Azul']);
    expect(unmarked).toHaveLength(2);
  });

  it('recuperar un borrador con un campo deja su valor en el storage y una sola entrada de deshacer', async () => {
    const pdf = await openDocument();
    doc = pdf.doc;
    const ids = widgetIds(TEXT_NAME);

    recoverEdits({ ...EMPTY_EDITS, fields: new Map([[TEXT_NAME, { kind: 'text', text: 'Eva' }]]) });

    for (const id of ids) expect(storedValue(doc, id)).toBe('Eva');
    expect(useAnnotations.getState().undo.undoDepth).toBe(1);
    expect(useAnnotations.getState().undo.undoLabel).toBe('recuperar cambios');
  });

  it('al cerrar la sesión el store queda vacío y setFieldValue ya no hace nada', async () => {
    await openDocument();
    endFormSession();
    expect(useForms.getState().fields.size).toBe(0);

    setFieldValue(TEXT_NAME, TEXT_VALUE);
    expect(useAnnotations.getState().undo.undoDepth).toBe(0);
  });

  it('tras cerrar la sesión, recuperar un borrador ya no toca el storage (sin listeners vivos)', async () => {
    const pdf = await openDocument();
    doc = pdf.doc;
    const ids = widgetIds(TEXT_NAME);
    endFormSession();

    recoverEdits({ ...EMPTY_EDITS, fields: new Map([[TEXT_NAME, { kind: 'text', text: 'Eva' }]]) });

    for (const id of ids) expect(storedValue(doc, id)).toBeUndefined();
  });

  it('un borrador recuperado antes de importar las páginas se pinta al importarlas', async () => {
    const pdf = await openForm();
    useViewer.setState({
      ...initialViewerState,
      status: 'ready',
      file: openedFile('form-full.pdf', memorySource(new Uint8Array([0x25]))),
    });
    startAnnotationSession(pdf, new AbortController().signal);
    recoverEdits({ ...EMPTY_EDITS, fields: new Map([[TEXT_NAME, { kind: 'text', text: 'Eva' }]]) });
    startFormSession(pdf);
    expect(useForms.getState().fields.size).toBe(0);
    await vi.waitFor(
      () => {
        expect(useForms.getState().fields.size).toBe(14);
      },
      { timeout: OPEN_TIMEOUT },
    );
    for (const id of widgetIds(TEXT_NAME)) expect(storedValue(pdf.doc, id)).toBe('Eva');
  });

  it('el resaltado se guarda como preferencia y se reutiliza al abrir de nuevo', async () => {
    await openDocument();
    expect(useForms.getState().highlight).toBe(true);
    setFormHighlight(false);
    expect(useForms.getState().highlight).toBe(false);

    endFormSession();
    const pdf = await openForm();
    startFormSession(pdf);
    expect(useForms.getState().highlight).toBe(false);
  });
});
