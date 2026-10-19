// @vitest-environment jsdom
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { initServices } from '../../src/state/services';
import { askChoice, useChoice } from '../../src/state/choice';
import { beginNewTab, resetTabsForTests, useTabs, type TabInfo } from '../../src/state/tabs';
import { TabBar } from '../../src/ui/tabs/TabBar';
import { tabsMsg } from '../../src/ui/messages-tabs';
import { createFakePlatform } from '../helpers/fake-platform';

function tab(id: string, title: string, extra: Partial<TabInfo> = {}): TabInfo {
  return { id, title, status: 'ready', dirty: false, fingerprint: null, path: null, ...extra };
}

/** Fija las pestañas y la activa directamente en el store (sin cargar documentos). */
function setTabs(tabs: TabInfo[], activeId: string | null): void {
  useTabs.setState({ tabs, activeId });
}

function tabEl(name: string): HTMLElement {
  return screen.getByRole('tab', { name: new RegExp(name) });
}

beforeEach(() => {
  initServices(createFakePlatform());
  resetTabsForTests();
});

describe('TabBar: visibilidad', () => {
  it('no se muestra sin pestañas', () => {
    const { container } = render(<TabBar />);
    expect(container).toBeEmptyDOMElement();
  });

  it('no se muestra con una sola pestaña', () => {
    setTabs([tab('a', 'basic-5.pdf')], 'a');
    const { container } = render(<TabBar />);
    expect(container).toBeEmptyDOMElement();
    expect(screen.queryByRole('tablist')).toBeNull();
  });

  it('con dos pestañas muestra la lista con su nombre accesible', () => {
    setTabs([tab('a', 'basic-5.pdf'), tab('b', 'links.pdf')], 'b');
    render(<TabBar />);
    expect(screen.getByRole('tablist', { name: tabsMsg.tabListLabel })).toBeInTheDocument();
    expect(screen.getAllByRole('tab')).toHaveLength(2);
  });
});

describe('TabBar: estado de cada pestaña', () => {
  it('marca la activa con aria-selected, la enlaza con el visor y solo ella entra en Tab', () => {
    setTabs([tab('a', 'basic-5.pdf'), tab('b', 'links.pdf')], 'b');
    render(<TabBar />);
    expect(tabEl('links.pdf')).toHaveAttribute('aria-selected', 'true');
    expect(tabEl('basic-5.pdf')).toHaveAttribute('aria-selected', 'false');
    expect(tabEl('links.pdf')).toHaveAttribute('aria-controls', 'documento-activo');
    expect(tabEl('links.pdf')).toHaveAttribute('tabindex', '0');
    expect(tabEl('basic-5.pdf')).toHaveAttribute('tabindex', '-1');
  });

  it('el nombre completo va en title y el texto se trunca por CSS (el nombre sigue completo)', () => {
    const long = 'un-nombre-de-fichero-muy-largo-para-la-barra-de-pestañas-de-prueba.pdf';
    setTabs([tab('a', long), tab('b', 'b.pdf')], 'a');
    render(<TabBar />);
    expect(tabEl(long)).toHaveAttribute('title', long);
  });

  it('muestra «• » delante de una pestaña con cambios sin guardar', () => {
    setTabs([tab('a', 'basic-5.pdf', { dirty: true }), tab('b', 'links.pdf')], 'b');
    render(<TabBar />);
    expect(tabEl('basic-5.pdf').textContent).toContain('• basic-5.pdf');
    expect(tabEl('links.pdf').textContent).not.toContain('•');
  });

  it('muestra el indicador de carga y el de error con su nombre accesible', () => {
    setTabs([tab('a', 'basic-5.pdf'), tab('b', 'cargando.pdf', { status: 'loading' }), tab('c', 'roto.pdf', { status: 'error' })], 'a');
    render(<TabBar />);
    expect(within(tabEl('cargando.pdf')).getByRole('img', { name: tabsMsg.loading })).toBeInTheDocument();
    expect(within(tabEl('roto.pdf')).getByRole('img', { name: tabsMsg.loadFailed })).toBeInTheDocument();
  });

  it('cada × tiene su nombre accesible, queda fuera del orden de Tab y cierra esa pestaña', async () => {
    const user = userEvent.setup();
    setTabs([tab('a', 'basic-5.pdf'), tab('b', 'links.pdf')], 'a');
    render(<TabBar />);
    const close = screen.getByRole('button', { name: tabsMsg.closeNamed('links.pdf') });
    expect(close).toHaveAttribute('tabindex', '-1');
    await user.click(close);
    expect(useTabs.getState().tabs.map((t) => t.title)).toEqual(['basic-5.pdf']);
    expect(useTabs.getState().activeId).toBe('a');
  });
});

