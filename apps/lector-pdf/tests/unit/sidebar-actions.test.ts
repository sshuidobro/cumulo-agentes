import { beforeEach, describe, expect, it } from 'vitest';
import { createStorageStore } from '@suite/platform';
import { createFakePlatform } from '../helpers/fake-platform';
import { sidebarForOpenedDocument, showSidebarTab, SIDEBAR_PREF, toggleSidebar } from '../../src/state/sidebar-actions';
import { initServices } from '../../src/state/services';
import { initialViewerState, useViewer } from '../../src/state/viewer-store';
import type { Platform } from '@suite/platform';

let platform: Platform;

beforeEach(() => {
  platform = createFakePlatform({ prefs: createStorageStore(null, 'sidebar-test.') });
  initServices({ platform, assetBaseUrl: 'http://localhost/pdfjs/' });
  useViewer.setState({ ...initialViewerState, status: 'ready' });
});

describe('panel lateral · acciones', () => {
  it('F4 (toggleSidebar) abre miniaturas por defecto y cierra al repetir; el estado se guarda en prefs', () => {
    toggleSidebar();
    expect(useViewer.getState().sidebar).toBe('thumbnails');
    expect(platform.prefs.get(SIDEBAR_PREF, (v): v is string => typeof v === 'string')).toBe('thumbnails');

    toggleSidebar();
    expect(useViewer.getState().sidebar).toBe('none');
    expect(platform.prefs.get(SIDEBAR_PREF, (v): v is string => typeof v === 'string')).toBe('none');
  });

  it('al reabrir el panel vuelve la última pestaña usada', () => {
    showSidebarTab('thumbnails');
    toggleSidebar();
    toggleSidebar();
    expect(useViewer.getState().sidebar).toBe('thumbnails');
  });

  it('la pestaña elegida se recuerda en prefs y al abrir un documento se usa si el PDF no pide otra', () => {
    showSidebarTab('comments');
    expect(platform.prefs.get(SIDEBAR_PREF, (v): v is string => typeof v === 'string')).toBe('comments');
    expect(sidebarForOpenedDocument(null)).toBe('comments');
  });

  it('un valor guardado no válido en prefs cae a cerrado', () => {
    platform.prefs.set(SIDEBAR_PREF, 'tabs-raras');
    expect(sidebarForOpenedDocument(null)).toBe('none');
  });

  it('al abrir un documento, el PageMode /UseOutlines abre el índice y /UseThumbs las miniaturas', () => {
    platform.prefs.set(SIDEBAR_PREF, 'none');
    expect(sidebarForOpenedDocument('UseOutlines')).toBe('outline');
    expect(sidebarForOpenedDocument('UseThumbs')).toBe('thumbnails');
    expect(sidebarForOpenedDocument('UseNone')).toBe('none');
  });
});
