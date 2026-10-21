import { readFileSync, writeFileSync } from 'node:fs';
import { expect, test, type Locator, type Page, type TestInfo } from '@playwright/test';
import { msg } from '../../src/ui/messages.ts';
import { securityMsg } from '../../src/ui/messages-security.ts';
import { tabsMsg } from '../../src/ui/messages-tabs.ts';
import { liveAnnotations } from './annotations-live.ts';
import { commentDialog, commentField, pickTool, wordBox, zoneOf } from './annotations-kit.ts';
import { chooseView, fixture, pageFrame, waitPageRendered } from './helpers.ts';
import { copyWithId, tabNamed } from './tabs-kit.ts';
import { expectViewerReady } from './viewer-ready.ts';
import { qpdfCheck, run } from '../support/qpdf.ts';

/**
 * Flujo completo de la iteración 4 (ADR-0022, ADR-0023, ADR-0024, ADR-0025): abrir un PDF cifrado con AES-256 y
 * `basic-5.pdf` desde OPFS (dos pestañas); en el cifrado, «Doble página», un resaltado y una nota en la p2; zoom
 * 3 200 % en el otro documento y vuelta a 100 %; Ctrl+S; cerrar; reabrir el cifrado desde «Recientes».
 *
 * Los ficheros vienen de OPFS (selector falso, como PDF-049): al guardar, la app escribe en el mismo fichero de
 * OPFS (guardado en sitio). Para comprobarlo con `qpdf` se copia ese fichero a la carpeta de salida.
 */

const USER = 'usuario';
const CIPHER = 'encrypted-aes-256.pdf';
const PLAIN = 'basic-5.pdf';
const NOTE_TEXT = 'Cifrado ñ €';
const WORD = 'Página';
const ZOOM_MAX = '3200';
const ZOOM_BACK = '100';
const RECENT_REGION = { name: tabsMsg.recentTitle };
const SECRETS = /usuario|propietario/;

/** Instala el selector falso antes de cargar la página: devuelve el fichero de OPFS que indique `__nextPick`. */
async function installPicker(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const w = window as unknown as {
      __nextPick?: string;
      showOpenFilePicker?: (options: unknown) => Promise<FileSystemFileHandle[]>;
    };
    w.showOpenFilePicker = async () => {
      const name = w.__nextPick;
      if (name === undefined) throw new DOMException('Cancelado', 'AbortError');
      const root = await navigator.storage.getDirectory();
      return [await root.getFileHandle(name)];
    };
  });
}

/** Escribe `bytes` en OPFS con el nombre dado (la página ya está cargada en su origen). */
async function putInOpfs(page: Page, name: string, bytes: Buffer): Promise<void> {
  await page.evaluate(async ({ fileName, data }) => {
    const root = await navigator.storage.getDirectory();
    const handle = await root.getFileHandle(fileName, { create: true });
    const writable = await handle.createWritable();
    await writable.write(new Uint8Array(data));
    await writable.close();
  }, { fileName: name, data: [...bytes] });
}

/** Pone el fichero de OPFS que devolverá el próximo «Abrir…». */
async function nextPick(page: Page, name: string): Promise<void> {
  await page.evaluate((fileName) => {
    (window as unknown as { __nextPick?: string }).__nextPick = fileName;
  }, name);
}

/** Abre un PDF sin cifrar de OPFS con «Abrir…» (documento nuevo en pestaña) y espera a que esté listo. */
async function pickPlain(page: Page, name: string): Promise<void> {
  await nextPick(page, name);
  await page.getByRole('toolbar').getByRole('button', { name: msg.open }).click();
  await expect(page).toHaveTitle(new RegExp(name.replace('.', '\\.')));
  await expectViewerReady(page);
  await waitPageRendered(page, 1);
}

/** Abre un PDF cifrado de OPFS con «Abrir…»: pide la contraseña, la escribe y espera al visor. */
async function pickEncrypted(page: Page, name: string, password: string): Promise<void> {
  await nextPick(page, name);
  await page.getByRole('toolbar').getByRole('button', { name: msg.open }).click();
  await enterPassword(page, password);
  await expect(page).toHaveTitle(new RegExp(name.replace('.', '\\.')));
  await expectViewerReady(page);
  await waitPageRendered(page, 1);
}

/** Escribe la contraseña en el diálogo «Contraseña necesaria» y lo confirma con Intro. */
async function enterPassword(page: Page, password: string): Promise<void> {
  const dialog = page.getByRole('dialog', { name: securityMsg.title });
  await expect(dialog).toBeVisible();
  const field = dialog.getByRole('textbox', { name: securityMsg.field });
  await field.fill(password);
  await field.press('Enter');
  await expect(dialog).toBeHidden();
}

