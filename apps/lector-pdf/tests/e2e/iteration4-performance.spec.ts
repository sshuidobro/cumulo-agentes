import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Page, TestInfo } from '@playwright/test';
import { expect, test } from './perf-fixture.ts';
import {
  chooseView,
  clearLongTasks,
  fixture,
  installPerfProbes,
  longTasks,
  pageFrame,
  pageNow,
  recordMeasure,
  waitPageRendered,
} from './helpers.ts';
import { commentDialog, commentField, disableFileSystemAccess, pickTool, storeDownload } from './annotations-kit.ts';
import { copyWithId, openMore } from './tabs-kit.ts';
import { expectViewerReady } from './viewer-ready.ts';
import { securityMsg } from '../../src/ui/messages-security.ts';
import { qpdfEncrypt } from '../fixtures/encrypted.ts';
import { qpdfCheck } from '../support/qpdf.ts';

/**
 * Presupuestos de rendimiento de la iteración 4 (PDF-099), en el proyecto `chromium-perf` (en serie, con la CPU en
 * reposo; ADR-0016):
 *  (a) abrir un cifrado AES-256 de 1 000 páginas hasta la p1 pintada ≤ el mismo sin cifrar + 350 ms (medianas, sin el tiempo del usuario);
 *  (b) guardar una nota en ese cifrado < 2 s (desde Ctrl+S hasta la descarga);
 *  (c) cambio de pestaña (PDF-095) y cambio a doble página (PDF-050) en el cifrado siguen en presupuesto.
 * Los presupuestos de PDF-022, PDF-039 y PDF-090 los cubren sus propias pruebas `@perf`, que se ejecutan en este mismo
 * proyecto sin modificar.
 */

const USER = 'usuario';
const OWNER = 'propietario';
const PLAIN_NAME = 'pages-1000.pdf';
const PLAIN_B_NAME = 'pages-1000-b.pdf';
const CIPHER_NAME = 'pages-1000-aes256.pdf';
const CIPHER_ARGS = ['--encrypt', USER, OWNER, '256', '--'] as const;

/** Sobrecoste máximo de abrir el cifrado frente al mismo sin cifrar (medianas, sin el tiempo del usuario; ADR-0043). */
const OPEN_OVERHEAD_MAX_MS = 350;
const OPEN_RUNS = 5;
const SAVE_NOTE_BUDGET_MS = 2_000;
const NOTE_TEXT = 'Nota de rendimiento';
const TAB_CHANGES = 20;
const TAB_P95_MAX_MS = 500;
const TAB_LONG_TASK_MAX_MS = 200;
const MODE_CHANGE_MS = 200;

/**
 * Carpeta temporal propia de este fichero. No se usa la carpeta de salida de la prueba: su ruta contiene el título
 * (con «≤» y espacios) y el selector de ficheros de Chromium no abre un fichero con esa ruta (la app se queda vacía).
 */
const WORK_DIR = mkdtempSync(join(tmpdir(), 'lector-pdf-perf-'));
test.afterAll(() => {
  rmSync(WORK_DIR, { recursive: true, force: true });
});

let cipherFile: string | undefined;

/** Ruta del cifrado AES-256 de `pages-1000.pdf`; lo escribe la primera vez que se pide. */
function cipherPath(): string {
  if (cipherFile === undefined) {
    const path = join(WORK_DIR, CIPHER_NAME);
    writeFileSync(path, qpdfEncrypt(new Uint8Array(readFileSync(fixture(PLAIN_NAME))), CIPHER_ARGS));
    cipherFile = path;
  }
  return cipherFile;
}

/**
 * Escribe la contraseña en el diálogo «Contraseña necesaria» y la confirma con «Abrir». Devuelve (ms) el intervalo
 * desde que el diálogo es visible hasta el clic: es tiempo del usuario, y la medida de PDF-099 (a) lo resta (ADR-0043).
 */
async function typePassword(page: Page, password: string): Promise<number> {
  const dialog = page.getByRole('dialog', { name: securityMsg.title });
  await expect(dialog).toBeVisible();
  const waitingFrom = await pageNow(page);
  const field = dialog.getByRole('textbox', { name: securityMsg.field });
  await field.fill(password);
  await dialog.getByRole('button', { name: securityMsg.open }).click();
  const waited = (await pageNow(page)) - waitingFrom;
  await expect(dialog).toBeHidden();
  return waited;
}

