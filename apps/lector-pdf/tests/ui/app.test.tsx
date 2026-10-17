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

describe('App', () => {
  it('muestra el estado vacío en español', () => {
    render(<App />);
    expect(screen.getByRole('heading', { level: 1, name: 'Abre un PDF para empezar' })).toBeInTheDocument();
    expect(screen.getByText('Arrastra un fichero a esta ventana o pulsa «Abrir».')).toBeInTheDocument();
  });

  it('ofrece el botón Abrir… con el atajo en el tooltip en la barra de herramientas', () => {
    render(<App />);
    const toolbar = screen.getByRole('toolbar', { name: 'Barra de herramientas' });
    const open = within(toolbar).getByRole('button', { name: 'Abrir…' });
    expect(open).toHaveAttribute('title', 'Abrir… (Ctrl+O)');
    expect(open).toHaveAttribute('type', 'button');
  });
});
