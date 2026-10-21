import AxeBuilder from "@axe-core/playwright";
import {
  expect,
  test,
  type Locator,
  type Page,
  type TestInfo,
} from "@playwright/test";
import { unzipSync } from "fflate";
import { readFileSync } from "node:fs";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { organizeMsg } from "../../src/ui/messages-organize.ts";
import { fixture, goToPageByKeyboard, waitPageRendered } from "./helpers.ts";
import {
  openWithDownloads,
  storeDownload,
  wordBox,
} from "./annotations-kit.ts";
import {
  dragCell,
  openOrganize,
  openSavedPdf,
  pageCell,
} from "./organize-kit.ts";

/**
 * Extraer y dividir (PDF-127): diálogos desde «Más acciones», la vista Organizar y los PDF que se descargan,
 * leídos con pdf.js en Node para comprobar páginas, texto y anotaciones.
 */

/** Abre un elemento de «Más acciones» y devuelve el diálogo con ese título. */
async function openDialog(
  page: Page,
  item: string,
  title: string,
): Promise<Locator> {
  await page.getByRole("button", { name: "Más acciones", exact: true }).click();
  await page.getByRole("menuitem", { name: item, exact: true }).click();
  const dialog = page.getByRole("dialog", { name: title, exact: true });
  await expect(dialog).toBeVisible();
  return dialog;
}

/** Ejecuta `action` (que dispara una descarga) y guarda la descarga: ruta y nombre sugerido. */
async function downloaded(
  page: Page,
  testInfo: TestInfo,
  action: () => Promise<void>,
  outName: string,
): Promise<{ path: string; name: string }> {
  const download = page.waitForEvent("download");
  await action();
  const file = await download;
  return {
    path: await storeDownload(file, testInfo, outName),
    name: file.suggestedFilename(),
  };
}

/** Número de páginas de un PDF en memoria (pdf.js en Node). */
async function pageCountOf(bytes: Uint8Array): Promise<number> {
  const task = getDocument({ data: bytes.slice(), verbosity: 0 });
  const doc = await task.promise;
  const count = doc.numPages;
  await task.destroy();
  return count;
}

test("outline.pdf: extraer el rango 3-7 descarga outline-paginas-3-7.pdf con 5 páginas desde «Página 3 de 30»", async ({
  page,
}, testInfo) => {
  await openWithDownloads(page, fixture("outline.pdf"));
  const dialog = await openDialog(
    page,
    organizeMsg.extractMenu,
    organizeMsg.extractTitle,
  );
  await dialog
    .getByRole("radio", { name: organizeMsg.extractRange, exact: true })
    .check();
  await dialog
    .getByRole("textbox", { name: organizeMsg.extractRangeField, exact: true })
    .fill("3-7");

  const { path, name } = await downloaded(
    page,
    testInfo,
    () =>
      dialog
        .getByRole("button", { name: organizeMsg.extract, exact: true })
        .click(),
    "extraido.pdf",
  );

  expect(name).toBe("outline-paginas-3-7.pdf");
  const saved = await openSavedPdf(path);
  expect(saved.numPages).toBe(5);
  expect(await saved.textOf(1)).toContain("Página 3 de 30");
  await saved.close();
});

test("outline.pdf: dividir por marcadores descarga outline-partes.zip con 4 PDF de 10, 10, 9 y 1 páginas", async ({
  page,
}, testInfo) => {
  await openWithDownloads(page, fixture("outline.pdf"));
  const dialog = await openDialog(
    page,
    organizeMsg.splitMenu,
    organizeMsg.splitTitle,
  );
  await dialog
    .getByRole("radio", { name: organizeMsg.byBookmarks, exact: true })
    .check();

  const { path, name } = await downloaded(
    page,
    testInfo,
    () =>
      dialog
        .getByRole("button", { name: organizeMsg.split, exact: true })
        .click(),
    "partes.zip",
  );

  expect(name).toBe("outline-partes.zip");
  const entries = unzipSync(new Uint8Array(readFileSync(path)));
  const names = Object.keys(entries).sort();
  expect(names).toHaveLength(4);
  const counts: number[] = [];
  for (const entry of names)
    counts.push(await pageCountOf(entries[entry] ?? new Uint8Array(0)));
  expect(counts).toEqual([10, 10, 9, 1]);
});