/** Carga la app limpia y abre `path` con el selector de la web; con `password`, la escribe cuando la pida. */
async function openFile(page: Page, path: string, password?: string): Promise<void> {
  await page.goto('/');
  await page.locator('[data-testid=open-input]').setInputFiles(path);
  if (password !== undefined) await typePassword(page, password);
  await expectViewerReady(page);
}

/**
 * Tiempo (ms) desde que el fichero llega al selector hasta que la p1 está pintada, sin el tiempo que el diálogo de
 * contraseña espera al usuario (ADR-0043).
 */
interface FirstPageTiming {
  /** Tiempo ajustado (ms) hasta la p1 pintada, sin la espera del usuario. */
  readonly ms: number;
  /** Desglose: ms desde el fichero elegido hasta que el diálogo es visible (`null` sin contraseña). */
  readonly toDialog: number | null;
}

async function timeToFirstPage(page: Page, path: string, password?: string): Promise<FirstPageTiming> {
  await page.goto('/');
  const started = await pageNow(page);
  await page.locator('[data-testid=open-input]').setInputFiles(path);
  const RAF = { polling: 'raf', timeout: 30_000 } as const;
  let toDialog: number | null = null;
  let userWait = 0;
  if (password !== undefined) {
    // diálogo visible: sondeo por rAF en lugar de expect().toBeVisible(), que reintenta cada 100-1000 ms (ADR-0043)
    await page.waitForFunction(() => document.querySelector('[role=dialog]') !== null, undefined, RAF);
    toDialog = (await pageNow(page)) - started;
    userWait = await typePassword(page, password);
  }
  // p1 pintada: mismo motivo que arriba
  await page.waitForFunction(
    () => document.querySelector('[data-testid=viewer] [data-page-index="0"][data-rendered="true"]') !== null,
    undefined,
    RAF,
  );
  return { ms: (await pageNow(page)) - started - userWait, toDialog };
}

/** Mediana de una lista de números (no vacía). */
function median(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  const upper = sorted[middle];
  const lower = sorted[middle - 1];
  if (upper === undefined) throw new Error('mediana de una lista vacía');
  if (sorted.length % 2 === 1) return upper;
  return ((lower ?? upper) + upper) / 2;
}

/** Percentil 95 (método del rango más próximo) de una lista no vacía. */
function p95(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.ceil(0.95 * sorted.length) - 1;
  const at = sorted[Math.max(0, index)];
  if (at === undefined) throw new Error('percentil de una lista vacía');
  return at;
}

/** Tiempo (ms) de Ctrl+Tab hasta que la página 1 de la pestaña `next` está pintada. */
async function switchAndMeasure(page: Page, next: string): Promise<number> {
  const started = await pageNow(page);
  await page.keyboard.press('Control+Tab');
  await expect(page.getByRole('tab', { name: next, selected: true })).toHaveCount(1);
  await page.waitForFunction(
    () => document.querySelector('[data-testid=viewer] [data-page-index="0"][data-rendered="true"]') !== null,
    undefined,
    { polling: 'raf', timeout: 30_000 },
  );
  return (await pageNow(page)) - started;
}

test(
  'cifrado AES-256 de 1 000 páginas: p1 pintada ≤ sin cifrar + 350 ms',
  { tag: '@perf' },
  async ({ page }, testInfo: TestInfo) => {
    await disableFileSystemAccess(page);
    const cipher = cipherPath();
    const plainPath = fixture(PLAIN_NAME);
    const plain: number[] = [];
    const encrypted: FirstPageTiming[] = [];
    // Calentamiento descartado: la primera apertura sin cifrar sale más lenta y el chunk del sondeo se descarga la primera vez.
    await timeToFirstPage(page, plainPath);
    await timeToFirstPage(page, cipher, USER);
    for (let run = 0; run < OPEN_RUNS; run++) {
      plain.push((await timeToFirstPage(page, plainPath)).ms);
      encrypted.push(await timeToFirstPage(page, cipher, USER));
    }
    const encryptedMs = encrypted.map((timing) => timing.ms);
    const ratio = median(encryptedMs) / median(plain);
    const overhead = median(encryptedMs) - median(plain);
    const breakdown = encrypted
      .map((timing) => `hasta diálogo ${(timing.toDialog ?? 0).toFixed(0)} ms, tras «Abrir» ${(timing.ms - (timing.toDialog ?? 0)).toFixed(0)} ms`)
      .join('; ');
    recordMeasure(
      testInfo,
      `abrir ${PLAIN_NAME} sin cifrar: ${plain.map((ms) => ms.toFixed(0)).join(', ')} ms (mediana ${median(plain).toFixed(0)}); cifrado AES-256: ${encryptedMs.map((ms) => ms.toFixed(0)).join(', ')} ms (mediana ${median(encryptedMs).toFixed(0)}); sobrecoste ${overhead.toFixed(0)} ms (presupuesto ≤ ${String(OPEN_OVERHEAD_MAX_MS)} ms), razón ${ratio.toFixed(2)}; desglose cifrado: ${breakdown}`,
    );
    expect(overhead).toBeLessThanOrEqual(OPEN_OVERHEAD_MAX_MS);
  },
);

