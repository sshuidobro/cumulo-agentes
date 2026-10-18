import { describe, expect, it } from 'vitest';
import type { PDFDocumentProxy } from '../../src/engine';
import { addAnnotation, endAnnotationSession } from '../../src/state/annotation-actions';
import { openPrintSource } from '../../src/state/print-source';
import { initialViewerState, useViewer } from '../../src/state/viewer-store';
import { appendIncrementalUpdate } from '../fixtures/pdf-builder';
import { openFixture, replaceableSource, setupSaveHarness } from '../helpers/save-harness';
import { newAnnotation } from './annotations/factories';

// Este fichero va en tests/unit: la configuración de Vitest solo recoge tests/ui/*.test.tsx.
const h = setupSaveHarness();

/** Resaltado nuevo (sin guardar) en la página 1 del documento de prueba. */
function addUnsavedHighlight(): void {
  addAnnotation(newAnnotation('suite-hl-print', 'highlight', 0));
}

/** Subtipos de las anotaciones de una página de un PDF de pdf.js. */
async function subtypesOfPage1(doc: PDFDocumentProxy): Promise<string[]> {
  const page = await doc.getPage(1);
  const annotations: readonly { readonly subtype?: string }[] = await page.getAnnotations({ intent: 'display' });
  return annotations.map((a) => a.subtype ?? '');
}

describe('openPrintSource', () => {
  it('sin cambios usa el documento abierto y dispose no lo destruye', async () => {
    await openFixture();
    const opened = useViewer.getState().pdf?.doc;
    expect(opened).toBeDefined();

    const source = await openPrintSource();
    expect(source).not.toBeNull();
    expect(source?.temporary).toBe(false);
    expect(source?.unsavedIncluded).toBe(true);
    expect(source?.doc).toBe(opened);

    await source?.dispose();
    if (opened === undefined) throw new Error('sin documento abierto');
    await expect(opened.getPage(1)).resolves.toBeDefined();
  });

  it('con una anotación sin guardar usa un documento temporal que la contiene', async () => {
    await openFixture();
    const opened = useViewer.getState().pdf?.doc;
    addUnsavedHighlight();

    const source = await openPrintSource();
    expect(source).not.toBeNull();
    expect(source?.temporary).toBe(true);
    expect(source?.unsavedIncluded).toBe(true);
    if (source === null || opened === undefined) throw new Error('falta el documento');
    expect(source.doc).not.toBe(opened);

    expect(await subtypesOfPage1(source.doc)).toContain('Highlight');
    // El documento abierto no cambia: la anotación solo existe en la copia para imprimir.
    expect(await subtypesOfPage1(opened)).not.toContain('Highlight');

    await source.dispose();
    await expect(async () => { await source.doc.getPage(1); }).rejects.toThrow();
    await expect(opened.getPage(1)).resolves.toBeDefined();
  });

  it('si el incremento no se puede construir (PDF cifrado) usa el abierto con unsavedIncluded false', async () => {
    const replaceable = replaceableSource(h.original);
    await openFixture(replaceable.source);
    const opened = useViewer.getState().pdf?.doc;
    replaceable.replace(appendIncrementalUpdate(h.original, new Map([[1, '<< /Type /Catalog /Pages 2 0 R >>']]), '/Encrypt 9 0 R'));
    addUnsavedHighlight();

    const source = await openPrintSource();
    expect(source).not.toBeNull();
    expect(source?.temporary).toBe(false);
    expect(source?.unsavedIncluded).toBe(false);
    expect(source?.doc).toBe(opened);
  });

  it('sin documento listo devuelve null', async () => {
    endAnnotationSession();
    useViewer.setState(initialViewerState);
    expect(await openPrintSource()).toBeNull();
  });
});
