// @vitest-environment jsdom
import { render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { App } from '../../src/ui/App';
import { initServices } from '../../src/state/services';
import { initialViewerState, useViewer } from '../../src/state/viewer-store';
import { createFakePlatform } from '../helpers/fake-platform';

beforeEach(() => {
  initServices({ platform: createFakePlatform(), assetBaseUrl: 'http://localhost/pdfjs/' });
  useViewer.setState(initialViewerState);
});

describe('barra: guardar', () => {
  it('«Guardar» y «Guardar como…» existen con su atajo y están deshabilitados sin documento', () => {
    render(<App />);
    const toolbar = screen.getByRole('toolbar', { name: 'Barra de herramientas' });
    const save = within(toolbar).getByRole('button', { name: 'Guardar' });
    const saveAs = within(toolbar).getByRole('button', { name: 'Guardar como…' });
    expect(save).toHaveAttribute('title', 'Guardar (Ctrl+S)');
    expect(saveAs).toHaveAttribute('title', 'Guardar como… (Ctrl+Mayús+S)');
    expect(save).toBeDisabled();
    expect(saveAs).toBeDisabled();
  });
});
