import { describe, expect, it } from 'vitest';
import { toAcceptAttribute, toAcceptTypes } from '../../src/web/mime';

describe('toAcceptTypes', () => {
  it('crea un tipo por filtro con MIME y extensiones con punto', () => {
    expect(toAcceptTypes([{ name: 'Documentos', extensions: ['docx', 'odt'] }])).toEqual([
      {
        description: 'Documentos',
        accept: {
          'application/vnd.openxmlformats-officedocument.wordprocessingml.document': ['.docx'],
          'application/vnd.oasis.opendocument.text': ['.odt'],
        },
      },
    ]);
  });

  it('una extensión desconocida usa application/octet-stream', () => {
    expect(toAcceptTypes([{ name: 'Otros', extensions: ['xyz'] }])[0]?.accept).toEqual({
      'application/octet-stream': ['.xyz'],
    });
  });

  it('acepta extensiones con punto y en mayúsculas', () => {
    expect(toAcceptTypes([{ name: 'PDF', extensions: ['.PDF'] }])[0]?.accept).toEqual({
      'application/pdf': ['.pdf'],
    });
  });

  it('omite filtros sin extensiones', () => {
    expect(toAcceptTypes([{ name: 'Vacío', extensions: [] }])).toEqual([]);
  });
});

describe('toAcceptAttribute', () => {
  it('une extensiones y MIME sin repetir', () => {
    expect(toAcceptAttribute([{ name: 'PDF', extensions: ['pdf'] }])).toBe('.pdf,application/pdf');
    expect(toAcceptAttribute([{ name: 'PDF', extensions: ['pdf', 'pdf'] }])).toBe('.pdf,application/pdf');
  });

  it('une varios filtros', () => {
    expect(toAcceptAttribute([
      { name: 'PDF', extensions: ['pdf'] },
      { name: 'Hoja', extensions: ['csv'] },
    ])).toBe('.pdf,application/pdf,.csv,text/csv');
  });

  it('una extensión sin MIME conocido solo aporta el punto', () => {
    expect(toAcceptAttribute([{ name: 'X', extensions: ['xyz'] }])).toBe('.xyz');
  });
});
