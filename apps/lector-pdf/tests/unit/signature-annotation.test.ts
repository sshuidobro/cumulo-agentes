import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { memorySource } from '@suite/platform';
import { UndoStack } from '@suite/shared';
import { deflateSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import {
  EMPTY_EDITS,
  addAnnotationCommand,
  fromDraft,
  isAnnotation,
  resizeSignature,
  toDraft,
  translateAnnotation,
  typeLabelOf,
  type AnnotationEdits,
  type SignatureAnnotation,
  type SignatureArt,
} from '../../src/core/annotations';
import { buildAppearance } from '../../src/core/annotations/appearance';
import { toBase64 } from '../../src/core/base64';
import { openForSave } from '../../src/core/pdf/incremental';
import { decodeStreamData } from '../../src/core/pdf/filters';
import { dictGet, ref, type PdfDict } from '../../src/core/pdf/objects';
import { loadPdf } from '../../src/engine';
import { FIXTURES_DIR } from '../fixtures/paths';
import { nodeAssetBase } from '../helpers/pdfjs-node';
import { qpdfCheck, qpdfObjects, type QpdfObjects } from '../support/qpdf';
import { additionsDiff, saveAnnotations } from '../support/save-annotations';

const T0 = '2026-10-18T10:00:00.000Z';

type ImageArt = Extract<SignatureArt, { readonly kind: 'image' }>;

/** Firma de prueba con geometría fija; `rect` por defecto 200 × 100 pt. */
function signature(
  id: string,
  art: SignatureArt,
  rect: readonly [number, number, number, number] = [100, 100, 300, 200],
): SignatureAnnotation {
  return {
    id,
    type: 'signature',
    pageIndex: 0,
    rect,
    color: [0, 0, 0.6],
    opacity: 1,
    contents: '',
    author: 'Ana',
    modified: T0,
    created: T0,
    origin: { kind: 'new' },
    art,
  };
}

/** Firma dibujada en una caja de 100 × 50: dos trazos. */
const INK_ART: SignatureArt = {
  kind: 'ink',
  paths: [
    [0, 0, 25, 40, 50, 0],
    [60, 20, 100, 20],
  ],
  width: 2,
  box: [100, 50],
};

/**
 * Imagen RGBA de 40 × 20. Con `opaque` todo el alfa es 255; si no, la mitad inferior es semitransparente
 * (hay que escribir `/SMask`).
 */
function rgbaArt(opaque: boolean): ImageArt {
  const width = 40;
  const height = 20;
  const rgba = new Uint8Array(width * height * 4);
  for (let p = 0; p < width * height; p++) {
    const row = Math.floor(p / width);
    rgba[p * 4] = 200;
    rgba[p * 4 + 1] = 30;
    rgba[p * 4 + 2] = 30;
    rgba[p * 4 + 3] = opaque || row < height / 2 ? 255 : (p * 7) % 256;
  }
  return {
    kind: 'image',
    format: 'rgba-deflate',
    data: toBase64(deflateSync(rgba)),
    pixelWidth: width,
    pixelHeight: height,
  };
}

/** JPEG real de 40 × 20 (generado con Pillow, calidad 80; 736 bytes). Sin datos de terceros. */
const JPEG_40X20_BASE64 =
  '/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAYEBQYFBAYGBQYHBwYIChAKCgkJChQODwwQFxQYGBcUFhYaHSUfGhsjHBYWICwgIyYnKSopGR8tMC0oMCUoKSj/2wBDAQcHBwoIChMKChMoGhYaKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCj/wAARCAAUACgDASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwDjrRelbNovSs20XpW1aJ0rza+X+R+n4mZo2idK2bRelZ1ovStm0XpXjV8v8jwMTM0bRelFWLROlFeXPL9djxak/ePIbQDitm0A4oor9RrpH2eJNm0A4rZtAOKKK8eukeBiTZtAOKKKK8uaVzxam5//2Q==';

function jpegArt(): ImageArt {
  return { kind: 'image', format: 'jpeg', data: JPEG_40X20_BASE64, pixelWidth: 40, pixelHeight: 20 };
}

function basic5(): Uint8Array {
  return new Uint8Array(readFileSync(join(FIXTURES_DIR, 'basic-5.pdf')));
}

/** Escribe `bytes` en un directorio temporal nuevo y devuelve la ruta. */
function writeTemp(bytes: Uint8Array, name: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'firma-'));
  const path = join(dir, name);
  writeFileSync(path, bytes);
  return path;
}

/**
 * Diccionario (claves con `/`) de un objeto según `qpdf --json=2`: los flujos van en `stream.dict` y el resto en
 * `value`. `undefined` si el objeto no tiene diccionario.
 */
