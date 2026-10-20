// @vitest-environment jsdom
import { act, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as ReadAloudModule from '../../src/state/read-aloud-actions';
import type { SpeechChunk } from '../../src/core/read-aloud/chunks';
import type { VoiceInfo } from '../../src/core/read-aloud/voices';
import { setSpeechPort, type SpeechPort } from '../../src/state/speech-port';
import { useReadAloud } from '../../src/state/read-aloud-actions';
import { initServices } from '../../src/state/services';
import { initialViewerState, useViewer } from '../../src/state/viewer-store';
import { ReadAloudBar } from '../../src/ui/read-aloud/ReadAloudBar';
import { readAloudMsg } from '../../src/ui/messages-read-aloud';
import { createFakePlatform } from '../helpers/fake-platform';

// Cuenta las llamadas a pausa y parar. Sin una lectura en marcha (`run`), el módulo real no cambia el estado.
const calls = vi.hoisted(() => ({ toggle: 0, stop: 0 }));

vi.mock('../../src/state/read-aloud-actions', async (importOriginal) => {
  const actual = await importOriginal<typeof ReadAloudModule>();
  return {
    ...actual,
    togglePause: () => {
      calls.toggle += 1;
      actual.togglePause();
    },
    stopReading: () => {
      calls.stop += 1;
      actual.stopReading();
    },
  };
});

const VOICES: readonly VoiceInfo[] = [
  { id: 'es-es', name: 'Helena', lang: 'es-ES', local: true },
  { id: 'es-mx', name: 'Sabina', lang: 'es-MX', local: true },
];

const CHUNK: SpeechChunk = { pageIndex: 1, text: 'Hola.', start: { item: 0, offset: 0 }, end: { item: 0, offset: 5 } };

/** Puerto de voz que no dice nada: el estado de la lectura se fija a mano en cada prueba. */
function silentPort(): { readonly cancels: () => number } {
  let cancels = 0;
  const port: SpeechPort = {
    available: () => true,
    voices: () => Promise.resolve(VOICES),
    speak: () => undefined,
    cancel: () => {
      cancels += 1;
    },
  };
  setSpeechPort(port);
  return { cancels: () => cancels };
}

/** Deja la lectura en curso (o pausada) con el fragmento `CHUNK` de la página 2. */
function reading(status: 'speaking' | 'paused' | 'loading'): void {
  useReadAloud.setState({
    status,
    scope: 'page',
    current: status === 'loading' ? null : CHUNK,
    voices: VOICES,
    voiceId: 'es-es',
    rate: 1,
    unavailable: false,
  });
}

beforeEach(() => {
  calls.toggle = 0;
  calls.stop = 0;
  initServices({ platform: createFakePlatform(), assetBaseUrl: 'http://localhost/pdfjs/' });
  useViewer.setState({ ...initialViewerState, status: 'ready', currentPage: 0 });
  useReadAloud.setState({
    status: 'idle',
    scope: null,
    current: null,
    rate: 1,
    voiceId: null,
    voices: [],
    unavailable: false,
  });
});

afterEach(() => {
  setSpeechPort(null);
});

describe('barra de lectura en voz alta', () => {
  it('no aparece sin lectura', () => {
    silentPort();
    render(<ReadAloudBar />);
    expect(screen.queryByRole('toolbar', { name: readAloudMsg.toolbar })).toBeNull();
  });

  it('se muestra con nombre accesible y dice la página que se lee (base 1)', () => {
    silentPort();
    reading('speaking');
    render(<ReadAloudBar />);
    expect(screen.getByRole('toolbar', { name: 'Lectura en voz alta' })).toBeVisible();
    expect(screen.getByText('Leyendo la página 2')).toBeVisible();
  });

  it('«Pausar» pide pausar la lectura; el botón es pulsable y queda marcado si está pausada', async () => {
    const user = userEvent.setup();
    silentPort();
    reading('speaking');
    render(<ReadAloudBar />);

    const pause = screen.getByRole('button', { name: 'Pausar' });
    expect(pause).toHaveAttribute('aria-pressed', 'false');
    await user.click(pause);
    expect(calls.toggle).toBe(1);

    act(() => {
      useReadAloud.setState({ status: 'paused' });
    });
    expect(screen.getByRole('button', { name: 'Pausar' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('Espacio con el foco en la propia barra pide pausar; con el foco en un selector no', () => {
    silentPort();
    reading('speaking');
    render(<ReadAloudBar />);
    const bar = screen.getByRole('toolbar', { name: 'Lectura en voz alta' });

    fireEvent.keyDown(bar, { key: ' ' });
    expect(calls.toggle).toBe(1);
    fireEvent.keyDown(screen.getByRole('combobox', { name: 'Velocidad de lectura' }), { key: ' ' });
    expect(calls.toggle).toBe(1);
  });

  it('Esc con el foco en la barra pide parar la lectura', () => {
    silentPort();
    reading('speaking');
    render(<ReadAloudBar />);

    fireEvent.keyDown(screen.getByRole('button', { name: 'Pausar' }), { key: 'Escape' });

    expect(calls.stop).toBe(1);
  });

  it('«Parar» pide parar la lectura', async () => {
    const user = userEvent.setup();
    silentPort();
    reading('paused');
    render(<ReadAloudBar />);

    await user.click(screen.getByRole('button', { name: 'Parar' }));

    expect(calls.stop).toBe(1);
  });

  it('el selector de velocidad ofrece los pasos con coma decimal y guarda la elegida', async () => {
    const user = userEvent.setup();
    silentPort();
    reading('paused');
    render(<ReadAloudBar />);

    const speed = screen.getByRole('combobox', { name: 'Velocidad de lectura' });
    expect(screen.getByRole('option', { name: '1,25×' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: '0,5×' })).toBeInTheDocument();
    await user.selectOptions(speed, '1.5');

    expect(useReadAloud.getState().rate).toBe(1.5);
    expect(speed).toHaveValue('1.5');
  });

  it('el selector de voz lista las voces locales por nombre e idioma y cambia la voz', async () => {
    const user = userEvent.setup();
    silentPort();
    reading('paused');
    render(<ReadAloudBar />);

    const voice = screen.getByRole('combobox', { name: 'Voz' });
    expect(screen.getByRole('option', { name: 'Helena (es-ES)' })).toBeInTheDocument();
    await user.selectOptions(voice, 'es-mx');

    expect(useReadAloud.getState().voiceId).toBe('es-mx');
  });

  it('mientras carga las voces, el botón de pausa está deshabilitado', () => {
    silentPort();
    reading('loading');
    render(<ReadAloudBar />);
    expect(screen.getByRole('button', { name: 'Pausar' })).toBeDisabled();
    expect(screen.getByText('Leyendo la página 1')).toBeVisible();
  });
});