/** Nota en la página `n` (1-based) con el texto dado, creada con la herramienta «Nota» de la barra «Comentar». */
async function noteOnPage(page: Page, n: number, text: string): Promise<void> {
  await pickTool(page, 'Nota');
  await pageFrame(page, n).click({ position: { x: 150, y: 150 } });
  await expect(commentDialog(page)).toBeVisible();
  await expect(commentField(page)).toBeFocused();
  await page.keyboard.type(text);
  await page.getByRole('button', { name: 'Cerrar', exact: true }).click();
  await expect(commentDialog(page)).toHaveCount(0);
}

/** Resalta la palabra `word` de la página `n` con doble clic y «Resaltar» de la barra de selección. */
async function highlightOnPage(page: Page, n: number, word: string): Promise<void> {
  const box = await wordBox(page, n, word);
  await page.mouse.dblclick(box.x + box.width / 2, box.y + box.height / 2);
  const bar = page.getByRole('toolbar', { name: 'Acciones de la selección' });
  await expect(bar).toBeVisible();
  await bar.getByRole('button', { name: 'Resaltar' }).click();
  await expect(zoneOf(page, n, 'Resaltado de Usuario')).toHaveCount(1);
}

/** Bytes del fichero de OPFS `name` (el que la app escribe al guardar en sitio). */
async function opfsBytes(page: Page, name: string): Promise<Uint8Array> {
  const data = await page.evaluate(async (fileName) => {
    const root = await navigator.storage.getDirectory();
    const file = await (await root.getFileHandle(fileName)).getFile();
    return [...new Uint8Array(await file.arrayBuffer())];
  }, name);
  return new Uint8Array(data);
}

/** Nombres de la sección de recientes, en orden. */
function recentNames(page: Page): Locator {
  return page.getByRole('region', RECENT_REGION).getByRole('listitem').getByRole('button');
}

/**
 * Busca en localStorage, sessionStorage e IndexedDB (todos los almacenes, claves y valores, incluidos los binarios
 * decodificados como latin1) cualquier rastro de las contraseñas. Devuelve dónde aparecen.
 */
async function passwordTraces(page: Page): Promise<string[]> {
  return page.evaluate(async (source) => {
    const pattern = new RegExp(source);
    const hits: string[] = [];
    for (const storage of [localStorage, sessionStorage]) {
      for (let i = 0; i < storage.length; i += 1) {
        const key = storage.key(i) ?? '';
        if (pattern.test(key) || pattern.test(storage.getItem(key) ?? '')) hits.push(`storage:${key}`);
      }
    }
    const scan = (value: unknown, where: string): void => {
      if (typeof value === 'string') {
        if (pattern.test(value)) hits.push(where);
      } else if (value instanceof ArrayBuffer) {
        if (pattern.test(new TextDecoder('latin1').decode(value))) hits.push(where);
      } else if (ArrayBuffer.isView(value)) {
        const bytes = new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
        if (pattern.test(new TextDecoder('latin1').decode(bytes))) hits.push(where);
      } else if (typeof value === 'object' && value !== null) {
        for (const [key, inner] of Object.entries(value)) scan(inner, `${where}.${key}`);
      }
    };
    const databases = await indexedDB.databases();
    for (const info of databases) {
      if (info.name === undefined) continue;
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open(info.name ?? '');
        request.onsuccess = () => { resolve(request.result); };
        request.onerror = () => { reject(new Error(`no se abre la base ${String(info.name)}`)); };
      });
      for (const store of Array.from(db.objectStoreNames)) {
        const tx = db.transaction(store, 'readonly');
        const objectStore = tx.objectStore(store);
        const keys = await new Promise<IDBValidKey[]>((resolve) => {
          const request = objectStore.getAllKeys();
          request.onsuccess = () => { resolve(request.result); };
        });
        const values = await new Promise<unknown[]>((resolve) => {
          const request = objectStore.getAll();
          request.onsuccess = () => { resolve(request.result); };
        });
        keys.forEach((key, index) => {
          scan(key, `idb:${String(info.name)}/${store}#${String(index)}.key`);
          scan(values[index], `idb:${String(info.name)}/${store}#${String(index)}`);
        });
      }
      db.close();
    }
    return hits;
  }, SECRETS.source);
}