test(
  'cifrado AES-256 de 1 000 páginas: guardar una nota < 2 s y el resultado pasa qpdf con la contraseña',
  { tag: '@perf' },
  async ({ page }, testInfo: TestInfo) => {
    await disableFileSystemAccess(page);
    await openFile(page, cipherPath(), USER);
    await waitPageRendered(page, 1);

    await pickTool(page, 'Nota');
    await pageFrame(page, 1).click({ position: { x: 150, y: 150 } });
    await expect(commentDialog(page)).toBeVisible();
    await expect(commentField(page)).toBeFocused();
    await page.keyboard.type(NOTE_TEXT);
    await page.getByRole('button', { name: 'Cerrar', exact: true }).click();
    await expect(commentDialog(page)).toHaveCount(0);

    await page.getByTestId('viewer').focus();
    const download = page.waitForEvent('download');
    const saveStart = await pageNow(page);
    await page.keyboard.press('Control+s');
    const file = await download;
    const saveMs = (await pageNow(page)) - saveStart;
    recordMeasure(testInfo, `guardar una nota en el cifrado de 1 000 páginas: ${saveMs.toFixed(0)} ms (presupuesto < ${String(SAVE_NOTE_BUDGET_MS)} ms)`);
    expect(saveMs).toBeLessThan(SAVE_NOTE_BUDGET_MS);

    const saved = await storeDownload(file, testInfo, 'pages-1000-aes256-nota.pdf');
    const check = qpdfCheck(saved, USER);
    expect(check.code, check.output).toBe(0);
  },
);

test(
  'cifrado AES-256 de 1 000 páginas: cambio de pestaña p95 ≤ 500 ms y long tasks ≤ 200 ms',
  { tag: '@perf' },
  async ({ page }, testInfo: TestInfo) => {
    await installPerfProbes(page);
    await disableFileSystemAccess(page);
    await openFile(page, cipherPath(), USER);
    await waitPageRendered(page, 1);
    await openMore(page, copyWithId(fixture(PLAIN_NAME), PLAIN_B_NAME, 2), PLAIN_B_NAME);
    await expect(page.getByRole('tab')).toHaveCount(2);

    await clearLongTasks(page);
    const times: number[] = [];
    for (let i = 0; i < TAB_CHANGES; i++) {
      times.push(await switchAndMeasure(page, i % 2 === 0 ? CIPHER_NAME : PLAIN_B_NAME));
    }
    const tasks = await longTasks(page);
    const worst = tasks.length === 0 ? 0 : Math.max(...tasks);
    recordMeasure(
      testInfo,
      `cambio de pestaña con el cifrado abierto: p95 ${p95(times).toFixed(0)} ms en ${String(TAB_CHANGES)} cambios (presupuesto ≤ ${String(TAB_P95_MAX_MS)}); long tasks ${String(tasks.length)}, la mayor ${worst.toFixed(0)} ms (presupuesto ≤ ${String(TAB_LONG_TASK_MAX_MS)} ms)`,
    );
    expect(p95(times)).toBeLessThanOrEqual(TAB_P95_MAX_MS);
    expect(tasks.filter((d) => d > TAB_LONG_TASK_MAX_MS)).toEqual([]);
  },
);

test(
  'cifrado AES-256 de 1 000 páginas: cambiar a doble página pinta la fila visible en ≤ 200 ms',
  { tag: '@perf' },
  async ({ page }, testInfo: TestInfo) => {
    await disableFileSystemAccess(page);
    await openFile(page, cipherPath(), USER);
    await waitPageRendered(page, 1);

    const started = await pageNow(page);
    await chooseView(page, 'Doble página');
    await waitPageRendered(page, 2);
    const elapsed = (await pageNow(page)) - started;
    recordMeasure(testInfo, `cifrado de 1 000 páginas: cambio a doble página hasta pintar la fila visible: ${elapsed.toFixed(0)} ms (presupuesto ≤ ${String(MODE_CHANGE_MS)} ms)`);
    expect(elapsed).toBeLessThanOrEqual(MODE_CHANGE_MS);
  },
);
