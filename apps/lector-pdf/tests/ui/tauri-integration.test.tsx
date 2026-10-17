// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { clearMocks, mockIPC, mockWindows } from '@tauri-apps/api/mocks';
import { loadPlatform, type Platform } from '@suite/platform';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { GlobalWorkerOptions } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { App } from '../../src/ui/App';
import { closeDocument } from '../../src/state/document-actions';
import { initServices } from '../../src/state/services';
import { initialViewerState, useViewer } from '../../src/state/viewer-store';

/**
 * Integración de escritorio con `mockIPC` (PDF-021): la plataforma Tauri real, sus comandos
 * `suite_*` simulados y el motor real de pdf.js (build legacy, ADR-0013) sobre un fixture.
 */

const FIXTURE = 'basic-5.pdf';
const FIXTURE_TOKEN = 'token-basic-5';
let pdfBytes = new Uint8Array();

interface RangeCall { readonly token: string; readonly offset: number; readonly length: number }

/** Llamadas a `suite_read_range` y títulos de ventana recibidos durante la prueba. */
let rangeCalls: RangeCall[] = [];
let titles: string[] = [];
/** Lo que devuelve `suite_open_dialog`: `null` simula «cancelar». */
let dialogResult: unknown = null;

function fileInfo(): unknown {
  return {
    token: FIXTURE_TOKEN,
    name: FIXTURE,
    path: join(FIXTURES_DIR, FIXTURE),
    size: pdfBytes.byteLength,
    lastModified: 1,
  };
}

function installIpc(): void {
  mockWindows('main');
  mockIPC((cmd, payload) => {
    switch (cmd) {
      case 'suite_open_dialog':
        return dialogResult;
      case 'suite_read_range': {
        const args = payload as unknown as RangeCall;
        rangeCalls.push({ token: args.token, offset: args.offset, length: args.length });
        return pdfBytes.slice(args.offset, args.offset + args.length).buffer;
      }
      case 'suite_take_pending_opens':
        return [];
      case 'plugin:window|set_title':
        titles.push((payload as { value: string }).value);
        return null;
      default:
        throw new Error(`comando inesperado: ${cmd}`);
    }
  });
}

let platform: Platform;

/** Carpeta de fixtures generados (los crea `tests/setup/global-setup.ts`). jsdom no admite `file:` URLs, así que no se usa `tests/fixtures/paths.ts`. */
const FIXTURES_DIR = join(import.meta.dirname, '../../../../fixtures/pdf/generated');
/** Resolución de pdf.js desde la app (jsdom no admite `file:` URLs en `import.meta.url`). */
const appRequire = createRequire(join(import.meta.dirname, 'resolve.js'));
const PDFJS_DIR = dirname(appRequire.resolve('pdfjs-dist/package.json'));

beforeAll(() => {
  pdfBytes = new Uint8Array(readFileSync(join(FIXTURES_DIR, FIXTURE)));
  GlobalWorkerOptions.workerSrc = appRequire.resolve('pdfjs-dist/legacy/build/pdf.worker.mjs');
});

beforeEach(async () => {
  rangeCalls = [];
  titles = [];
  dialogResult = null;
  useViewer.setState(initialViewerState);
  installIpc();
  platform = await loadPlatform({ prefsPrefix: 'test-tauri-integration.' });
  initServices({ platform, assetBaseUrl: `${PDFJS_DIR}/` });
});

afterEach(async () => {
  await closeDocument();
  clearMocks();
});

describe('integración Tauri con mockIPC', () => {
  it('loadPlatform detecta el escritorio y el diálogo cancelado no abre nada', async () => {
    const user = userEvent.setup();
    render(<App />);

    expect(platform.kind).toBe('tauri');
    await user.click(within(screen.getByRole('main')).getByRole('button', { name: 'Abrir…' }));

    expect(await screen.findByRole('heading', { level: 1, name: 'Abre un PDF para empezar' })).toBeInTheDocument();
    expect(rangeCalls).toHaveLength(0);
  });

  it('abrir por diálogo lee el fichero por rangos, muestra el documento y pone el título de la ventana', async () => {
    const user = userEvent.setup();
    dialogResult = fileInfo();
    render(<App />);

    await user.click(within(screen.getByRole('main')).getByRole('button', { name: 'Abrir…' }));

    expect(await screen.findByText('5 páginas', undefined, { timeout: 10_000 })).toBeInTheDocument();
    expect(titles).toContain('basic-5.pdf — Lector PDF');
    expect(rangeCalls.length).toBeGreaterThan(0);
    for (const call of rangeCalls) {
      expect(call.token).toBe(FIXTURE_TOKEN);
      expect(call.offset + call.length).toBeLessThanOrEqual(pdfBytes.byteLength);
    }
  });
});
