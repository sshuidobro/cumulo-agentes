import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { fixture } from './helpers.ts';
import { openWithDownloads } from './annotations-kit.ts';

/**
 * Accesibilidad de «Organizar páginas» (PDF-125): axe-core sobre la vista abierta con basic-5.pdf,
 * en tema claro y oscuro. Ninguna violación de ningún impacto.
 */

const THEMES = [
  { theme: 'claro', scheme: 'light' },
  { theme: 'oscuro', scheme: 'dark' },
] as const;

for (const { theme, scheme } of THEMES) {
  test.describe(`Organizar páginas, tema ${theme}`, () => {
    test.use({ colorScheme: scheme });

    test('axe: la vista de cuadrícula no tiene violaciones', async ({ page }, testInfo) => {
      await openWithDownloads(page, fixture('basic-5.pdf'));
      await page.getByRole('button', { name: 'Más acciones' }).click();
      await page.getByRole('menuitem', { name: 'Organizar páginas…' }).click();
      const list = page.getByRole('listbox', { name: 'Organizar páginas' });
      await expect(list).toBeVisible();
      await expect(list.getByRole('option')).toHaveCount(5);

      // Con el tema «Sistema» (por defecto) la app sigue al navegador: se confirma que se mide el tema previsto.
      expect(await page.evaluate(() => window.matchMedia('(prefers-color-scheme: dark)').matches)).toBe(scheme === 'dark');

      const results = await new AxeBuilder({ page }).analyze();
      testInfo.annotations.push({
        type: 'axe',
        description: `Organizar páginas, tema ${theme}: ${String(results.violations.length)} violaciones`,
      });
      expect(
        results.violations.map((v) => `${v.impact ?? '?'} ${v.id}: ${v.help} (${String(v.nodes.length)} nodos)`),
      ).toEqual([]);
    });
  });
}
