import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page, type TestInfo } from '@playwright/test';
import { fixture, pageFrame } from './helpers.ts';
import { openWithDownloads } from './annotations-kit.ts';

/**
 * Accesibilidad de la iteración 3 (PDF-090): axe-core sobre cuatro vistas (campo de formulario enfocado, diálogo
 * «Crear firma», diálogo «Imprimir» y diálogo «Propiedades» con la pestaña «Fuentes»), en tema claro y oscuro.
 * Ninguna violación de impacto «serious» o «critical» en ninguna de las ocho vistas.
 */

const SEVERE = ['serious', 'critical'];

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

const VIEWS: readonly {
  readonly name: string;
  readonly open: (page: Page) => Promise<void>;
}[] = [
  {
    name: 'campo de formulario enfocado (form-full, p1)',
    open: async (page) => {
      await openWithDownloads(page, fixture('form-full.pdf'));
      const nombre = pageFrame(page, 1).getByRole('textbox', { name: 'nombre', exact: true });
      await nombre.focus();
      await expect(nombre).toBeFocused();
    },
  },
  {
    name: 'diálogo «Crear firma»',
    open: async (page) => {
      await openWithDownloads(page, fixture('basic-5.pdf'));
      await page.getByRole('button', { name: 'Firmar', exact: true }).click();
      await page.getByRole('menuitem', { name: 'Crear firma…' }).click();
      await expect(page.getByRole('dialog', { name: 'Crear firma' })).toBeVisible();
    },
  },
  {
    name: 'diálogo «Imprimir»',
    open: async (page) => {
      await openWithDownloads(page, fixture('basic-5.pdf'));
      await page.keyboard.press('Control+P');
      await expect(page.getByRole('dialog', { name: 'Imprimir', exact: true })).toBeVisible();
    },
  },
  {
    name: 'diálogo «Propiedades», pestaña «Fuentes»',
    open: async (page) => {
      await openWithDownloads(page, fixture('basic-5.pdf'));
      await page.getByRole('button', { name: 'Más acciones' }).click();
      await page.getByRole('menuitem', { name: 'Propiedades del documento…' }).click();
      const dialog = page.getByRole('dialog', { name: 'Propiedades del documento' });
      await expect(dialog).toBeVisible();
      await dialog.getByRole('tab', { name: 'Fuentes' }).click();
      await expect(dialog.getByRole('status')).toBeHidden({ timeout: 30_000 });
      await expect(dialog.getByRole('table')).toBeVisible();
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
        await view.open(page);
        // Con el tema «Sistema» (por defecto) la app sigue al navegador: se confirma que se mide el tema previsto.
        expect(await page.evaluate(() => window.matchMedia('(prefers-color-scheme: dark)').matches)).toBe(scheme === 'dark');
        expect(await severeViolations(page, testInfo, `${view.name}, tema ${theme}`)).toEqual([]);
      });
    }
  });
}