function objectDict(objects: QpdfObjects, num: number): Record<string, unknown> | undefined {
  const entry = objects[`obj:${num} 0 R`] as { readonly value?: unknown; readonly stream?: { readonly dict?: unknown } } | undefined;
  const value: unknown = entry?.stream?.dict ?? entry?.value;
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

/** Valida con qpdf (código 0 = sin errores ni avisos). */
function expectQpdfClean(bytes: Uint8Array): void {
  const result = qpdfCheck(writeTemp(bytes, 'firma.pdf'));
  expect(result.code, result.output).toBe(0);
}

/** Número de objeto de la imagen y de su SMask cuando se guarda una única firma sobre basic-5.pdf. */
async function reservedNumbers(original: Uint8Array): Promise<{ readonly image: number; readonly smask: number }> {
  const opened = await openForSave(memorySource(original));
  if (!opened.ok) throw new Error(`openForSave: ${opened.error.code}`);
  // Orden de reserva (incremental.ts): anotación, apariencia, imagen y, si hay alfa, SMask.
  const size = opened.value.xref.size;
  return { image: size + 2, smask: size + 3 };
}

describe('modelo de firma · validación', () => {
  it('acepta firmas ink, image rgba-deflate e image jpeg', () => {
    expect(isAnnotation(signature('s1', INK_ART))).toBe(true);
    expect(isAnnotation(signature('s2', rgbaArt(false)))).toBe(true);
    expect(isAnnotation(signature('s3', jpegArt()))).toBe(true);
  });

  it('rechaza art.kind desconocido (svg)', () => {
    const bad = { ...signature('s', INK_ART), art: { kind: 'svg', data: '<svg/>' } };
    expect(isAnnotation(bad)).toBe(false);
  });

  it('rechaza una imagen con pixelWidth 0 o con data vacío', () => {
    expect(isAnnotation(signature('s', { ...rgbaArt(true), pixelWidth: 0 }))).toBe(false);
    expect(isAnnotation(signature('s', { ...jpegArt(), data: '' }))).toBe(false);
  });

  it('rechaza un formato de imagen desconocido y dimensiones no enteras', () => {
    expect(isAnnotation(signature('s', { ...jpegArt(), format: 'png' as 'jpeg' }))).toBe(false);
    expect(isAnnotation(signature('s', { ...jpegArt(), pixelHeight: 2.5 }))).toBe(false);
  });

  it('rechaza una caja con cero o negativo (box: [0, 10])', () => {
    expect(isAnnotation(signature('s', { ...INK_ART, box: [0, 10] }))).toBe(false);
    expect(isAnnotation(signature('s', { ...INK_ART, box: [10, -1] }))).toBe(false);
  });

  it('rechaza una firma ink sin trazos', () => {
    expect(isAnnotation(signature('s', { ...INK_ART, paths: [] }))).toBe(false);
  });
});

describe('modelo de firma · operaciones', () => {
  it('translateAnnotation mueve solo rect; el dibujo queda en coordenadas de la firma', () => {
    const s = signature('s', INK_ART);
    expect(translateAnnotation(s, 10, -5)).toEqual({ ...s, rect: [110, 95, 310, 195] });
  });

  it('resizeSignature cambia solo rect', () => {
    const s = signature('s', rgbaArt(true));
    expect(resizeSignature(s, [50, 50, 350, 150])).toEqual({ ...s, rect: [50, 50, 350, 150] });
  });

  it('un borrador con firmas de los tres tipos hace ida y vuelta', () => {
    const upserts = [signature('s1', INK_ART), signature('s2', rgbaArt(false)), signature('s3', jpegArt())];
    const edits: AnnotationEdits = {
      upserts: new Map(upserts.map((a) => [a.id, a] as const)),
      removed: new Set(),
      fields: new Map(),
    };
    const back = fromDraft(JSON.parse(JSON.stringify(toDraft(edits, 'firma.pdf', T0))));
    expect(back?.upserts).toEqual(edits.upserts);
  });
});

describe('firma en el panel de comentarios', () => {
  it('su tipo se muestra como «Firma»', () => {
    expect(typeLabelOf(signature('s', INK_ART))).toBe('Firma');
  });
});

describe('comandos de firma', () => {
  it('añadir firma tiene la etiqueta «añadir firma» y se deshace y rehace', () => {
    const s = signature('s', INK_ART);
    const cmd = addAnnotationCommand(s);
    expect(cmd.label).toBe('añadir firma');

    const stack = new UndoStack<AnnotationEdits>(EMPTY_EDITS);
    stack.execute(cmd);
    expect(stack.doc.upserts.get('s')).toEqual(s);
    expect(stack.undo()).toBe(true);
    expect(stack.doc.upserts.has('s')).toBe(false);
    expect(stack.redo()).toBe(true);
    expect(stack.doc.upserts.get('s')).toEqual(s);
  });
});

describe('apariencia de firma', () => {
  it('firma ink: escala su caja al rect con cm y dibuja cada trazo', () => {
    const ap = buildAppearance(signature('s', INK_ART));
    const text = new TextDecoder().decode(decodeStreamData(ap.stream));
    // rect 200 × 100 sobre caja 100 × 50: escala 2.
    expect(text).toContain('q 2 0 0 2 100 100 cm');
    expect(text).toContain('1 J 1 j 2 w');
    expect(text.split('\n').filter((line) => line === 'S')).toHaveLength(2);
    expect(dictGet(ap.stream.dict, 'BBox')).toEqual([100, 100, 300, 200]);
  });

  it('firma image: dibuja /Im0 ocupando el rect y declara el XObject con la referencia', () => {
    const imageRef = ref(9);
    const ap = buildAppearance(signature('s', rgbaArt(false)), imageRef);
    const text = new TextDecoder().decode(decodeStreamData(ap.stream));
    expect(text).toContain('q 200 0 0 100 100 100 cm /Im0 Do Q');
    const xobject = dictGet(ap.resources, 'XObject') as PdfDict;
    expect(dictGet(xobject, 'Im0')).toEqual(imageRef);
  });

  it('una firma con imagen sin referencia de XObject es un error de programación', () => {
    expect(() => buildAppearance(signature('s', rgbaArt(true)))).toThrow(Error);
  });
});

describe('escritura de firmas en el PDF', () => {
  it('ink, rgba-deflate y jpeg en basic-5.pdf: pdf.js las ve como Stamp con apariencia, qpdf valida y el incremento pesa < 30 KB', async () => {
    const original = basic5();
    const firmas = [
      signature('ink-1', INK_ART, [72, 600, 222, 650]),
      signature('rgba-1', rgbaArt(false), [72, 500, 152, 530]),
      signature('jpeg-1', jpegArt(), [300, 500, 380, 530]),
    ];
    const { data, out } = await saveAnnotations(original, additionsDiff(firmas));

    expect(out.delta.byteLength).toBeLessThan(30 * 1024);
    expect(out.expectedSize).toBe(data.byteLength);
    expectQpdfClean(data);

    const loaded = await loadPdf(memorySource(data), { assetBaseUrl: nodeAssetBase() });
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    try {
      const anns = await (await loaded.value.doc.getPage(1)).getAnnotations();
      const stamps = anns.filter((a: { subtype: string }) => a.subtype === 'Stamp');
      expect(stamps).toHaveLength(3);
      for (const s of stamps) expect(s.hasAppearance).toBe(true);
      expect(stamps.map((s: { rect: number[] }) => s.rect)).toEqual([
        [72, 600, 222, 650],
        [72, 500, 152, 530],
        [300, 500, 380, 530],
      ]);
    } finally {
      await loaded.value.destroy();
    }
  }, 30_000);

  it('imagen con todo el alfa a 255: sin /SMask, y el número de SMask reservado existe en la xref como null', async () => {
    const original = basic5();
    const { data, out } = await saveAnnotations(original, additionsDiff([signature('op-1', rgbaArt(true), [72, 500, 152, 530])]));
    expect(out.written.size).toBe(1);

    const { image, smask } = await reservedNumbers(original);
    const objects = qpdfObjects(writeTemp(data, 'opaca.pdf'));
    expect(objects[`obj:${smask} 0 R`]).toBeDefined();
    expect(objects[`obj:${smask} 0 R`]?.value).toBeNull();
    // La imagen sigue siendo un flujo sin /SMask.
    const imageDict = objectDict(objects, image);
    expect(imageDict?.['/Subtype']).toBe('/Image');
    expect(imageDict?.['/SMask']).toBeUndefined();
    expectQpdfClean(data);
  });

  it('imagen con alfa: la SMask se escribe como flujo y la imagen la referencia', async () => {
    const original = basic5();
    const { data } = await saveAnnotations(original, additionsDiff([signature('al-1', rgbaArt(false), [72, 500, 152, 530])]));

    const { image, smask } = await reservedNumbers(original);
    const objects = qpdfObjects(writeTemp(data, 'alfa.pdf'));
    // La SMask es un flujo: en el JSON de qpdf aparece con `stream`, no con `value`.
    expect((objects[`obj:${smask} 0 R`] as { readonly stream?: unknown } | undefined)?.stream).toBeDefined();
    expect(objectDict(objects, image)?.['/SMask']).toBe(`${smask} 0 R`);
    expectQpdfClean(data);
  });

  it('firma jpeg: el flujo es /DCTDecode con los bytes tal cual y no reserva SMask', async () => {
    const original = basic5();
    const { data } = await saveAnnotations(original, additionsDiff([signature('j-1', jpegArt(), [72, 500, 152, 530])]));

    const { image } = await reservedNumbers(original);
    const objects = qpdfObjects(writeTemp(data, 'jpeg.pdf'));
    const imageDict = objectDict(objects, image);
    expect(imageDict?.['/Filter']).toBe('/DCTDecode');
    expect(imageDict?.['/Width']).toBe(40);
    expect(imageDict?.['/Height']).toBe(20);
    expectQpdfClean(data);
  });
});