test("basic-5.pdf: un resaltado sin guardar en la página 2 sale en el PDF extraído de la página 2", async ({
  page,
}, testInfo) => {
  await openWithDownloads(page, fixture("basic-5.pdf"));
  await goToPageByKeyboard(page, 2, 5);
  await waitPageRendered(page, 2);
  const word = await wordBox(page, 2, "Página");
  await page.mouse.dblclick(word.x + word.width / 2, word.y + word.height / 2);
  await page
    .getByRole("toolbar", { name: "Acciones de la selección" })
    .getByRole("button", { name: "Resaltar" })
    .click();

  // La página actual es la 2: el diálogo la propone por defecto.
  const dialog = await openDialog(
    page,
    organizeMsg.extractMenu,
    organizeMsg.extractTitle,
  );
  const { path, name } = await downloaded(
    page,
    testInfo,
    () =>
      dialog
        .getByRole("button", { name: organizeMsg.extract, exact: true })
        .click(),
    "extraido.pdf",
  );

  expect(name).toBe("basic-5-paginas-2.pdf");
  const bytes = new Uint8Array(readFileSync(path));
  const task = getDocument({ data: bytes.slice(), verbosity: 0 });
  const doc = await task.promise;
  expect(doc.numPages).toBe(1);
  const annotations = await (await doc.getPage(1)).getAnnotations();
  expect(
    annotations.some((annotation) => annotation.subtype === "Highlight"),
  ).toBe(true);
  await task.destroy();
});

test("Organizar: tras mover la página 4 delante de la 2, extraer las páginas 2 y 3 del plan da un PDF con 4 y 2 en ese orden", async ({
  page,
}, testInfo) => {
  await openWithDownloads(page, fixture("basic-5.pdf"));
  const grid = await openOrganize(page);
  await dragCell(page, pageCell(grid, 4), pageCell(grid, 2), "left");
  await expect(pageCell(grid, 2)).toContainText("(antes 4)");
  await pageCell(grid, 2).click();
  await pageCell(grid, 3).click({ modifiers: ["Control"] });

  const toolbar = page.getByRole("toolbar", {
    name: organizeMsg.toolbar,
    exact: true,
  });
  const { path } = await downloaded(
    page,
    testInfo,
    () =>
      toolbar
        .getByRole("button", { name: organizeMsg.extract, exact: true })
        .click(),
    "extraido.pdf",
  );

  const saved = await openSavedPdf(path);
  expect(saved.numPages).toBe(2);
  expect(await saved.textOf(1)).toContain("Página 4 de 5");
  expect(await saved.textOf(2)).toContain("Página 2 de 5");
  await saved.close();
});

test("encrypted-owner-only.pdf: «Extraer páginas…» y «Dividir documento…» deshabilitadas con su explicación", async ({
  page,
}) => {
  await openWithDownloads(page, fixture("encrypted-owner-only.pdf"));
  await page.getByRole("button", { name: "Más acciones", exact: true }).click();
  for (const item of [organizeMsg.extractMenu, organizeMsg.splitMenu]) {
    const entry = page.getByRole("menuitem", { name: item, exact: true });
    await expect(entry).toBeDisabled();
    await expect(entry).toHaveAttribute("title", organizeMsg.extractBlocked);
  }
  await page.keyboard.press("Escape");
});

test.describe("diálogos: teclado, accesibilidad y tema oscuro", () => {
  test.use({ colorScheme: "dark" });

  test("Intro en el menú abre «Extraer páginas» con foco en el primer control; axe sin violaciones; Escape cierra", async ({
    page,
  }) => {
    await openWithDownloads(page, fixture("basic-5.pdf"));
    await page
      .getByRole("button", { name: "Más acciones", exact: true })
      .click();
    await page
      .getByRole("menuitem", { name: organizeMsg.extractMenu, exact: true })
      .focus();
    await page.keyboard.press("Enter");

    const dialog = page.getByRole("dialog", {
      name: organizeMsg.extractTitle,
      exact: true,
    });
    await expect(dialog).toBeVisible();
    await expect(
      dialog.getByRole("radio", {
        name: organizeMsg.extractCurrent(1),
        exact: true,
      }),
    ).toBeFocused();
    const results = await new AxeBuilder({ page })
      .include('[role="dialog"]')
      .analyze();
    expect(results.violations).toEqual([]);

    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
  });
});
