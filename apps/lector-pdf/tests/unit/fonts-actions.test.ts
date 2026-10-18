import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { memorySource, type OpenedFile } from '@suite/platform';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cancelFontScan, resetFontScan, startFontScan } from '../../src/state/fonts-actions';
import { initialFontScan, useFontScan } from '../../src/state/fonts-store';
import { initialViewerState, useViewer } from '../../src/state/viewer-store';
import { FIXTURES_DIR } from '../fixtures/paths';
import { countingSource } from '../helpers/pdfjs-node';

/** Abre el documento de prueba (con una fuente de lectura que cuenta los bytes pedidos) en el visor. */
function openWith(path: string): ReturnType<typeof countingSource> {
  const data = new Uint8Array(readFileSync(path));
  const source = countingSource(memorySource(data));
  const file: OpenedFile = {
    token: 'fonts-test',
    name: 'doc.pdf',
    path: null,
    size: data.length,
    lastModified: null,
    canSaveInPlace: false,
    source,
  };
  useViewer.setState({ ...initialViewerState, status: 'ready', file });
  return source;
}

/** Espera a que el escaneo llegue a `status` (o a que lo haga el progreso indicado). */
async function until(predicate: () => boolean): Promise<void> {
  await vi.waitFor(() => {
    if (!predicate()) throw new Error('condición no alcanzada');
  }, { timeout: 10_000, interval: 1 });
}

afterEach(() => {
  resetFontScan();
  useViewer.setState(initialViewerState);
  useFontScan.setState(initialFontScan);
});

describe('escaneo de fuentes (estado)', () => {
  it('basic-5.pdf: termina en done con la fuente Helvetica y progreso igual al total de páginas', async () => {
    openWith(join(FIXTURES_DIR, 'basic-5.pdf'));
    startFontScan();
    await until(() => useFontScan.getState().status === 'done');
    const state = useFontScan.getState();
    expect(state.pagesDone).toBe(5);
    expect(state.total).toBe(5);
    expect(state.fonts.map((f) => f.name)).toEqual(['Helvetica']);
  });

  it('sin documento abierto no empieza ningún escaneo', () => {
    startFontScan();
    expect(useFontScan.getState().status).toBe('idle');
  });

  it('cerrar el diálogo a mitad del escaneo lo cancela: no quedan lecturas en curso', async () => {
    const source = openWith(join(FIXTURES_DIR, 'pages-5000.pdf'));
    startFontScan();
    await until(() => useFontScan.getState().pagesDone > 0);
    resetFontScan();
    expect(useFontScan.getState()).toEqual(initialFontScan);

    // Las lecturas pendientes terminan y el escaneo no sigue: el número de lecturas se queda fijo.
    await new Promise((resolve) => { setTimeout(resolve, 50); });
    const readsAtReset = source.reads;
    await new Promise((resolve) => { setTimeout(resolve, 100); });
    expect(source.reads).toBe(readsAtReset);
    expect(useFontScan.getState().status).toBe('idle');
  });

  it('Detener deja lo encontrado con status cancelled y no sigue leyendo', async () => {
    const source = openWith(join(FIXTURES_DIR, 'pages-5000.pdf'));
    startFontScan();
    await until(() => useFontScan.getState().pagesDone > 0);
    cancelFontScan();
    const state = useFontScan.getState();
    expect(state.status).toBe('cancelled');
    expect(state.pagesDone).toBeLessThan(5000);

    await new Promise((resolve) => { setTimeout(resolve, 50); });
    const readsAtCancel = source.reads;
    await new Promise((resolve) => { setTimeout(resolve, 100); });
    expect(source.reads).toBe(readsAtCancel);
    expect(useFontScan.getState().pagesDone).toBe(state.pagesDone);
  });

  it('un escaneo terminado o detenido no vuelve a empezar al seleccionar otra vez la pestaña', async () => {
    openWith(join(FIXTURES_DIR, 'basic-5.pdf'));
    startFontScan();
    await until(() => useFontScan.getState().status === 'done');
    startFontScan();
    expect(useFontScan.getState().status).toBe('done');
  });
});
