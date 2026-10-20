import { readFileSync } from 'node:fs';
import { expect, type Locator, type Page } from '@playwright/test';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';

/**
 * Ayudas de los e2e de «Organizar páginas» (PDF-126): abrir la vista, arrastrar con el ratón y leer el PDF que
 * se descarga (texto y giro de cada página) con pdf.js en Node.
 */

/** Abre «Organizar páginas» desde «Más acciones» y espera a que la cuadrícula tenga sus primeras celdas. */
export async function openOrganize(page: Page): Promise<Locator> {
  await page.getByRole('button', { name: 'Más acciones' }).click();
  await page.getByRole('menuitem', { name: 'Organizar páginas…' }).click();
  const grid = page.getByRole('listbox', { name: 'Organizar páginas' });
  await expect(grid).toBeVisible();
  await expect(grid.getByRole('option').first()).toBeVisible();
  return grid;
}

/** Celda «Página n» de la cuadrícula (posición actual, 1-based). */
export function pageCell(grid: Locator, n: number): Locator {
  return grid.getByRole('option', { name: `Página ${String(n)}`, exact: true });
}

/**
 * Arrastra la celda `from` sobre la mitad izquierda (`side: 'left'`) o derecha (`'right'`) de la celda `to`
 * con el ratón: pulsar, mover por pasos y soltar.
 */
export async function dragCell(page: Page, from: Locator, to: Locator, side: 'left' | 'right'): Promise<void> {
  const a = await from.boundingBox();
  const b = await to.boundingBox();
  if (a === null || b === null) throw new Error('Celda sin caja visible para arrastrar');
  const fromX = a.x + a.width / 2;
  const fromY = a.y + a.height / 2;
  const toX = side === 'right' ? b.x + b.width * 0.75 : b.x + b.width * 0.25;
  const toY = b.y + b.height / 2;
  await page.mouse.move(fromX, fromY);
  await page.mouse.down();
  await page.mouse.move(toX, toY, { steps: 15 });
  await page.mouse.up();
}

/** Texto y giro de las páginas de un PDF guardado (lo lee pdf.js en Node, sin la app). */
export interface SavedPdf {
  readonly numPages: number;
  textOf(n: number): Promise<string>;
  rotationOf(n: number): Promise<number>;
  close(): Promise<void>;
}

export async function openSavedPdf(path: string): Promise<SavedPdf> {
  const task = getDocument({ data: new Uint8Array(readFileSync(path)), verbosity: 0 });
  const doc = await task.promise;
  return {
    numPages: doc.numPages,
    async textOf(n: number): Promise<string> {
      const content = await (await doc.getPage(n)).getTextContent();
      return content.items.map((item) => ('str' in item ? item.str : '')).join('');
    },
    async rotationOf(n: number): Promise<number> {
      return (await doc.getPage(n)).rotate;
    },
    async close(): Promise<void> {
      await task.destroy();
    },
  };
}
