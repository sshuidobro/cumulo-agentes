import { createLogger } from '@suite/shared';
import { concatSource } from '../core/pdf';
import { loadPdf, type PDFDocumentProxy } from '../engine';
import { buildCurrentDelta } from './save-actions';
import { services } from './services';
import { hasUnsavedChanges } from './unsaved-guard';
import { useViewer } from './viewer-store';

const log = createLogger('print-source');

/** Documento del que se imprime. `dispose()` libera solo el temporal: el documento abierto nunca se toca. */
export interface PrintSource {
  readonly doc: PDFDocumentProxy;
  readonly temporary: boolean;
  /** `false` si había cambios sin guardar que no se han podido incluir en el documento. */
  readonly unsavedIncluded: boolean;
  dispose(): Promise<void>;
}

/**
 * Documento a imprimir: el abierto si no hay cambios; si los hay, uno temporal con `concatSource(file.source, delta)`.
 * Si el delta falla, el abierto con `unsavedIncluded: false`. `null` si no hay ningún documento listo.
 */
export async function openPrintSource(): Promise<PrintSource | null> {
  const { status, file, pdf } = useViewer.getState();
  if (status !== 'ready' || file === null || pdf === null) return null;

  const opened = (unsavedIncluded: boolean): PrintSource => ({
    doc: pdf.doc,
    temporary: false,
    unsavedIncluded,
    dispose: () => Promise.resolve(),
  });
  if (!hasUnsavedChanges()) return opened(true);

  const built = await buildCurrentDelta(file);
  if (!built.ok) {
    log.warn('openPrintSource', built.error.code);
    return opened(false);
  }
  // Sin delta, el documento abierto ya contiene lo mismo que se guardaría.
  if (built.value === null) return opened(true);

  const temporary = await loadPdf(concatSource(file.source, built.value), { assetBaseUrl: services().assetBaseUrl });
  if (!temporary.ok) {
    log.warn('openPrintSource', temporary.error.code);
    return opened(false);
  }
  const loaded = temporary.value;
  return {
    doc: loaded.doc,
    temporary: true,
    unsavedIncluded: true,
    dispose: () => loaded.destroy(),
  };
}
