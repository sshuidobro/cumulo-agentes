// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { App } from '../../src/ui/App';

describe('App', () => {
  it('muestra el estado vacío en español', () => {
    render(<App />);
    expect(screen.getByRole('heading', { level: 1, name: 'Abre un PDF para empezar' })).toBeInTheDocument();
    expect(screen.getByText('Arrastra un fichero a esta ventana o pulsa «Abrir».')).toBeInTheDocument();
  });

  it('ofrece el botón Abrir… con tooltip en la barra de herramientas', () => {
    render(<App />);
    expect(screen.getByRole('toolbar', { name: 'Barra de herramientas' })).toBeInTheDocument();
    const open = screen.getByRole('button', { name: 'Abrir…' });
    expect(open).toHaveAttribute('title', 'Abrir…');
    expect(open).toHaveAttribute('type', 'button');
  });
});
