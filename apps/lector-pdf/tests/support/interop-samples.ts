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
import { inkArtFromStrokes } from '../../src/core/signature/stored';
import { newSignatureAnnotation, signatureRectAt } from '../../src/core/signature/signature';
import { rgbaArt } from '../../src/core/signature/image-art';
import type { Annotation, RectPt } from '../../src/core/annotations/model';
import { additionsDiff, saveAnnotations, SAVE_NOW } from './save-annotations';
import { standardAnnotations } from './standard-annotations';

/** Muestra del formulario relleno (PDF-042): `form-full.pdf` con los valores del criterio 1. */
const FORM_SAMPLE = 'formulario-relleno.pdf';

/** Muestra con firmas: una firma dibujada a mano y una firma de imagen PNG (con transparencia), como `/Stamp`. */
const SIGNED_SAMPLE = 'firmado.pdf';

/** Página de tamaño carta, suficiente para situar las firmas de la muestra (solo acota la colocación). */
const PAGE_BOX: RectPt = [0, 0, 612, 792];
/** Grosor del trazo dibujado, en puntos PDF (como el de la ventana de firma). */
const INK_WIDTH = 2;

/** Nombres de las muestras: conjunto estándar sobre tres documentos de partida distintos, el formulario relleno y la firmada. */
export const SAMPLE_NAMES = ['estandar-basic-5.pdf', 'estandar-annotated.pdf', 'estandar-form.pdf', FORM_SAMPLE, SIGNED_SAMPLE] as const;

const SOURCES: readonly { readonly output: (typeof SAMPLE_NAMES)[number]; readonly input: string }[] = [
  { output: 'estandar-basic-5.pdf', input: 'basic-5.pdf' },
  { output: 'estandar-annotated.pdf', input: 'annotated.pdf' },
  { output: 'estandar-form.pdf', input: 'form.pdf' },
];

/** Firma dibujada (zigzag) y firma de imagen (PNG 40 × 20: mitad roja, mitad transparente) sobre `basic-5.pdf`. */
function signedAdditions(): Annotation[] {
  const strokes = [[0, 0, 40, 20, 80, 0, 120, 20, 160, 0]];
  const ink = inkArtFromStrokes(strokes, INK_WIDTH);
  if (ink === null) throw new Error('trazo de firma vacío');
  const rgba = new Uint8Array(40 * 20 * 4);
  for (let y = 0; y < 10; y++) {
    for (let x = 0; x < 40; x++) {
      const at = (y * 40 + x) * 4;
      rgba.set([200, 30, 30, 255], at);
    }
  }
  const image = rgbaArt(rgba, 40, 20);
  if (image === null) throw new Error('imagen de firma inválida');
  return [
    newSignatureAnnotation({
      id: 'firma-dibujada',
      pageIndex: 0,
      rect: signatureRectAt(ink, [200, 600], PAGE_BOX),
      art: ink,
      author: 'Usuario',
      now: SAVE_NOW,
    }),
    newSignatureAnnotation({
      id: 'firma-imagen',
      pageIndex: 0,
      rect: signatureRectAt(image, [200, 450], PAGE_BOX),
      art: image,
      author: 'Usuario',
      now: SAVE_NOW,
    }),
  ];
}

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
  const basic = new Uint8Array(readFileSync(join(FIXTURES_DIR, 'basic-5.pdf')));
  const signed = await saveAnnotations(basic, additionsDiff(signedAdditions()));
  const signedPath = join(outDir, SIGNED_SAMPLE);
  writeFileSync(signedPath, signed.data);
  paths.push(signedPath);
  return paths;
}
