// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react';
import { createStorageStore } from '@suite/platform';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useShortcuts } from '../../src/ui/use-shortcuts';
import { initServices } from '../../src/state/services';
import { createFakePlatform } from '../helpers/fake-platform';

interface HarnessProps {
  readonly handlers: Parameters<typeof useShortcuts>[0];
}

/** Componente de prueba: un área de texto y los atajos de anotaciones. */
function Harness({ handlers }: HarnessProps) {
  useShortcuts(handlers);
  return <textarea aria-label="Nota" />;
}

beforeEach(() => {
  initServices({
    platform: createFakePlatform({ prefs: createStorageStore(null, 'test.') }),
    assetBaseUrl: '',
  });
});

describe('atajos de deshacer y rehacer', () => {
  it('Ctrl+Z con el foco en el visor deshace', () => {
    const undo = vi.fn();
    render(<Harness handlers={{ undo }} />);
    fireEvent.keyDown(document.body, { key: 'z', ctrlKey: true });
    expect(undo).toHaveBeenCalledTimes(1);
  });

  it('Ctrl+Z con el foco en un textarea no llama a undo', () => {
    const undo = vi.fn();
    render(<Harness handlers={{ undo }} />);
    fireEvent.keyDown(screen.getByRole('textbox', { name: 'Nota' }), { key: 'z', ctrlKey: true });
    expect(undo).not.toHaveBeenCalled();
  });

  it('Ctrl+Y y Ctrl+Mayús+Z rehacen; Ctrl+Mayús+Z no deshace', () => {
    const undo = vi.fn();
    const redo = vi.fn();
    render(<Harness handlers={{ undo, redo }} />);
    fireEvent.keyDown(document.body, { key: 'y', ctrlKey: true });
    fireEvent.keyDown(document.body, { key: 'Z', ctrlKey: true, shiftKey: true });
    expect(redo).toHaveBeenCalledTimes(2);
    expect(undo).not.toHaveBeenCalled();
  });
});

describe('Escape', () => {
  it('con un manejador de Escape, lo llama en el visor', () => {
    const cancelTool = vi.fn();
    render(<Harness handlers={{ 'cancel-tool': cancelTool }} />);
    fireEvent.keyDown(document.body, { key: 'Escape' });
    expect(cancelTool).toHaveBeenCalledTimes(1);
  });
});
