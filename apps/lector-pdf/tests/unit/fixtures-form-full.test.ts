import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { getDocument, type PDFDocumentProxy } from 'pdfjs-dist';
import { describe, expect, it } from 'vitest';
import { FIXTURES_DIR } from '../fixtures/paths.ts';

/** Abre un fixture generado con pdf.js y lo cierra al terminar. */
async function withDocument<T>(name: string, callback: (doc: PDFDocumentProxy) => Promise<T>): Promise<T> {
  const task = getDocument({ data: new Uint8Array(readFileSync(join(FIXTURES_DIR, name))), verbosity: 0 });
  try {
    return await callback(await task.promise);
  } finally {
    await task.destroy();
  }
}

describe('form-full.pdf', () => {
  it('p1 tiene 15 widgets y p2 tiene 2; todos llevan apariencia', async () => {
    await withDocument('form-full.pdf', async (doc) => {
      expect(doc.numPages).toBe(2);
      const first = (await (await doc.getPage(1)).getAnnotations()).filter((a) => a.subtype === 'Widget');
      const second = (await (await doc.getPage(2)).getAnnotations()).filter((a) => a.subtype === 'Widget');
      expect(first).toHaveLength(15);
      expect(second).toHaveLength(2);
      for (const widget of [...first, ...second]) {
        expect(widget.hasAppearance).toBe(true);
      }
    });
  });

  it('nombre aparece en ambas páginas con el valor Ana', async () => {
    await withDocument('form-full.pdf', async (doc) => {
      const p1 = (await (await doc.getPage(1)).getAnnotations()).filter((a) => a.fieldName === 'nombre');
      const p2 = (await (await doc.getPage(2)).getAnnotations()).filter((a) => a.fieldName === 'nombre');
      for (const widget of [...p1, ...p2]) {
        expect(widget.fieldType).toBe('Tx');
        expect(widget.fieldValue).toBe('Ana');
      }
      expect(p1).toHaveLength(1);
      expect(p2).toHaveLength(1);
    });
  });

  it('campos de texto: comentarios multilínea, codigo en peine con 6 caracteres, importe alineado a la derecha', async () => {
    await withDocument('form-full.pdf', async (doc) => {
      const annotations = await (await doc.getPage(1)).getAnnotations();
      const byName = (name: string) => annotations.find((a) => a.fieldName === name);
      expect(byName('comentarios')).toMatchObject({ fieldType: 'Tx', fieldValue: '', multiLine: true });
      expect(byName('codigo')).toMatchObject({ fieldType: 'Tx', comb: true, maxLen: 6 });
      expect(byName('importe')).toMatchObject({ fieldType: 'Tx', fieldValue: '12,50', textAlignment: 2 });
      expect(byName('solo_lectura')).toMatchObject({ fieldType: 'Tx', fieldValue: 'No editable', readOnly: true });
      expect(byName('obligatorio')).toMatchObject({
        fieldType: 'Tx',
        required: true,
        alternativeText: 'Campo obligatorio',
      });
      expect(byName('rotado')).toMatchObject({ fieldType: 'Tx', fieldValue: 'Girado' });
    });
  });

  it('acepto es una casilla con estado activado «Si» y valor Off', async () => {
    await withDocument('form-full.pdf', async (doc) => {
      const annotations = await (await doc.getPage(1)).getAnnotations();
      expect(annotations.find((a) => a.fieldName === 'acepto')).toMatchObject({
        fieldType: 'Btn',
        checkBox: true,
        exportValue: 'Si',
        fieldValue: 'Off',
      });
    });
  });

  it('color son tres botones de opción con valores Rojo, Verde y Azul; el valor del grupo es Verde', async () => {
    await withDocument('form-full.pdf', async (doc) => {
      const radios = (await (await doc.getPage(1)).getAnnotations()).filter((a) => a.fieldName === 'color');
      expect(radios).toHaveLength(3);
      expect(radios.map((radio) => radio.buttonValue)).toEqual(['Rojo', 'Verde', 'Azul']);
      for (const radio of radios) {
        expect(radio).toMatchObject({ fieldType: 'Btn', radioButton: true, fieldValue: 'Verde' });
      }
    });
  });

  it('pais es un combo cuya tercera opción agrupa exportación pt y visualización Portugal', async () => {
    await withDocument('form-full.pdf', async (doc) => {
      const annotations = await (await doc.getPage(1)).getAnnotations();
      const pais = annotations.find((a) => a.fieldName === 'pais');
      // pdf.js entrega el valor de un combo como array de un elemento (/V es una cadena).
      expect(pais).toMatchObject({ fieldType: 'Ch', combo: true, fieldValue: ['España'] });
      expect(pais?.options[2]).toEqual({ exportValue: 'pt', displayValue: 'Portugal' });
    });
  });

  it('idiomas es una lista de multiselección con Español e Inglés', async () => {
    await withDocument('form-full.pdf', async (doc) => {
      const annotations = await (await doc.getPage(1)).getAnnotations();
      expect(annotations.find((a) => a.fieldName === 'idiomas')).toMatchObject({
        fieldType: 'Ch',
        multiSelect: true,
        fieldValue: ['Español', 'Inglés'],
      });
    });
  });

  it('persona.apellido hereda el nombre de su padre sin /FT', async () => {
    await withDocument('form-full.pdf', async (doc) => {
      const annotations = await (await doc.getPage(1)).getAnnotations();
      expect(annotations.find((a) => a.fieldName === 'persona.apellido')).toMatchObject({ fieldType: 'Tx' });
    });
  });

  it('firma es un campo /Sig sin firmar y pagina2 está en la segunda página', async () => {
    await withDocument('form-full.pdf', async (doc) => {
      const first = await (await doc.getPage(1)).getAnnotations();
      expect(first.find((a) => a.fieldName === 'firma')).toMatchObject({ fieldType: 'Sig' });
      const second = await (await doc.getPage(2)).getAnnotations();
      expect(second.find((a) => a.fieldName === 'pagina2')).toMatchObject({ fieldType: 'Tx' });
    });
  });
});
