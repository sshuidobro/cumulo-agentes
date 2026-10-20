import { memorySource } from '@suite/platform';
import { describe, expect, it } from 'vitest';
import { parseContent, serializeContent, type ContentOp } from '../../../src/core/content/content-parser';
import { pageContentBytes } from '../../../src/core/content/interpreter';
import { ObjectReader } from '../../../src/core/pdf/object-reader';
import { bytesString, dict, name, PdfSyntaxError } from '../../../src/core/pdf/objects';
import { PdfBuilder } from '../../fixtures/pdf-builder';
import { bytes, fixtureBytes, openPage } from './helpers';

const FIXTURE_NAMES = ['basic-5.pdf', 'compressed.pdf', 'annotated.pdf'] as const;

/** PDF de una página con contenido `content` en un stream sin comprimir (para la imagen en línea con EI). */
function pageWithRawContent(content: Uint8Array): Uint8Array {
  const b = new PdfBuilder();
  const catalog = b.alloc();
  const pages = b.alloc();
  const page = b.alloc();
  const contents = b.addStream('<< >>', content);
  b.setObject(catalog, `<< /Type /Catalog /Pages ${String(pages)} 0 R >>`);
  b.setObject(pages, `<< /Type /Pages /Kids [${String(page)} 0 R] /Count 1 >>`);
  b.setObject(page, `<< /Type /Page /Parent ${String(pages)} 0 R /MediaBox [0 0 612 792] /Contents ${String(contents)} 0 R >>`);
  return b.build({ root: catalog });
}

