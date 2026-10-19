import { beforeEach, describe, expect, it, vi } from 'vitest';
import { err, ok } from '@suite/shared';
import { platformError, type Platform } from '@suite/platform';
import { PageDimsTable } from '../../src/core/page-dims';
import { initialAnnotationState, useAnnotations } from '../../src/state/annotation-store';
import { enterFullscreen, exitFullscreen, toggleFullscreen, useFullscreen, watchSystemFullscreen } from '../../src/state/fullscreen-actions';
import { initServices } from '../../src/state/services';
import { initialViewerState, useViewer } from '../../src/state/viewer-store';
import { createFakePlatform } from '../helpers/fake-platform';
import { viewMsg } from '../../src/ui/messages-view';

let platform: ReturnType<typeof createFakePlatform>;

beforeEach(() => {
  platform = createFakePlatform({ prefs: { get: () => null, set: vi.fn(), remove: () => undefined } });
  initServices({ platform: platform as Platform, assetBaseUrl: 'http://localhost/pdfjs/' });
  useFullscreen.setState({ on: false });
  useViewer.setState({
    ...initialViewerState,
    status: 'ready',
    dims: PageDimsTable.uniform(5, 612, 792, 0),
    dimsVersion: 1,
    currentPage: 2,
    viewMode: { scroll: 'continuous', spread: 'pairs' },
    zoomMode: { kind: 'custom', zoom: 1.5 },
    sidebar: 'outline',
  });
  useAnnotations.setState({ ...initialAnnotationState(), tool: 'ink' });
});

describe('pantalla completa (PDF-097)', () => {
  it('entrar fuerza el modo por páginas con la misma distribución, ajuste a página y panel cerrado', () => {
    enterFullscreen();
    expect(useFullscreen.getState().on).toBe(true);
    expect(useViewer.getState().viewMode).toEqual({ scroll: 'paged', spread: 'pairs' });
    expect(useViewer.getState().zoomMode).toEqual({ kind: 'fit-page' });
    expect(useViewer.getState().sidebar).toBe('none');
    expect(useAnnotations.getState().tool).toBe('none');
    expect(platform.setFullscreen).toHaveBeenCalledWith(true);
  });

  it('entrar muestra el aviso «Pulsa Esc…» y no escribe la preferencia de modo de vista', () => {
    enterFullscreen();
    expect(useViewer.getState().notice?.text).toBe(viewMsg.fullscreenHint);
    expect(platform.prefs.set).not.toHaveBeenCalled();
  });

  it('salir restaura modo de vista, zoom, panel y herramienta anteriores', () => {
    enterFullscreen();
    exitFullscreen();
    const viewer = useViewer.getState();
    expect(useFullscreen.getState().on).toBe(false);
    expect(viewer.viewMode).toEqual({ scroll: 'continuous', spread: 'pairs' });
    expect(viewer.zoomMode).toEqual({ kind: 'custom', zoom: 1.5 });
    expect(viewer.sidebar).toBe('outline');
    expect(useAnnotations.getState().tool).toBe('ink');
    expect(platform.setFullscreen).toHaveBeenLastCalledWith(false);
    expect(platform.prefs.set).not.toHaveBeenCalled();
  });

  it('si el sistema no admite la pantalla completa, la vista se oculta igualmente y se restaura al salir', () => {
    platform.setFullscreen = vi.fn(async () => err(platformError('unsupported')));
    enterFullscreen();
    expect(useFullscreen.getState().on).toBe(true);
    expect(useViewer.getState().sidebar).toBe('none');
    exitFullscreen();
    expect(useFullscreen.getState().on).toBe(false);
    expect(useViewer.getState().sidebar).toBe('outline');
  });

  it('alterna con toggleFullscreen y exitFullscreen no hace nada si no está activa', () => {
    toggleFullscreen();
    expect(useFullscreen.getState().on).toBe(true);
    toggleFullscreen();
    expect(useFullscreen.getState().on).toBe(false);
    exitFullscreen();
    expect(platform.setFullscreen).toHaveBeenCalledTimes(2);
  });

  it('si el sistema sale de la pantalla completa (F11, SO), la vista se restaura', () => {
    const listeners: Array<(on: boolean) => void> = [];
    platform.onFullscreenChange = (cb) => {
      listeners.push(cb);
      return () => undefined;
    };
    const unsubscribe = watchSystemFullscreen();
    enterFullscreen();
    for (const notify of listeners) notify(true);
    expect(useFullscreen.getState().on).toBe(true);
    for (const notify of listeners) notify(false);
    expect(useFullscreen.getState().on).toBe(false);
    expect(useViewer.getState().sidebar).toBe('outline');
    unsubscribe();
  });

  it('el resultado de setFullscreen(true) es un Result: un éxito no cambia nada más', async () => {
    platform.setFullscreen = vi.fn(async () => ok(undefined));
    enterFullscreen();
    await Promise.resolve();
    expect(useFullscreen.getState().on).toBe(true);
  });
});