describe('TabBar: ratón', () => {
  it('un clic activa la pestaña', async () => {
    const user = userEvent.setup();
    setTabs([tab('a', 'basic-5.pdf'), tab('b', 'links.pdf')], 'a');
    render(<TabBar />);
    await user.click(tabEl('links.pdf'));
    expect(useTabs.getState().activeId).toBe('b');
  });

  it('el clic central cierra la pestaña', async () => {
    const user = userEvent.setup();
    setTabs([tab('a', 'basic-5.pdf'), tab('b', 'links.pdf')], 'a');
    render(<TabBar />);
    await user.pointer({ keys: '[MouseMiddle]', target: tabEl('links.pdf') });
    expect(useTabs.getState().tabs.map((t) => t.title)).toEqual(['basic-5.pdf']);
  });
});

describe('TabBar: teclado (roving tabindex)', () => {
  it('←/→ mueven el foco entre pestañas y dan la vuelta; Intro activa la enfocada', async () => {
    const user = userEvent.setup();
    setTabs([tab('a', 'a.pdf'), tab('b', 'b.pdf'), tab('c', 'c.pdf')], 'a');
    render(<TabBar />);
    tabEl('a.pdf').focus();

    await user.keyboard('{ArrowRight}');
    expect(tabEl('b.pdf')).toHaveFocus();
    expect(useTabs.getState().activeId).toBe('a');

    await user.keyboard('{Enter}');
    expect(useTabs.getState().activeId).toBe('b');

    await user.keyboard('{ArrowLeft}{ArrowLeft}');
    expect(tabEl('c.pdf')).toHaveFocus();
  });

  it('Inicio y Fin llevan el foco a la primera y a la última; Espacio activa', async () => {
    const user = userEvent.setup();
    setTabs([tab('a', 'a.pdf'), tab('b', 'b.pdf'), tab('c', 'c.pdf')], 'a');
    render(<TabBar />);
    tabEl('a.pdf').focus();

    await user.keyboard('{End}');
    expect(tabEl('c.pdf')).toHaveFocus();
    await user.keyboard('{Home}');
    expect(tabEl('a.pdf')).toHaveFocus();
    await user.keyboard('{ArrowRight} ');
    expect(useTabs.getState().activeId).toBe('b');
  });

  it('Supr cierra la pestaña enfocada y el foco vuelve a la activa', async () => {
    const user = userEvent.setup();
    setTabs([tab('a', 'a.pdf'), tab('b', 'b.pdf'), tab('c', 'c.pdf')], 'a');
    render(<TabBar />);
    tabEl('a.pdf').focus();
    await user.keyboard('{ArrowRight}{ArrowRight}');
    expect(tabEl('c.pdf')).toHaveFocus();

    await user.keyboard('{Delete}');

    expect(useTabs.getState().tabs.map((t) => t.title)).toEqual(['a.pdf', 'b.pdf']);
    await vi.waitFor(() => { expect(tabEl('a.pdf')).toHaveFocus(); });
  });
});

describe('TabBar: bloqueos', () => {
  it('con un diálogo modal abierto no cambia de pestaña', async () => {
    const user = userEvent.setup();
    setTabs([tab('a', 'basic-5.pdf'), tab('b', 'links.pdf')], 'a');
    render(<TabBar />);
    const pending = askChoice({ title: 'Pregunta', options: [{ label: 'Aceptar', value: 'ok' }], cancel: 'ok' });

    await user.click(tabEl('links.pdf'));
    expect(useTabs.getState().activeId).toBe('a');

    useChoice.getState().active?.options[0]?.pick();
    await pending;
    await user.click(tabEl('links.pdf'));
    expect(useTabs.getState().activeId).toBe('b');
  });
});

describe('TabBar con pestañas reales', () => {
  it('abrir un documento nuevo añade una pestaña y la activa', () => {
    beginNewTab('basic-5.pdf', null);
    beginNewTab('links.pdf', null);
    render(<TabBar />);
    expect(screen.getByRole('tab', { name: /links\.pdf/, selected: true })).toBeInTheDocument();
    expect(screen.getAllByRole('tab')).toHaveLength(2);
  });
});
