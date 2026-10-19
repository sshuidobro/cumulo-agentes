import { createLogger } from '@suite/shared';
import type { ByteSource } from '@suite/platform';
import { mergeFonts, openForSave, scanFonts, type FontInfo } from '../core/pdf';
import { currentPassword } from './document-actions';
import { initialFontScan, useFontScan } from './fonts-store';
import { useViewer } from './viewer-store';

const log = createLogger('fonts-actions');

/** Páginas por lote; entre lotes se cede el hilo principal (PDF-088). */
const BATCH_PAGES = 200;

/** Escaneo en curso, si lo hay. */
let active: AbortController | null = null;

/**
 * Empieza el escaneo de fuentes del documento abierto. No hace nada si ya hay uno en curso o si ya terminó
 * o se detuvo (hasta que se reinicie con `resetFontScan`). Tras un error, vuelve a intentarlo.
 */
export function startFontScan(): void {
  if (active !== null) return;
  const status = useFontScan.getState().status;
  if (status === 'done' || status === 'cancelled') return;
  const file = useViewer.getState().file;
  if (file === null) return;

  const controller = new AbortController();
  active = controller;
  useFontScan.setState({ ...initialFontScan, status: 'scanning' });
  void runScan(file.source, controller);
}

/** Detiene el escaneo en curso. Lo publicado hasta ese momento se queda en el estado con `cancelled`. */
export function cancelFontScan(): void {
  if (active === null) return;
  active.abort();
  active = null;
  useFontScan.setState({ status: 'cancelled' });
}

/** Cancela cualquier escaneo y vuelve al estado inicial (al cerrar el diálogo o cambiar de documento). */
export function resetFontScan(): void {
  cancelFontScan();
  useFontScan.setState(initialFontScan);
}

async function runScan(source: ByteSource, controller: AbortController): Promise<void> {
  const { signal } = controller;
  try {
    const opened = await openForSave(source, currentPassword() ?? undefined);
    if (signal.aborted) return;
    if (!opened.ok) {
      log.warn('startFontScan', opened.error.code);
      finish('error');
      return;
    }
    const reader = opened.value;
    const total = await reader.pageCount();
    if (signal.aborted) return;
    useFontScan.setState({ total });

    let fonts: readonly FontInfo[] = [];
    let pagesDone = 0;
    while (pagesDone < total) {
      const to = Math.min(total, pagesDone + BATCH_PAGES);
      const part = await scanFonts(reader, pagesDone, to, signal);
      if (part === 'cancelled' || signal.aborted) return;
      fonts = mergeFonts(fonts, part);
      pagesDone = to;
      useFontScan.setState({ fonts, pagesDone });
      await yieldToEventLoop();
      if (signal.aborted) return;
    }
    finish('done');
  } catch (error: unknown) {
    if (signal.aborted) return;
    log.warn('startFontScan', error);
    finish('error');
  }

  function finish(status: 'done' | 'error'): void {
    if (active === controller) active = null;
    useFontScan.setState({ status });
  }
}

function yieldToEventLoop(): Promise<void> {
  return new Promise((resolve) => { setTimeout(resolve, 0); });
}
