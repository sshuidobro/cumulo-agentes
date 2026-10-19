import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { initServices } from '../../src/state/services';
import { createFakePlatform } from '../helpers/fake-platform';
import { askChoice, useChoice } from '../../src/state/choice';
import { askPassword, cancelPassword } from '../../src/state/password-prompt';
import { usePrintDialog } from '../../src/state/print-actions';
import { setSignatureCreating } from '../../src/state/signature-actions';
import { useSaving } from '../../src/state/save-actions';
import { closeActiveTab, stepTab, switchTab, tabsLocked } from '../../src/state/tab-actions';
import { beginNewTab, resetTabsForTests, useTabs } from '../../src/state/tabs';

function activeTitle(): string | null {
  const { tabs, activeId } = useTabs.getState();
  return tabs.find((t) => t.id === activeId)?.title ?? null;
}

beforeEach(() => {
  initServices({ platform: createFakePlatform(), assetBaseUrl: 'http://localhost/' });
  resetTabsForTests();
  beginNewTab('a.pdf', null);
  beginNewTab('b.pdf', null);
  beginNewTab('c.pdf', null);
});

afterEach(() => {
  cancelPassword();
  setSignatureCreating(false);
  usePrintDialog.setState({ open: false });
  useSaving.setState({ saving: false });
});

describe('tabsLocked', () => {
  it('no bloquea sin diálogos ni guardado en curso', () => {
    expect(tabsLocked()).toBe(false);
  });

  it('se bloquea mientras se guarda', () => {
    useSaving.setState({ saving: true });
    expect(tabsLocked()).toBe(true);
  });

  it('se bloquea con una elección, una contraseña, la impresión o «Crear firma» abiertos', async () => {
    const choice = askChoice({ title: 'x', options: [{ label: 'Ok', value: 'ok' }], cancel: 'ok' });
    expect(tabsLocked()).toBe(true);
    useChoice.getState().active?.dismiss();
    await choice;
    expect(tabsLocked()).toBe(false);

    const password = askPassword('a.pdf', false);
    expect(tabsLocked()).toBe(true);
    cancelPassword();
    await password;
    expect(tabsLocked()).toBe(false);

    usePrintDialog.setState({ open: true });
    expect(tabsLocked()).toBe(true);
    usePrintDialog.setState({ open: false });

    setSignatureCreating(true);
    expect(tabsLocked()).toBe(true);
  });
});

describe('cambio y cierre bloqueados', () => {
  it('switchTab no cambia de pestaña mientras hay bloqueo', () => {
    const first = useTabs.getState().tabs[0]?.id ?? '';
    useSaving.setState({ saving: true });
    switchTab(first);
    expect(activeTitle()).toBe('c.pdf');
  });

  it('stepTab avanza y retrocede con vuelta', () => {
    stepTab(1);
    expect(activeTitle()).toBe('a.pdf');
    stepTab(-1);
    expect(activeTitle()).toBe('c.pdf');
  });

  it('stepTab no hace nada con un diálogo abierto', () => {
    setSignatureCreating(true);
    stepTab(1);
    expect(activeTitle()).toBe('c.pdf');
  });

  it('closeActiveTab cierra la activa y devuelve false sin pestañas', async () => {
    expect(await closeActiveTab()).toBe(true);
    expect(useTabs.getState().tabs.map((t) => t.title)).toEqual(['a.pdf', 'b.pdf']);
    resetTabsForTests();
    expect(await closeActiveTab()).toBe(false);
  });
});
