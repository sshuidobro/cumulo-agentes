// @vitest-environment jsdom
import { createIdbDraftStore, memorySource, type DraftStore } from '@suite/platform';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { toDraft } from '../../src/core/annotations/draft';
import { EMPTY_EDITS } from '../../src/core/annotations/model';
import type { LoadedPdf } from '../../src/engine';
import { addAnnotation, registerAnnotationParticipant } from '../../src/state/annotation-actions';
import { useAnnotations } from '../../src/state/annotation-store';
import { useChoice } from '../../src/state/choice';
import { draftKey, startDraftSync } from '../../src/state/draft-sync';
import { initServices } from '../../src/state/services';
import { msg } from '../../src/ui/messages';
import {
  activateTab,
  beginNewTab,
  closeTab,
  registerTabParticipant,
  resetTabsForTests,
  useTabs,
} from '../../src/state/tabs';
import { initialViewerState, useViewer, type ViewerState } from '../../src/state/viewer-store';
import { createFakePlatform, openedFile } from '../helpers/fake-platform';
import { newAnnotation } from '../unit/annotations/factories';

/** Cada documento de prueba pesa 1 234 bytes: la clave de su borrador es conocida. */
const BYTES = new Uint8Array(1234);

let store: DraftStore;
let stopSync: (() => void) | null = null;

function keyOf(name: string): string {
  return draftKey(`fp-${name}`, BYTES.length);
}

function start(): void {
  stopSync = startDraftSync(store);
}

/** Participante del documento (orden 0): como en la app, el visor se vacía al dejar la pestaña y se restaura al volver. */
function registerViewerParticipant(): void {
  registerTabParticipant<ViewerState>({
    id: 'document',
    order: 0,
    suspend: () => {
      const snapshot = useViewer.getState();
      useViewer.setState({ ...initialViewerState });
      return snapshot;
    },
    resume: (snapshot) => {
      useViewer.setState(snapshot);
    },
    dispose: () => Promise.resolve(),
  });
}

/** Abre un documento en una pestaña nueva y lo deja listo, como tras cargarlo. */
function openTab(name: string): string {
  beginNewTab(name, null);
  const id = useTabs.getState().activeId ?? '';
  const file = openedFile(name, memorySource(BYTES));
  const pdf = { fingerprint: `fp-${name}`, numPages: 1 } as unknown as LoadedPdf;
  useViewer.setState({ ...initialViewerState, status: 'ready', file, pdf });
  useAnnotations.setState({ scan: 'done' });
  return id;
}

/** Cuenta los diálogos de recuperación que se muestran. */
function countChoices(): { readonly count: () => number; readonly stop: () => void } {
  let count = 0;
  const stop = useChoice.subscribe((s, prev) => {
    if (s.active !== null && s.active !== prev.active) count += 1;
  });
  return { count: () => count, stop };
}

/** Deja correr las tareas pendientes (el almacén de IndexedDB responde en tareas posteriores). */
async function drain(): Promise<void> {
  for (let i = 0; i < 20; i += 1) {
    await new Promise((resolve) => {
      setTimeout(resolve, 0);
    });
  }
}

beforeEach(() => {
  initServices({ platform: createFakePlatform(), assetBaseUrl: '' });
  store = createIdbDraftStore('test-drafts-tabs', null);
  resetTabsForTests();
  registerViewerParticipant();
  registerAnnotationParticipant();
  useViewer.setState({ ...initialViewerState });
  useAnnotations.setState({ scan: 'idle' });
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
  stopSync?.();
  stopSync = null;
  await closeAllTabsDiscarding();
  resetTabsForTests();
  useViewer.setState({ ...initialViewerState });
  useChoice.setState({ active: null });
});

describe('borradores y pestañas', () => {
  it('un documento sucio pasa a otra pestaña sin diálogo, su borrador queda guardado y volver a él tampoco pregunta', async () => {
    const choices = countChoices();
    try {
      start();
      const a = openTab('a.pdf');
      await drain();
      addAnnotation(newAnnotation('suite-n1', 'note'));

      openTab('b.pdf');
      await vi.waitFor(async () => {
        expect(await store.keys()).toEqual([keyOf('a.pdf')]);
      });
      expect(choices.count()).toBe(0);

      activateTab(a);
      await drain();
      expect(useAnnotations.getState().undo.isDirty).toBe(true);
      expect(choices.count()).toBe(0);
      expect(await store.keys()).toEqual([keyOf('a.pdf')]);
    } finally {
      choices.stop();
    }
  });

  it('cerrar una pestaña inactiva sin cambios borra su borrador', async () => {
    start();
    const a = openTab('a.pdf');
    await drain();
    await store.put(keyOf('a.pdf'), toDraft(EMPTY_EDITS, 'a.pdf', new Date().toISOString()));

    openTab('b.pdf');
    await drain();
    expect(await store.keys()).toEqual([keyOf('a.pdf')]);

    await closeTab(a);
    await vi.waitFor(async () => {
      expect(await store.keys()).toEqual([]);
    });
  });
});
