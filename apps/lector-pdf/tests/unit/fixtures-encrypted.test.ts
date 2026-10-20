import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { getDocument, PasswordResponses, PermissionFlag, type PDFDocumentProxy } from 'pdfjs-dist';
import { describe, expect, it } from 'vitest';
import { FIXTURES } from '../fixtures/catalog.ts';
import { FIXTURES_DIR } from '../fixtures/paths.ts';
import { run } from '../support/qpdf.ts';

const USER_PASSWORD = 'usuario';
const OWNER_PASSWORD = 'propietario';

/** Cifrados que necesitan contraseña de usuario para abrirse. */
const WITH_PASSWORD = [
  'encrypted-rc4-40.pdf',
  'encrypted-rc4-128.pdf',
  'encrypted-aes-128.pdf',
  'encrypted-aes-256.pdf',
  'encrypted-aes-256-objstm.pdf',
  'encrypted-annotated-aes-128.pdf',
] as const;
const OWNER_ONLY = 'encrypted-owner-only.pdf';
/** Texto de la página 1 de la base de cada cifrado (`basic-5`, `compressed` o `annotated`). */
const FIRST_PAGE_TEXT: Readonly<Record<(typeof WITH_PASSWORD)[number], string>> = {
  'encrypted-rc4-40.pdf': 'Página 1 de 5',
  'encrypted-rc4-128.pdf': 'Página 1 de 5',
  'encrypted-aes-128.pdf': 'Página 1 de 5',
  'encrypted-aes-256.pdf': 'Página 1 de 5',
  'encrypted-aes-256-objstm.pdf': 'Página 1 de 50',
  'encrypted-annotated-aes-128.pdf': 'Página 1 de 3',
};
const ENCRYPTED = [...WITH_PASSWORD, OWNER_ONLY] as const;

const ENCRYPTED_MODULE = fileURLToPath(new URL('../fixtures/encrypted.ts', import.meta.url));

function fixturePath(name: string): string {
  return join(FIXTURES_DIR, name);
}

function loadBytes(name: string): Uint8Array {
  return new Uint8Array(readFileSync(fixturePath(name)));
}

/** Abre con pdf.js (sin `onPassword`: una contraseña ausente o errónea se rechaza) y cierra al terminar `use`. */
async function withDocument<T>(
  name: string,
  password: string | undefined,
  callback: (doc: PDFDocumentProxy) => Promise<T>,
): Promise<T> {
  const task = getDocument({
    data: loadBytes(name),
    verbosity: 0,
    ...(password === undefined ? {} : { password }),
  });
  try {
    return await callback(await task.promise);
  } finally {
    await task.destroy();
  }
}

/** Error con el que pdf.js rechaza la apertura (se espera que falle). */
async function openError(name: string, password: string | undefined): Promise<unknown> {
  const task = getDocument({
    data: loadBytes(name),
    verbosity: 0,
    ...(password === undefined ? {} : { password }),
  });
  try {
    await task.promise;
  } catch (cause) {
    return cause;
  } finally {
    await task.destroy();
  }
  throw new Error(`${name} se abrió y debía fallar`);
}

async function textOfFirstPage(doc: PDFDocumentProxy): Promise<string> {
  const page = await doc.getPage(1);
  const content = await page.getTextContent();
  return content.items.map((item) => ('str' in item ? item.str : '')).join('');
}

/** Subtipos de las anotaciones de cada página, en orden. */
async function annotationSubtypes(doc: PDFDocumentProxy): Promise<string[][]> {
  const pages: string[][] = [];
  for (let number = 1; number <= doc.numPages; number++) {
    const page = await doc.getPage(number);
    const annotations = await page.getAnnotations();
    pages.push(annotations.map((annotation) => annotation.subtype ?? '').sort());
  }
  return pages;
}

