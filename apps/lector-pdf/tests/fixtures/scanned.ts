import { createCanvas } from '@napi-rs/canvas';
import { buildPageTree, PdfBuilder } from './pdf-builder.ts';

/** Escaneado simulado en español (PDF-133): 3 páginas A4, cada una una sola imagen JPEG, sin capa de texto. */
export const SCANNED_PAGE_LINES: readonly (readonly string[])[] = [
  ['FACTURA NÚMERO 2026-0042', 'Cliente: Panadería Muñoz', 'Importe total: 1.234,56 euros.'],
  ['CONTRATO DE ARRENDAMIENTO', 'El arrendatario se compromete', 'a pagar la renta mensual.'],
  ['INFORME TÉCNICO', 'Revisión de la instalación eléctrica', 'Conclusión: apta.'],
];

/** Píxeles de la imagen de página (200 ppp sobre A4). */
export const SCANNED_WIDTH = 1654;
export const SCANNED_HEIGHT = 2339;
const A4_WIDTH_PT = 595.28;
const A4_HEIGHT_PT = 841.89;
const LINE_HEIGHT_PX = 120;
const FIRST_LINE_Y_PX = 400;
const LEFT_PX = 200;

/** JPEG de la página `page` (1-based): fondo blanco y texto negro sans-serif de 40 px. */
export function scannedPageJpeg(page: number): Uint8Array<ArrayBuffer> {
  const lines = SCANNED_PAGE_LINES[page - 1];
  if (lines === undefined) throw new Error(`El escaneado de prueba no tiene la página ${page}`);
  const canvas = createCanvas(SCANNED_WIDTH, SCANNED_HEIGHT);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, SCANNED_WIDTH, SCANNED_HEIGHT);
  ctx.fillStyle = '#000000';
  ctx.font = '40px sans-serif';
  ctx.textBaseline = 'alphabetic';
  lines.forEach((line, i) => ctx.fillText(line, LEFT_PX, FIRST_LINE_Y_PX + i * LINE_HEIGHT_PX));
  const encoded = canvas.encodeSync('jpeg', 90);
  const bytes = new Uint8Array(encoded.byteLength);
  bytes.set(encoded);
  return bytes;
}

/** PDF escaneado de 3 páginas: cada página dibuja su JPEG a tamaño completo. */
export function buildScannedDocument(): Uint8Array {
  const b = new PdfBuilder();
  const catalog = b.alloc();
  const tree = buildPageTree(b, SCANNED_PAGE_LINES.length);
  SCANNED_PAGE_LINES.forEach((_, index) => {
    const pageNumber = index + 1;
    const image = b.addStream(
      `<< /Type /XObject /Subtype /Image /Width ${SCANNED_WIDTH} /Height ${SCANNED_HEIGHT} ` +
        '/ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode >>',
      scannedPageJpeg(pageNumber),
    );
    const content = b.addStream('<< >>', `q ${A4_WIDTH_PT} 0 0 ${A4_HEIGHT_PT} 0 0 cm /Im1 Do Q`);
    const resources = b.addObject(`<< /XObject << /Im1 ${image} 0 R >> >>`);
    const pageRef = tree.pageRefs[index];
    if (pageRef === undefined) throw new Error(`Falta la referencia de la página ${pageNumber}`);
    b.setObject(
      pageRef,
      `<< /Type /Page /Parent ${tree.parentOf(index)} 0 R /MediaBox [0 0 ${A4_WIDTH_PT} ${A4_HEIGHT_PT}] ` +
        `/Contents ${content} 0 R /Resources ${resources} 0 R >>`,
    );
  });
  b.setObject(catalog, `<< /Type /Catalog /Pages ${tree.root} 0 R >>`);
  return b.build({ root: catalog });
}
