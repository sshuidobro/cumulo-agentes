import { beforeEach, describe, expect, it, vi } from 'vitest';
import { closeDocument } from '../../src/state/document-actions';
import { confirmDiscardOrSave } from '../../src/state/unsaved-guard';
import { initialViewerState, useViewer } from '../../src/state/viewer-store';
import {
  activateTab,
  beginNewTab,
  closeTab,
  cycleTab,
  findTab,
  hasAnyUnsavedChanges,
  isSwitchingTab,
  MAX_TABS,
  registerTabParticipant,
  resetTabsForTests,
  useTabs,
  type TabParticipant,
} from '../../src/state/tabs';
import { tabsMsg } from '../../src/ui/messages-tabs';

// Sin documentos reales: el estado «con cambios» y la respuesta del diálogo se controlan desde el test.
const env = vi.hoisted(() => ({ dirty: false }));

vi.mock('../../src/state/unsaved-guard', () => ({
  hasUnsavedChanges: () => env.dirty,
  confirmDiscardOrSave: vi.fn(async (): Promise<'proceed' | 'cancel'> => 'proceed'),
}));

vi.mock('../../src/state/document-actions', () => ({
  closeDocument: vi.fn(async () => {
    const { initialViewerState: initial, useViewer: viewer } = await import('../../src/state/viewer-store');
    viewer.setState({ ...initial });
  }),
}));

/** Participante falso: cada `suspend` devuelve `<id>:<n>` (n crece) y se anota en `log`. */
function fakeParticipant(id: string, order: number, log: string[]): TabParticipant<string> & { readonly dispose: ReturnType<typeof vi.fn> } {
  let count = 0;
  const dispose = vi.fn(async (): Promise<void> => undefined);
  return {
    id,
    order,
    suspend: () => {
      count += 1;
      log.push(`suspend:${id}`);
      return `${id}:${count}`;
    },
    resume: (snapshot: string) => {
      log.push(`resume:${id}:${snapshot}`);
    },
    dispose,
  };
}

beforeEach(() => {
  resetTabsForTests();
  env.dirty = false;
  vi.mocked(confirmDiscardOrSave).mockReset();
  vi.mocked(confirmDiscardOrSave).mockResolvedValue('proceed');
  vi.mocked(closeDocument).mockClear();
  useViewer.setState({ ...initialViewerState });
});

function titles(): string[] {
  return useTabs.getState().tabs.map((t) => t.title);
}

function activeTitle(): string | null {
  const { tabs, activeId } = useTabs.getState();
  return tabs.find((t) => t.id === activeId)?.title ?? null;
}

describe('activateTab y participantes', () => {
  it('suspende 30→10→0 y reanuda 0→10→30; isSwitchingTab() solo es true dentro', () => {
    const log: string[] = [];
    const flags: boolean[] = [];
    const parts = [fakeParticipant('document', 0, log), fakeParticipant('annotations', 10, log), fakeParticipant('forms', 30, log)];
    for (const p of parts) registerTabParticipant(p);
    for (const p of parts) {
      const original = p.suspend;
      const originalResume = p.resume;
      p.suspend = () => {
        flags.push(isSwitchingTab());
        return original();
      };
      p.resume = (snapshot: string) => {
        flags.push(isSwitchingTab());
        originalResume(snapshot);
      };
    }

    expect(beginNewTab('a.pdf', null)).toBe(true);
    const first = useTabs.getState().activeId;
    expect(beginNewTab('b.pdf', null)).toBe(true);
    expect(isSwitchingTab()).toBe(false);
    log.length = 0;
    flags.length = 0;

    activateTab(first ?? '');

    expect(log).toEqual([
      'suspend:forms',
      'suspend:annotations',
      'suspend:document',
      'resume:document:document:1',
      'resume:annotations:annotations:1',
      'resume:forms:forms:1',
    ]);
    expect(flags.every(Boolean)).toBe(true);
    expect(isSwitchingTab()).toBe(false);
    expect(activeTitle()).toBe('a.pdf');
  });

  it('isSwitchingTab() vuelve a false aunque un resume lance', () => {
    const boom: TabParticipant<string> = {
      id: 'boom',
      order: 0,
      suspend: () => 'boom',
      resume: () => {
        throw new Error('fallo al reanudar');
      },
      dispose: async () => undefined,
    };
    registerTabParticipant(boom);
    beginNewTab('a.pdf', null);
    const first = useTabs.getState().activeId ?? '';
    beginNewTab('b.pdf', null);

    expect(() => {
      activateTab(first);
    }).toThrow('fallo al reanudar');
    expect(isSwitchingTab()).toBe(false);
  });

  it('activar la pestaña ya activa o inexistente no hace nada', () => {
    const log: string[] = [];
    registerTabParticipant(fakeParticipant('document', 0, log));
    beginNewTab('a.pdf', null);
    const active = useTabs.getState().activeId ?? '';

    activateTab(active);
    activateTab('no-existe');

    expect(log).toEqual([]);
  });
});

describe('beginNewTab', () => {
  it('diez pestañas se abren; la 11.ª no cambia nada y avisa', () => {
    for (let i = 0; i < MAX_TABS; i += 1) {
      expect(beginNewTab(`doc-${i}.pdf`, null)).toBe(true);
    }
    const before = useTabs.getState();

    expect(beginNewTab('extra.pdf', null)).toBe(false);

    expect(useTabs.getState().tabs).toHaveLength(MAX_TABS);
    expect(useTabs.getState().activeId).toBe(before.activeId);
    expect(useViewer.getState().notice?.text).toBe('Puedes tener hasta 10 documentos abiertos. Cierra alguno para abrir otro.');
    expect(useViewer.getState().notice?.text).toBe(tabsMsg.tooMany);
  });

  it('la pestaña nueva va a la derecha de la activa', () => {
    beginNewTab('a.pdf', null);
    beginNewTab('b.pdf', null);
    beginNewTab('c.pdf', null);
    activateTab(useTabs.getState().tabs[0]?.id ?? '');

    beginNewTab('nuevo.pdf', null);

    expect(titles()).toEqual(['a.pdf', 'nuevo.pdf', 'b.pdf', 'c.pdf']);
    expect(activeTitle()).toBe('nuevo.pdf');
  });
});

