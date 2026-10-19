/**
 * Utilidades compartidas por las pruebas E2E de pestañas (PDF-095): consultas de pestañas y apertura de documentos
 * adicionales.
 */
import { readFileSync } from 'node:fs';
import { expect, type Locator, type Page } from '@playwright/test';
import { waitPageRendered } from './helpers.ts';
import { expectViewerReady } from './viewer-ready.ts';

/** Entrada de `setInputFiles` del selector de la web. */
export type FileInput = Parameters<Locator['setInputFiles']>[0];

/** Escapa un texto para usarlo dentro de una expresión regular. */
export function literal(text: string): RegExp {
  return new RegExp(text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
}

/** Pestaña cuyo nombre accesible contiene el nombre del fichero. */
export function tabNamed(page: Page, name: string): Locator {
  return page.getByRole('tab', { name: literal(name) });
}

/**
 * Copia de un PDF con otro nombre y otro `/ID` del trailer (pdf.js identifica los documentos por el `/ID`, así que
 * sin cambiarlo el aviso «ya está abierto» saltaría). Se cambian los dígitos por otros de la misma longitud: los
 * desplazamientos del xref no cambian.
 */
export function copyWithId(path: string, name: string, n: number): { name: string; mimeType: string; buffer: Buffer } {
  const text = readFileSync(path).toString('latin1');
  const hex = n.toString(16).padStart(32, '0');
  const copy = text.replace(/\/ID \[<[0-9A-Fa-f]+> <[0-9A-Fa-f]+>\]/, `/ID [<${hex}> <${hex}>]`);
  if (copy === text) throw new Error(`${path} no tiene /ID en el trailer`);
  return { name, mimeType: 'application/pdf', buffer: Buffer.from(copy, 'latin1') };
}

/** Abre un documento más (ya hay visor) y espera a que su pestaña esté activa y dibujada. */
export async function openMore(page: Page, file: FileInput, name: string): Promise<void> {
  await page.locator('[data-testid=open-input]').setInputFiles(file);
  await expect(tabNamed(page, name)).toHaveAttribute('aria-selected', 'true');
  await expectViewerReady(page);
  await waitPageRendered(page, 1);
}