/** Ejecuta el generador en un proceso hijo con `PATH` vacío, para que `qpdf` no se encuentre. */
function generateWithoutPath(): string {
  const code = `import(${JSON.stringify(pathToFileURL(ENCRYPTED_MODULE).href)}).then((m) => {
    try {
      m.qpdfEncrypt(new Uint8Array([37]), ['--encrypt', 'usuario', 'propietario', '40', '--']);
      console.log('OK');
    } catch (cause) {
      console.log('ERROR ' + cause.message);
    }
  });`;
  const result = spawnSync(
    process.execPath,
    ['--experimental-strip-types', '--no-warnings', '--input-type=module', '-e', code],
    { encoding: 'utf8', env: { PATH: '' } },
  );
  return `${result.stdout}${result.stderr}`;
}

describe('fixtures cifrados (qpdf)', () => {
  it('los 7 ficheros cifrados están en el catálogo y se generan', () => {
    for (const name of ENCRYPTED) {
      expect(FIXTURES.some((fixture) => fixture.name === name), name).toBe(true);
      expect(existsSync(fixturePath(name)), name).toBe(true);
    }
  });

  it.each(WITH_PASSWORD)('%s: qpdf --check con la contraseña de usuario termina con código 0', (name) => {
    const { status, stdout, stderr } = run(['--check', `--password=${USER_PASSWORD}`, fixturePath(name)]);
    expect(status, `${stdout}${stderr}`).toBe(0);
  });

  it(`${OWNER_ONLY}: qpdf --check sin contraseña termina con código 0`, () => {
    const { status, stdout, stderr } = run(['--check', fixturePath(OWNER_ONLY)]);
    expect(status, `${stdout}${stderr}`).toBe(0);
  });

  it.each(WITH_PASSWORD)('%s: sin contraseña pdf.js rechaza con NEED_PASSWORD', async (name) => {
    const cause = await openError(name, undefined);
    expect(cause).toMatchObject({ name: 'PasswordException', code: PasswordResponses.NEED_PASSWORD });
  });

  it.each(WITH_PASSWORD)('%s: con una contraseña errónea pdf.js rechaza con INCORRECT_PASSWORD', async (name) => {
    const cause = await openError(name, 'mal');
    expect(cause).toMatchObject({ name: 'PasswordException', code: PasswordResponses.INCORRECT_PASSWORD });
  });

  it.each(WITH_PASSWORD)('%s: con la contraseña de usuario y con la de propietario abre y tiene texto', async (name) => {
    const expectedText = FIRST_PAGE_TEXT[name];
    for (const password of [USER_PASSWORD, OWNER_PASSWORD]) {
      const text = await withDocument(name, password, (doc) => textOfFirstPage(doc));
      expect(text, `${name} con ${password}`).toContain(expectedText);
    }
  });

  it(`${OWNER_ONLY}: abre sin contraseña y no concede imprimir, copiar ni modificar anotaciones`, async () => {
    const permissions = await withDocument(OWNER_ONLY, undefined, (doc) => doc.getPermissions());
    expect(permissions).not.toBeNull();
    const granted = permissions ?? new Set<number>();
    expect(granted.has(PermissionFlag.PRINT)).toBe(false);
    expect(granted.has(PermissionFlag.COPY)).toBe(false);
    expect(granted.has(PermissionFlag.MODIFY_ANNOTATIONS)).toBe(false);
  });

  it('encrypted-annotated-aes-128.pdf con usuario tiene las mismas anotaciones que annotated.pdf', async () => {
    const expected = await withDocument('annotated.pdf', undefined, annotationSubtypes);
    const actual = await withDocument('encrypted-annotated-aes-128.pdf', USER_PASSWORD, annotationSubtypes);
    expect(expected.flat().length).toBeGreaterThan(0);
    expect(actual).toEqual(expected);
  });

  it('sin qpdf en el PATH el generador falla con la instrucción de instalación', () => {
    expect(generateWithoutPath()).toContain('ERROR Instala qpdf: apt-get install -y qpdf');
  });

});
