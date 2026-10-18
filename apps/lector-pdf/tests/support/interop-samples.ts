/**
 * Muestras para comprobar a mano en Adobe Acrobat Reader (PDF-029, lista de comprobación del Manual).
 * `pnpm --filter lector-pdf interop:samples` escribe cuatro ficheros en `apps/lector-pdf/interop-samples/`,
 * que no se versionan. Las anotaciones son las del conjunto estándar, con fechas fijas; el formulario relleno
 * lleva los valores del criterio 1 de PDF-042 (sin anotaciones).
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { FIXTURES_DIR } from '../fixtures/paths';
import { changesFor, FORM_FULL_VALUES, readFormFields, saveFormChanges } from './form-fields';
import { additionsDiff, saveAnnotations } from './save-annotations';
import { standardAnnotations } from './standard-annotations';

/** Muestra del formulario relleno (PDF-042): `form-full.pdf` con los valores del criterio 1. */
const FORM_SAMPLE = 'formulario-relleno.pdf';

/** Nombres de las muestras: conjunto estándar sobre tres documentos de partida distintos, y el formulario relleno. */
export const SAMPLE_NAMES = ['estandar-basic-5.pdf', 'estandar-annotated.pdf', 'estandar-form.pdf', FORM_SAMPLE] as const;

const SOURCES: readonly { readonly output: (typeof SAMPLE_NAMES)[number]; readonly input: string }[] = [
  { output: 'estandar-basic-5.pdf', input: 'basic-5.pdf' },
  { output: 'estandar-annotated.pdf', input: 'annotated.pdf' },
  { output: 'estandar-form.pdf', input: 'form.pdf' },
];

/** Escribe las muestras en `outDir` (se crea si no existe) y devuelve sus rutas absolutas. */
export async function writeInteropSamples(outDir: string): Promise<string[]> {
  mkdirSync(outDir, { recursive: true });
  const paths: string[] = [];
  for (const { output, input } of SOURCES) {
    const original = new Uint8Array(readFileSync(join(FIXTURES_DIR, input)));
    const { data } = await saveAnnotations(original, additionsDiff(standardAnnotations(0)));
    const path = join(outDir, output);
    writeFileSync(path, data);
    paths.push(path);
  }
  const formOriginal = new Uint8Array(readFileSync(join(FIXTURES_DIR, 'form-full.pdf')));
  const fields = await readFormFields(formOriginal);
  const { data } = await saveFormChanges(formOriginal, changesFor(fields, FORM_FULL_VALUES));
  const formPath = join(outDir, FORM_SAMPLE);
  writeFileSync(formPath, data);
  paths.push(formPath);
  return paths;
}
