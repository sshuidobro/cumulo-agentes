import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createStorageStore } from '@suite/platform';
import type * as AnnotationsImportModule from '../../src/engine/annotations-import';
import type { PDFDocumentProxy } from '../../src/engine';
import { closeDocument, openRequested, registerDocumentParticipant } from '../../src/state/document-actions';
import { useChoice } from '../../src/state/choice';
import {
  addAnnotation,
  getEffective,
  redo,
  registerAnnotationParticipant,
  undo,
} from '../../src/state/annotation-actions';
import { useAnnotations } from '../../src/state/annotation-store';
import { fieldValue, registerFormsParticipant, setFieldValue } from '../../src/state/form-actions';
import { useForms } from '../../src/state/form-store';
import { initServices } from '../../src/state/services';
import { activateTab, closeTab, resetTabsForTests, useTabs } from '../../src/state/tabs';
import { initialViewerState, useViewer } from '../../src/state/viewer-store';
import { msg } from '../../src/ui/messages';
import { securityMsg } from '../../src/ui/messages-security';
import { createFakePlatform, openedFile } from '../helpers/fake-platform';
import { fixtureSource, nodeAssetBase } from '../helpers/pdfjs-node';
import { newAnnotation } from './annotations/factories';

/**
 * Control del escaneo de anotaciones de `pages-5000.pdf`: cada página a partir de la 51 espera a `open` mientras
 * `active` está activo. Así el escaneo queda parado a medio camino y se puede cambiar de pestaña.
 */
const gate = vi.hoisted(() => ({
  active: false,
  waiting: false,
  /** Páginas (1-based) pedidas por el escaneo de anotaciones desde el último reinicio. */
  requested: [] as number[],
  /** Primera página (0-based) de cada escaneo de anotaciones lanzado. */
  froms: [] as number[],
  open: null as (() => void) | null,
}));

vi.mock('../../src/engine/annotations-import', async (importOriginal) => {
  const actual = await importOriginal<typeof AnnotationsImportModule>();
  return {
    ...actual,
    scanAnnotations: (doc: PDFDocumentProxy, opts: Parameters<typeof actual.scanAnnotations>[1]) => {
      gate.froms.push(opts.from ?? 0);
      const spied = {
        numPages: doc.numPages,
        getPage: async (n: number) => {
          gate.requested.push(n);
          if (gate.active && n > 50) {
            gate.waiting = true;
            await new Promise<void>((resolve) => {
              gate.open = resolve;
            });
          }
          return doc.getPage(n);
        },
      };
      return actual.scanAnnotations(spied as unknown as PDFDocumentProxy, opts);
    },
  };
});

const assetBaseUrl = nodeAssetBase();
const setTitle = vi.fn();

function fileAt(name: string) {
  return { ...openedFile(name, fixtureSource(name)), path: `/docs/${name}` };
}

function activeId(): string {
  return useTabs.getState().activeId ?? '';
}

/** Espera a que se cumpla `condition` (sondeo breve, sin depender de la hora del sistema). */
async function waitUntil(condition: () => boolean, timeoutMs = 60_000): Promise<void> {
  const start = Date.now();
  while (!condition()) {
    if (Date.now() - start > timeoutMs) throw new Error('Tiempo agotado esperando una condición');
    await new Promise((resolve) => {
      setTimeout(resolve, 5);
    });
  }
}

function notesVisible(): number {
  return [...getEffective().values()].filter((a) => a.type === 'note').length;
}

/** Cuenta los avisos nuevos que se muestran en el visor. */
function countNotices(): { readonly count: () => number; readonly stop: () => void } {
  let count = 0;
  let last: number | null = null;
  const stop = useViewer.subscribe((s) => {
    const id = s.notice?.id ?? null;
    if (id !== null && id !== last) count += 1;
    last = id;
  });
  return { count: () => count, stop };
}

beforeEach(() => {
  initServices({
    platform: createFakePlatform({ setTitle, prefs: createStorageStore(null, 'test.') }),
    assetBaseUrl,
  });
  resetTabsForTests();
  registerDocumentParticipant();
  registerAnnotationParticipant();
  registerFormsParticipant();
  useViewer.setState({ ...initialViewerState });
  gate.active = false;
  gate.waiting = false;
  gate.requested.length = 0;
  gate.froms.length = 0;
  gate.open = null;
  setTitle.mockClear();
});

/**
 * Cierra todas las pestañas descartando los cambios: un documento con cambios sin guardar pregunta antes de cerrarse,
 * y sin respuesta la promesa de `closeTab` nunca se resuelve.
 */
async function closeAllTabsDiscarding(): Promise<void> {
  for (const tab of [...useTabs.getState().tabs]) {
    const closing = closeTab(tab.id);
    useChoice.getState().active?.options.find((o) => o.label === msg.discard)?.pick();
    await closing;
  }
}

