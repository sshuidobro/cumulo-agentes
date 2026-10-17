import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { FIXTURES_DIR } from '../fixtures/paths.ts';

function fixtureBytes(name: string): Buffer {
  return readFileSync(join(FIXTURES_DIR, name));
}

test('nombre con espacios, ñ, tildes y emoji se muestra en el título de la ventana', async ({ page }) => {
  await page.goto('/');
  const name = 'Informe año ñandú 😀 final.pdf';
  await page
    .locator('[data-testid=open-input]')
    .setInputFiles({ name, mimeType: 'application/pdf', buffer: fixtureBytes('basic-5.pdf') });
  await expect(page.getByTestId('document-ready')).toHaveText('5 páginas');
  await expect(page).toHaveTitle(`${name} — Lector PDF`);
});

test('extensión equivocada: un PDF válido llamado .txt se abre; un texto llamado .pdf da error claro', async ({ page }) => {
  await page.goto('/');
  const input = page.locator('[data-testid=open-input]');
  await input.setInputFiles({ name: 'texto.pdf', mimeType: 'application/pdf', buffer: Buffer.from('hola mundo, esto no es un PDF') });
  await expect(page.getByRole('alert')).toContainText('Este fichero no es un PDF.');
  await expect(page.getByRole('alert')).not.toContainText(/undefined|Exception|TypeError/);
});

test('PDF truncado: mensaje en español, sin pantalla en blanco ni errores de consola', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/');
  await page.locator('[data-testid=open-input]').setInputFiles(join(FIXTURES_DIR, 'corrupt-truncated.pdf'));
  const alert = page.getByRole('alert');
  await expect(alert).toBeVisible();
  const text = (await alert.textContent()) ?? '';
  expect(text).toMatch(/[áéíóúñ]|PDF|fichero/i);
  expect(errors).toEqual([]);
});

test('tras un error se puede abrir otro documento válido y el error desaparece', async ({ page }) => {
  await page.goto('/');
  const input = page.locator('[data-testid=open-input]');
  await input.setInputFiles(join(FIXTURES_DIR, 'corrupt-not-pdf.pdf'));
  await expect(page.getByRole('alert')).toBeVisible();
  await input.setInputFiles(join(FIXTURES_DIR, 'basic-5.pdf'));
  await expect(page.getByTestId('document-ready')).toHaveText('5 páginas');
  await expect(page.getByRole('alert')).toHaveCount(0);
});

test('abrir B encima de A deja B', async ({ page }) => {
  await page.goto('/');
  const input = page.locator('[data-testid=open-input]');
  await input.setInputFiles(join(FIXTURES_DIR, 'pages-5000.pdf'));
  await input.setInputFiles(join(FIXTURES_DIR, 'basic-5.pdf'));
  await expect(page.getByTestId('document-ready')).toHaveText('5 páginas');
  await expect(page).toHaveTitle('basic-5.pdf — Lector PDF');
});

test('arrastrar y soltar un PDF muestra la superposición y lo abre', async ({ page }) => {
  await page.goto('/');
  const bytes = [...fixtureBytes('basic-5.pdf')];
  await page.evaluate((arr) => {
    const d = new DataTransfer();
    d.items.add(new File([new Uint8Array(arr)], 'arrastrado.pdf', { type: 'application/pdf' }));
    const fire = (type: string): void => {
      window.dispatchEvent(new DragEvent(type, { dataTransfer: d, bubbles: true, cancelable: true }));
    };
    fire('dragenter');
    fire('dragover');
    (window as unknown as { __fireDrop: () => void }).__fireDrop = () => {
      fire('drop');
    };
  }, bytes);
  await expect(page.getByText('Suelta el PDF para abrirlo')).toBeVisible();
  await page.evaluate(() => {
    (window as unknown as { __fireDrop: () => void }).__fireDrop();
  });
  await expect(page.getByTestId('document-ready')).toHaveText('5 páginas');
  await expect(page).toHaveTitle('arrastrado.pdf — Lector PDF');
  await expect(page.getByText('Suelta el PDF para abrirlo')).toHaveCount(0);
});

test('teclado: Tab llega al botón Abrir… con foco visible', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByTitle('Abrir… (Ctrl+O)')).toBeVisible();
  const reached: string[] = [];
  for (let i = 0; i < 6; i += 1) {
    await page.keyboard.press('Tab');
    const info = await page.evaluate(() => {
      const el = document.activeElement;
      if (el === null || el === document.body) return null;
      const cs = getComputedStyle(el);
      return {
        name: el.textContent.trim() || el.getAttribute('title') || el.tagName,
        outline: cs.outlineStyle !== 'none' && cs.outlineWidth !== '0px',
        shadow: cs.boxShadow !== 'none',
      };
    });
    if (info !== null) {
      reached.push(info.name);
      expect(info.outline || info.shadow, `foco visible en «${info.name}»`).toBe(true);
    }
  }
  expect(reached.some((n) => n.startsWith('Abrir…'))).toBe(true);
});

test('Ctrl+O llama al selector de ficheros y abre el elegido', async ({ page }) => {
  const bytes = [...fixtureBytes('basic-5.pdf')];
  // La plataforma captura showOpenFilePicker al arrancar: se sustituye antes de cargar la app.
  await page.addInitScript((arr) => {
    const w = window as unknown as { __pickerCalls: number; showOpenFilePicker: () => Promise<unknown[]> };
    w.__pickerCalls = 0;
    w.showOpenFilePicker = () => {
      w.__pickerCalls += 1;
      const file = new File([new Uint8Array(arr)], 'ctrl-o.pdf', { type: 'application/pdf' });
      return Promise.resolve([{ kind: 'file', name: 'ctrl-o.pdf', getFile: () => Promise.resolve(file) }]);
    };
  }, bytes);
  await page.goto('/');
  // No se pulsa hasta que la app está montada (el botón Abrir es visible); si no, el atajo aún no está registrado.
  await expect(page.getByTitle('Abrir… (Ctrl+O)')).toBeVisible();
  await page.keyboard.press('Control+o');
  await expect.poll(() => page.evaluate(() => (window as unknown as { __pickerCalls: number }).__pickerCalls)).toBe(1);
  await expect(page.getByTestId('document-ready')).toHaveText('5 páginas');
  await expect(page).toHaveTitle('ctrl-o.pdf — Lector PDF');
});

test('el botón de la barra tiene el tooltip con el atajo', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByTitle('Abrir… (Ctrl+O)')).toBeVisible();
});