test('iteración 4: cifrado en doble página con resaltado y nota, zoom en el otro, Ctrl+S, cerrar, reabrir desde recientes', async ({ page }, testInfo: TestInfo) => {
  const consoleLines: string[] = [];
  page.on('console', (message) => {
    consoleLines.push(message.text());
  });
  await installPicker(page);
  await page.goto('/');
  await putInOpfs(page, CIPHER, readFileSync(fixture(CIPHER)));
  // Mismo /ID que el cifrado (ambos salen del mismo generador): pdf.js los tomaría por el mismo documento.
  await putInOpfs(page, PLAIN, copyWithId(fixture(PLAIN), PLAIN, 7).buffer);

  // Dos pestañas: el cifrado (activo) y basic-5.pdf.
  await pickEncrypted(page, CIPHER, USER);
  await chooseView(page, 'Doble página');
  await highlightOnPage(page, 2, WORD);
  await noteOnPage(page, 2, NOTE_TEXT);
  await expect(zoneOf(page, 2, 'Nota de Usuario')).toHaveCount(1);

  await pickPlain(page, PLAIN);
  await expect(page.getByRole('tab')).toHaveCount(2);
  const zoom = page.getByRole('textbox', { name: 'Zoom' });
  await zoom.fill(ZOOM_MAX);
  await zoom.press('Enter');
  await expect(zoom).toHaveValue(`${ZOOM_MAX} %`);
  await zoom.fill(ZOOM_BACK);
  await zoom.press('Enter');
  await expect(zoom).toHaveValue(`${ZOOM_BACK} %`);

  // Vuelta al cifrado: el resaltado y la nota siguen ahí, sin guardar.
  await tabNamed(page, CIPHER).click();
  await expect(tabNamed(page, CIPHER)).toHaveAttribute('aria-selected', 'true');
  // El foco se queda en la barra de pestañas al cambiar con el ratón (PDF-095): no se exige el foco del visor.
  await expect(page.getByTestId('viewer')).toBeVisible();
  await expect(page.locator('[data-page-index]').first()).toBeVisible();
  await waitPageRendered(page, 2);
  await expect(zoneOf(page, 2, 'Resaltado de Usuario')).toHaveCount(1);
  await expect(zoneOf(page, 2, 'Nota de Usuario')).toHaveCount(1);
  await expect(page).toHaveTitle(/• /);

  // Ctrl+S: guarda en sitio (OPFS) y deja el documento sin cambios.
  await page.getByTestId('viewer').focus();
  await page.keyboard.press('Control+s');
  await expect.poll(() => page.title()).not.toContain('•');
  // El título cambia antes de que acabe el guardado: el botón «Guardar» se deshabilita hasta terminar.
  await expect(page.getByRole('button', { name: msg.save, exact: true })).toBeEnabled();
  const saved = testInfo.outputPath(`guardado-${CIPHER}`);
  writeFileSync(saved, await opfsBytes(page, CIPHER));
  const check = qpdfCheck(saved, USER);
  expect(check.code, check.output).toBe(0);
  const decrypted = testInfo.outputPath(`descifrado-${CIPHER}`);
  const decryption = run(['--password=' + USER, '--decrypt', saved, decrypted]);
  expect(decryption.status, decryption.stderr).toBe(0);
  const subtypes = liveAnnotations(decrypted).map((a) => a.subtype);
  expect(subtypes.filter((s) => s === 'Highlight')).toHaveLength(1);
  expect(subtypes.filter((s) => s === 'Text')).toHaveLength(1);

  // Cerrar las dos pestañas (Ctrl+W cierra la activa). Ctrl+W se ignora mientras hay un guardado en curso.
  await page.keyboard.press('Control+w');
  // Con una sola pestaña abierta la barra de pestañas se oculta (TabBar): queda el documento en claro.
  await expect(page.getByRole('tablist')).toHaveCount(0);
  await expect(page).toHaveTitle(new RegExp(PLAIN.replace('.', '\\.')));
  await page.keyboard.press('Control+w');
  await expect(page.getByRole('tab')).toHaveCount(0);
  await expect(page.getByRole('region', RECENT_REGION)).toBeVisible();
  await expect(recentNames(page)).toHaveText([PLAIN, CIPHER]);

  // Reabrir el cifrado desde «Recientes»: pide la contraseña, vuelve a la p2 con sus anotaciones.
  await page.getByRole('region', RECENT_REGION).getByRole('button', { name: CIPHER }).click();
  await enterPassword(page, USER);
  await expect(page).toHaveTitle(new RegExp(CIPHER.replace('.', '\\.')));
  await expectViewerReady(page);
  await waitPageRendered(page, 2);
  await expect(zoneOf(page, 2, 'Resaltado de Usuario')).toHaveCount(1);
  await expect(zoneOf(page, 2, 'Nota de Usuario')).toHaveCount(1);

  // Ninguna contraseña en el almacenamiento del navegador ni en la consola durante el flujo.
  expect(await passwordTraces(page), 'rastros de la contraseña en el almacenamiento').toEqual([]);
  expect(consoleLines.filter((line) => SECRETS.test(line)), 'contraseñas en la consola').toEqual([]);
});