describe('cycleTab', () => {
  it('avanza con vuelta: desde la última a la primera', () => {
    beginNewTab('a.pdf', null);
    beginNewTab('b.pdf', null);
    beginNewTab('c.pdf', null);
    expect(activeTitle()).toBe('c.pdf');

    cycleTab(1);

    expect(activeTitle()).toBe('a.pdf');
  });

  it('retrocede con vuelta: desde la primera a la última', () => {
    beginNewTab('a.pdf', null);
    beginNewTab('b.pdf', null);
    activateTab(useTabs.getState().tabs[0]?.id ?? '');

    cycleTab(-1);

    expect(activeTitle()).toBe('b.pdf');
  });
});

describe('closeTab', () => {
  it('cerrar la activa del medio activa la de la derecha', async () => {
    beginNewTab('a.pdf', null);
    beginNewTab('b.pdf', null);
    beginNewTab('c.pdf', null);
    activateTab(useTabs.getState().tabs[1]?.id ?? '');

    expect(await closeTab(useTabs.getState().activeId ?? '')).toBe('closed');

    expect(titles()).toEqual(['a.pdf', 'c.pdf']);
    expect(activeTitle()).toBe('c.pdf');
    expect(closeDocument).toHaveBeenCalledTimes(1);
  });

  it('cerrar la última activa activa la de la izquierda', async () => {
    beginNewTab('a.pdf', null);
    beginNewTab('b.pdf', null);
    beginNewTab('c.pdf', null);

    await closeTab(useTabs.getState().activeId ?? '');

    expect(activeTitle()).toBe('b.pdf');
  });

  it('cerrar la única deja activeId null y el visor vacío', async () => {
    beginNewTab('a.pdf', null);
    useViewer.setState({ status: 'ready' });

    await closeTab(useTabs.getState().activeId ?? '');

    expect(useTabs.getState().activeId).toBeNull();
    expect(useTabs.getState().tabs).toHaveLength(0);
    expect(useViewer.getState().status).toBe('empty');
  });

  it('«Cancelar» en la pregunta deja la pestaña activa como estaba', async () => {
    beginNewTab('a.pdf', null);
    env.dirty = true;
    vi.mocked(confirmDiscardOrSave).mockResolvedValueOnce('cancel');

    expect(await closeTab(useTabs.getState().activeId ?? '')).toBe('cancelled');

    expect(titles()).toEqual(['a.pdf']);
    expect(closeDocument).not.toHaveBeenCalled();
  });

  it('cerrar una inactiva sin cambios libera su instantánea y no cambia la activa', async () => {
    const log: string[] = [];
    const document = fakeParticipant('document', 0, log);
    const forms = fakeParticipant('forms', 30, log);
    registerTabParticipant(document);
    registerTabParticipant(forms);
    beginNewTab('a.pdf', null);
    beginNewTab('b.pdf', null);
    beginNewTab('c.pdf', null);
    const first = useTabs.getState().tabs[0]?.id ?? '';

    expect(await closeTab(first)).toBe('closed');

    expect(document.dispose).toHaveBeenCalledWith('document:1');
    expect(forms.dispose).toHaveBeenCalledWith('forms:1');
    expect(titles()).toEqual(['b.pdf', 'c.pdf']);
    expect(activeTitle()).toBe('c.pdf');
    expect(closeDocument).not.toHaveBeenCalled();
  });

  it('cerrar una inactiva con cambios la activa antes de preguntar; luego sigue como activa', async () => {
    const log: string[] = [];
    const document = fakeParticipant('document', 0, log);
    registerTabParticipant(document);
    env.dirty = true;
    beginNewTab('a.pdf', null);
    beginNewTab('b.pdf', null);
    env.dirty = false;
    const first = useTabs.getState().tabs[0]?.id ?? '';
    let activeWhenAsked: string | null = null;
    vi.mocked(confirmDiscardOrSave).mockImplementationOnce(async () => {
      activeWhenAsked = activeTitle();
      return 'proceed';
    });

    expect(await closeTab(first)).toBe('closed');

    expect(activeWhenAsked).toBe('a.pdf');
    expect(closeDocument).toHaveBeenCalledTimes(1);
    expect(titles()).toEqual(['b.pdf']);
    expect(activeTitle()).toBe('b.pdf');
  });
});

describe('findTab y cambios', () => {
  it('busca por ruta y devuelve null si no hay coincidencia', () => {
    beginNewTab('a.pdf', '/docs/a.pdf');
    beginNewTab('b.pdf', null);

    expect(findTab({ path: '/docs/a.pdf' })?.title).toBe('a.pdf');
    expect(findTab({ path: '/docs/z.pdf' })).toBeNull();
    expect(findTab({})).toBeNull();
  });

  it('hasAnyUnsavedChanges mira también las pestañas suspendidas', () => {
    env.dirty = true;
    beginNewTab('a.pdf', null);
    beginNewTab('b.pdf', null);
    env.dirty = false;

    expect(hasAnyUnsavedChanges()).toBe(true);
  });
});