afterEach(async () => {
  gate.active = false;
  gate.open?.();
  await closeAllTabsDiscarding();
  await closeDocument();
  resetTabsForTests();
});

describe('pestañas · anotaciones', () => {
  it('cada pestaña conserva sus notas, su deshacer y su resaltado; el título marca «• » en la activa', async () => {
    await openRequested(fileAt('basic-5.pdf'));
    const a = activeId();
    await waitUntil(() => useAnnotations.getState().scan === 'done');
    addAnnotation(newAnnotation('suite-1', 'note'));
    addAnnotation(newAnnotation('suite-2', 'note'));
    addAnnotation(newAnnotation('suite-3', 'note'));
    undo();
    expect(notesVisible()).toBe(2);
    expect(useAnnotations.getState().undo.canRedo).toBe(true);

    await openRequested(fileAt('links.pdf'));
    const b = activeId();
    await waitUntil(() => useAnnotations.getState().scan === 'done');
    addAnnotation(newAnnotation('suite-h', 'highlight'));
    expect(getEffective().has('suite-h')).toBe(true);
    expect(setTitle).toHaveBeenLastCalledWith('• links.pdf — Lector PDF');

    activateTab(a);
    expect(notesVisible()).toBe(2);
    expect(getEffective().has('suite-h')).toBe(false);
    expect(useAnnotations.getState().undo.canRedo).toBe(true);
    expect(setTitle).toHaveBeenLastCalledWith('• basic-5.pdf — Lector PDF');
    redo();
    expect(notesVisible()).toBe(3);
    expect(getEffective().has('suite-3')).toBe(true);

    activateTab(b);
    expect(getEffective().has('suite-h')).toBe(true);
    expect(notesVisible()).toBe(0);
    expect(setTitle).toHaveBeenLastCalledWith('• links.pdf — Lector PDF');
  });

  it('al volver a A el escaneo sigue desde la última página importada, sin repetir páginas', async () => {
    gate.active = true;
    await openRequested(fileAt('pages-5000.pdf'));
    const a = activeId();
    await waitUntil(() => gate.waiting);
    expect(useAnnotations.getState().scanProgress).toBe(50);

    await openRequested(fileAt('basic-5.pdf'));
    gate.active = false;
    gate.waiting = false;
    gate.requested.length = 0;
    gate.open?.();

    activateTab(a);
    await waitUntil(() => useAnnotations.getState().scan === 'done');

    expect(gate.froms.at(-1)).toBe(50);
    expect(gate.requested[0]).toBe(51);
    expect(gate.requested).toHaveLength(4950);
    expect(useAnnotations.getState().importedPages.size).toBe(5000);
    expect(useAnnotations.getState().scanProgress).toBe(5000);
  }, 120_000);

  it('un campo rellenado en A sigue en A tras ir a B y Ctrl+Z lo deshace', async () => {
    await openRequested(fileAt('form-full.pdf'));
    const a = activeId();
    await waitUntil(() => useAnnotations.getState().scan === 'done');
    setFieldValue('nombre', { kind: 'text', text: 'Ana' });
    expect(fieldValue('nombre')).toEqual({ kind: 'text', text: 'Ana' });

    await openRequested(fileAt('basic-5.pdf'));
    await waitUntil(() => useAnnotations.getState().scan === 'done');
    expect(useForms.getState().fields.size).toBe(0);

    activateTab(a);
    expect(fieldValue('nombre')).toEqual({ kind: 'text', text: 'Ana' });
    expect(useForms.getState().fields.has('nombre')).toBe(true);

    undo();
    expect(fieldValue('nombre')).toEqual(useForms.getState().fields.get('nombre')?.initial);
  });

  it('el aviso de permisos mostrado en A no se repite al volver de B', async () => {
    const notices = countNotices();
    try {
      await openRequested(fileAt('encrypted-owner-only.pdf'));
      const a = activeId();
      await waitUntil(() => useAnnotations.getState().scan === 'done');
      expect(useViewer.getState().permissions.annotate).toBe(false);

      addAnnotation(newAnnotation('suite-1', 'note'));
      expect(useViewer.getState().notice?.text).toBe(securityMsg.annotateAnyway);
      expect(notices.count()).toBe(1);

      // B no puede ser basic-5.pdf: comparte huella con este PDF y la app lo trataría como la misma pestaña.
      await openRequested(fileAt('links.pdf'));
      await waitUntil(() => useAnnotations.getState().scan === 'done');
      activateTab(a);

      addAnnotation(newAnnotation('suite-2', 'note'));
      expect(notices.count()).toBe(1);
    } finally {
      notices.stop();
    }
  });
});