describe('parseContent', () => {
  it('separa operandos y operadores en orden', () => {
    const ops = parseContent(bytes('BT /F1 12 Tf 10 20 Td (Hola) Tj ET'));
    expect(ops).toEqual([
      { op: 'BT', operands: [] },
      { op: 'Tf', operands: [name('F1'), 12] },
      { op: 'Td', operands: [10, 20] },
      { op: 'Tj', operands: [bytesString(bytes('Hola'))] },
      { op: 'ET', operands: [] },
    ]);
  });

  it('lee arrays, diccionarios de marcado, booleanos y nulos como operandos', () => {
    const ops = parseContent(bytes('[(A) -500 (B)] TJ /Span << /MCID 0 >> BDC true false null X'));
    expect(ops).toEqual([
      { op: 'TJ', operands: [[bytesString(bytes('A')), -500, bytesString(bytes('B'))]] },
      { op: 'BDC', operands: [name('Span'), dict({ MCID: 0 })] },
      { op: 'X', operands: [true, false, null] },
    ]);
  });

  it('conserva los operadores desconocidos tal cual', () => {
    const ops = parseContent(bytes('0.5 w /GS1 gs unknownOp'));
    expect(ops.map((o) => o.op)).toEqual(['w', 'gs', 'unknownOp']);
    expect(ops[2]?.operands).toEqual([]);
  });

  it('ignora comentarios y blancos de cualquier tipo', () => {
    const ops = parseContent(bytes('% comentario\n1 0 0 1\t0\r0 cm\n'));
    expect(ops).toEqual([{ op: 'cm', operands: [1, 0, 0, 1, 0, 0] }]);
  });

  it('contenido vacío no tiene operaciones', () => {
    expect(parseContent(new Uint8Array(0))).toEqual([]);
  });

  it('rechaza operandos sin operador al final', () => {
    expect(() => parseContent(bytes('1 2'))).toThrow(PdfSyntaxError);
  });

  it('rechaza delimitadores sueltos', () => {
    expect(() => parseContent(bytes('] TJ'))).toThrow(PdfSyntaxError);
  });

  it('rechaza una cadena sin cerrar', () => {
    expect(() => parseContent(bytes('BT (abc Tj ET'))).toThrow(PdfSyntaxError);
  });

  it('lee una imagen en línea sin longitud: el final es el primer EI delimitado', () => {
    const ops = parseContent(bytes('q BI /W 2 /H 1 /BPC 8 /CS /G ID \x41\x42 EI Q'));
    expect(ops.map((o) => o.op)).toEqual(['q', 'BI', 'Q']);
    const inline = ops[1]?.inline;
    expect(inline?.dict).toEqual(dict({ W: 2, H: 1, BPC: 8, CS: name('G') }));
    expect(inline?.data).toEqual(bytes('\x41\x42'));
  });

  it('usa /L para terminar una imagen en línea aunque sus datos contengan EI', () => {
    const data = bytes('A EI B');
    const content = new Uint8Array([...bytes('BI /W 2 /H 1 /L 6 ID '), ...data, ...bytes(' EI\nQ\n')]);
    const ops = parseContent(content);
    expect(ops.map((o) => o.op)).toEqual(['BI', 'Q']);
    expect(ops[0]?.inline?.data).toEqual(data);
  });

  it('si /L no coincide con un EI delimitado, busca el EI', () => {
    const ops = parseContent(bytes('BI /L 99 ID \x01 EI Q'));
    expect(ops[0]?.inline?.data).toEqual(bytes('\x01'));
  });

  it('una imagen en línea que termina en el final del contenido es válida', () => {
    const ops = parseContent(bytes('BI /W 1 ID \x00 EI'));
    expect(ops).toHaveLength(1);
    expect(ops[0]?.inline?.data).toEqual(bytes('\x00'));
  });

  it('rechaza una imagen en línea sin ID', () => {
    expect(() => parseContent(bytes('BI /W 1'))).toThrow(PdfSyntaxError);
  });

  it('rechaza una imagen en línea sin blanco tras ID', () => {
    expect(() => parseContent(bytes('BI /W 1 ID'))).toThrow(PdfSyntaxError);
  });

  it('rechaza una imagen en línea sin EI', () => {
    expect(() => parseContent(bytes('BI /W 1 ID \x00 Q'))).toThrow(PdfSyntaxError);
  });

  it('rechaza una clave de imagen en línea que no es un nombre', () => {
    expect(() => parseContent(bytes('BI 1 2 ID \x00 EI'))).toThrow(PdfSyntaxError);
  });

  it('serializa un operador por línea y el round-trip da las mismas operaciones', () => {
    const ops = parseContent(bytes('BT /F1 12 Tf 10 20 Td [(A) -500 (B)] TJ ET'));
    const out = serializeContent(ops);
    expect(new TextDecoder().decode(out)).toBe('BT\n/F1 12 Tf\n10 20 Td\n[(A) -500 (B)] TJ\nET\n');
    expect(parseContent(out)).toEqual(ops);
  });

  it('serializa imágenes en línea como BI <claves> ID <datos> EI y las vuelve a leer igual', () => {
    const ops = parseContent(bytes('BI /W 2 /H 1 /L 6 ID A EI B EI\n'));
    const out = serializeContent(ops);
    expect(parseContent(out)).toEqual(ops);
    expect(new TextDecoder().decode(out).startsWith('BI /W 2 /H 1 /L 6 ID ')).toBe(true);
  });

  it('serializa una imagen en línea vacía y la vuelve a leer igual', () => {
    const ops = parseContent(bytes('BI /W 1 ID  EI'));
    expect(parseContent(serializeContent(ops))).toEqual(ops);
  });

  it('serializa una operación de BI que no tiene imagen en línea como error de programa', () => {
    const broken: ContentOp[] = [{ op: 'BI', operands: [] }];
    expect(() => serializeContent(broken)).toThrow(RangeError);
  });

  it('las páginas de basic-5, compressed y annotated hacen round-trip de contenido', async () => {
    for (const fixture of FIXTURE_NAMES) {
      const reader = await ObjectReader.open(memorySource(fixtureBytes(fixture)));
      const pages = await reader.pageCount();
      expect(pages).toBeGreaterThan(0);
      for (let index = 0; index < pages; index += 1) {
        const pageRef = await reader.pageRef(index);
        const page = await reader.getDict(pageRef);
        if (page === null) throw new Error(`${fixture}: página ${String(index)} sin diccionario`);
        const ops = parseContent(await pageContentBytes(reader, page));
        expect(parseContent(serializeContent(ops)), `${fixture} página ${String(index + 1)}`).toEqual(ops);
      }
    }
  });

  it('contenido de página con imagen en línea cuyos datos contienen EI (con /L) hace round-trip', async () => {
    const data = bytes('x EI y');
    const content = new Uint8Array([...bytes('q 200 0 0 100 50 600 cm BI /W 3 /H 1 /BPC 8 /CS /G /L 6 ID '), ...data, ...bytes(' EI Q\n')]);
    const { reader, page } = await openPage(pageWithRawContent(content));
    const ops = parseContent(await pageContentBytes(reader, page));
    expect(ops.find((o) => o.op === 'BI')?.inline?.data).toEqual(data);
    expect(parseContent(serializeContent(ops))).toEqual(ops);
  });
});
