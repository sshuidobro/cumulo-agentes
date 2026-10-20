import { readFileSync } from 'node:fs';
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page, type TestInfo } from '@playwright/test';
import { msg } from '../../src/ui/messages.ts';
import { securityMsg } from '../../src/ui/messages-security.ts';
import { tabsMsg } from '../../src/ui/messages-tabs.ts';
import { viewMsg } from '../../src/ui/messages-view.ts';
import { fixture } from './helpers.ts';
import { disableFileSystemAccess, openWithDownloads } from './annotations-kit.ts';
import { copyWithId, openMore } from './tabs-kit.ts';
import { expectViewerReady } from './viewer-ready.ts';

/**
 * Accesibilidad de la iteración 4 (PDF-099): axe-core sobre seis vistas, en tema claro y oscuro (12 comprobaciones):
 * diálogo «Contraseña necesaria» con error, barra de pestañas con tres documentos, menú «Vista», menú «Abrir
 * recientes», «Propiedades del documento» en la pestaña «Seguridad» y pantalla completa. Ninguna violación de
 * impacto «serious» o «critical» en ninguna vista.
 */

const SEVERE = ['serious', 'critical'];
const CIPHER = 'encrypted-aes-256.pdf';
const PLAIN = 'basic-5.pdf';
const WRONG_PASSWORD = 'incorrecta';

/** Violaciones de axe de impacto grave o crítico, con el formato del informe; registra el total en la anotación. */
async function severeViolations(page: Page, testInfo: TestInfo, view: string): Promise<string[]> {
  const results = await new AxeBuilder({ page }).analyze();
  const severe = results.violations.filter((v) => v.impact !== null && v.impact !== undefined && SEVERE.includes(v.impact));
  testInfo.annotations.push({
    type: 'axe',
    description: `${view}: ${String(results.violations.length)} violaciones en total, ${String(severe.length)} serious/critical`,
  });
  return severe.map((v) => `${v.impact ?? '?'} ${v.id}: ${v.help} (${String(v.nodes.length)} nodos)`);
}

/** Instala el selector falso (PDF-049) antes de cargar la página: devuelve el fichero de OPFS que indique `__nextPick`. */
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

/** Copia un fixture a OPFS, lo abre con «Abrir…» (queda en «Recientes») y espera al visor. */
async function openRecent(page: Page, name: string): Promise<void> {
  await installPicker(page);
  await page.goto('/');
  const bytes = [...readFileSync(fixture(name))];
  await page.evaluate(async ({ fileName, data }) => {
    const root = await navigator.storage.getDirectory();
    const handle = await root.getFileHandle(fileName, { create: true });
    const writable = await handle.createWritable();
    await writable.write(new Uint8Array(data));
    await writable.close();
  }, { fileName: name, data: bytes });
  await page.evaluate((fileName) => {
    (window as unknown as { __nextPick?: string }).__nextPick = fileName;
  }, name);
  await page.getByRole('toolbar').getByRole('button', { name: msg.open }).click();
  await expect(page).toHaveTitle(new RegExp(name.replace('.', '\\.')));
  await expectViewerReady(page);
}

const VIEWS: readonly {
  readonly name: string;
  readonly open: (page: Page, testInfo: TestInfo) => Promise<void>;
}[] = [
  {
    name: 'diálogo «Contraseña necesaria» con error (AES-256)',
    open: async (page) => {
      await disableFileSystemAccess(page);
      await page.goto('/');
      await page.locator('[data-testid=open-input]').setInputFiles(fixture(CIPHER));
      const dialog = page.getByRole('dialog', { name: securityMsg.title });
      await expect(dialog).toBeVisible();
      const field = dialog.getByRole('textbox', { name: securityMsg.field });
      await field.fill(WRONG_PASSWORD);
      await field.press('Enter');
      await expect(dialog.getByText(securityMsg.wrongPassword)).toBeVisible();
    },
  },
  {
    name: 'barra de pestañas con tres documentos',
    open: async (page) => {
      await openWithDownloads(page, fixture(PLAIN));
      await openMore(page, copyWithId(fixture(PLAIN), 'basic-5-b.pdf', 2), 'basic-5-b.pdf');
      await openMore(page, copyWithId(fixture(PLAIN), 'basic-5-c.pdf', 3), 'basic-5-c.pdf');
      await expect(page.getByRole('tab')).toHaveCount(3);
    },
  },
  {
    name: 'menú «Vista» abierto',
    open: async (page) => {
      await openWithDownloads(page, fixture(PLAIN));
      await page.getByRole('button', { name: viewMsg.view, exact: true }).click();
      await expect(page.getByRole('menu')).toBeVisible();
    },
  },
  {
    name: 'menú «Abrir recientes» con un documento',
    open: async (page) => {
      await openRecent(page, PLAIN);
      await page.getByRole('button', { name: tabsMsg.recentMenu, exact: true }).click();
      await expect(page.getByRole('menu')).toBeVisible();
    },
  },
  {
    name: 'propiedades del documento, pestaña «Seguridad»',
    open: async (page) => {
      await openWithDownloads(page, fixture(PLAIN));
      await page.getByRole('button', { name: 'Más acciones' }).click();
      await page.getByRole('menuitem', { name: 'Propiedades del documento…' }).click();
      const dialog = page.getByRole('dialog', { name: 'Propiedades del documento' });
      await expect(dialog).toBeVisible();
      await dialog.getByRole('tab', { name: securityMsg.tabSecurity, exact: true }).click();
      await expect(dialog.getByRole('tab', { name: securityMsg.tabSecurity, exact: true })).toHaveAttribute('aria-selected', 'true');
      await expect(dialog.getByText(securityMsg.ciphers.none, { exact: true })).toBeVisible();
    },
  },
  {
    name: 'pantalla completa (Ctrl+L)',
    open: async (page) => {
      await openWithDownloads(page, fixture(PLAIN));
      await page.getByTestId('viewer').focus();
      await page.keyboard.press('Control+l');
      await expect(page.getByRole('button', { name: viewMsg.view, exact: true })).toHaveCount(0);
      await expect(page.getByRole('status').filter({ hasText: viewMsg.fullscreenHint })).toBeVisible();
    },
  },
];

const THEMES = [
  { theme: 'claro', scheme: 'light' },
  { theme: 'oscuro', scheme: 'dark' },
] as const;

for (const { theme, scheme } of THEMES) {
  test.describe(`tema ${theme}`, () => {
    test.use({ colorScheme: scheme });

    for (const view of VIEWS) {
      test(`axe: ${view.name} sin incidencias serious ni critical`, async ({ page }, testInfo) => {
        await view.open(page, testInfo);
        // Con el tema «Sistema» (por defecto) la app sigue al navegador: se confirma que se mide el tema previsto.
        expect(await page.evaluate(() => window.matchMedia('(prefers-color-scheme: dark)').matches)).toBe(scheme === 'dark');
        expect(await severeViolations(page, testInfo, `${view.name}, tema ${theme}`)).toEqual([]);
      });
    }
  });
}
