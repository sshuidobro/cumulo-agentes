/**
 * Firma desde un fichero de imagen (PDF-086). Un JPEG de hasta 1 200 px se guarda tal cual; el resto se reduce y se
 * convierte en píxeles RGBA. Un fichero que el navegador no puede decodificar es `invalid-image`.
 */
import { err, ok, type Result, type AppError } from '@suite/shared';
import type { SignatureArt } from '../../core/annotations/model';
import { pdfError } from '../../core/errors';
import { fitWidth, isJpegBytes, jpegArt, keepsJpeg, MAX_SIGNATURE_IMAGE_WIDTH, rgbaArt } from '../../core/signature/image-art';

export async function signatureFromImageFile(file: Blob): Promise<Result<SignatureArt, AppError>> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch (cause) {
    return err(pdfError('invalid-image', cause));
  }
  try {
    if (isJpegBytes(bytes) && keepsJpeg(bitmap.width)) {
      return ok(jpegArt(bytes, bitmap.width, bitmap.height));
    }
    const size = fitWidth(bitmap.width, bitmap.height, MAX_SIGNATURE_IMAGE_WIDTH);
    const canvas = document.createElement('canvas');
    canvas.width = size.width;
    canvas.height = size.height;
    const ctx = canvas.getContext('2d');
    if (ctx === null) return err(pdfError('invalid-image'));
    ctx.drawImage(bitmap, 0, 0, size.width, size.height);
    const pixels = ctx.getImageData(0, 0, size.width, size.height);
    const art = rgbaArt(new Uint8Array(pixels.data.buffer), size.width, size.height);
    return art === null ? err(pdfError('invalid-image')) : ok(art);
  } finally {
    bitmap.close();
  }
}
