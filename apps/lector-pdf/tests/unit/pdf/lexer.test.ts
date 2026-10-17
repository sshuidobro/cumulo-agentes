import { describe, expect, it } from 'vitest';
import { PdfLexer, type Token } from '../../../src/core/pdf/lexer';
import { PdfSyntaxError } from '../../../src/core/pdf/objects';
import { bytes, latin1, raw } from './helpers';

function tokensOf(text: string): Token[] {
  const lex = new PdfLexer(bytes(text));
  const out: Token[] = [];
  for (;;) {
    const t = lex.next();
    if (t.kind === 'eof') return out;
    out.push(t);
  }
}

describe('PdfLexer · tokens', () => {
  it('reconoce números enteros y reales, con signo y sin cero inicial', () => {
    const toks = tokensOf('12 -3 +4 0.5 -.5 .5 5.');
    expect(toks.map((t) => (t.kind === 'number' ? [t.value, t.integer] : t.kind))).toEqual([
      [12, true], [-3, true], [4, true], [0.5, false], [-0.5, false], [0.5, false], [5, false],
    ]);
  });

  it('trata los signos sueltos y las mezclas inválidas como palabras clave', () => {
    const toks = tokensOf('- 1.2.3 --5');
    expect(toks.map((t) => (t.kind === 'keyword' ? t.value : t.kind))).toEqual(['-', '1.2.3', '--5']);
  });

  it('separa nombres, palabras clave y delimitadores', () => {
    const toks = tokensOf('/Type/Page<<>>[]R true null obj');
    expect(toks.map((t) => (t.kind === 'name' || t.kind === 'keyword' ? `${t.kind}:${t.value}` : t.kind))).toEqual([
      'name:Type', 'name:Page', '<<', '>>', '[', ']', 'keyword:R', 'keyword:true', 'keyword:null', 'keyword:obj',
    ]);
  });

  it('decodifica #XX en los nombres y conserva el # si no va seguido de dos hex', () => {
    const [name, bad] = tokensOf('/N#20a /A#zz');
    expect(name).toMatchObject({ kind: 'name', value: 'N a' });
    expect(bad).toMatchObject({ kind: 'name', value: 'A#zz' });
  });

  it('decodifica nombres UTF-8', () => {
    const [t] = tokensOf('/Ni#C3#B1o');
    expect(t).toMatchObject({ kind: 'name', value: 'Niño' });
  });

  it('ignora blancos (incluidos NUL y FF) y comentarios', () => {
    const toks = tokensOf('\0\t 1 % comentario\r\n\f2%fin');
    expect(toks.map((t) => (t.kind === 'number' ? t.value : t.kind))).toEqual([1, 2]);
  });

  it('lee cadenas hexadecimales: ignora blancos y rellena el último dígito impar con 0', () => {
    const [a, b] = tokensOf('<4E 6f\n> <ABC>');
    expect(a).toMatchObject({ kind: 'string', hex: true });
    expect(a && a.kind === 'string' ? latin1(a.bytes) : '').toBe('No');
    expect(b && b.kind === 'string' ? Array.from(b.bytes) : []).toEqual([0xab, 0xc0]);
  });

  it('lee cadenas literales con escapes, paréntesis anidados y continuaciones de línea', () => {
    const [t] = tokensOf('(a\\nb\\\\c\\051\\\r\nd(e)f)');
    expect(t && t.kind === 'string' ? Array.from(t.bytes) : []).toEqual(
      Array.from(bytes('a\nb\\c)d(e)f')),
    );
  });

  it('convierte fin de línea sin escapar en LF (CRLF cuenta una vez) y escapes desconocidos', () => {
    const [t] = tokensOf('(x\r\ny\rz\\q\\\r\n)');
    expect(t && t.kind === 'string' ? latin1(t.bytes) : '').toBe('x\ny\nzq');
  });

  it('lee escapes octales de 1 a 3 dígitos y los reduce a un byte', () => {
    const [t] = tokensOf('(\\7\\101\\4000)');
    expect(t && t.kind === 'string' ? Array.from(t.bytes) : []).toEqual([7, 65, 0, 48]);
  });

  it('lee stream y endstream como palabras clave', () => {
    const toks = tokensOf('stream\nendstream');
    expect(toks.map((t) => (t.kind === 'keyword' ? t.value : t.kind))).toEqual(['stream', 'endstream']);
  });

  it('informa de los offsets de inicio y fin de cada token', () => {
    const toks = tokensOf('  /A 12');
    expect(toks.map((t) => [t.start, t.end])).toEqual([[2, 4], [5, 7]]);
  });

  it('devuelve eof repetidamente y expone la posición', () => {
    const lex = new PdfLexer(bytes('1 '));
    expect(lex.next().kind).toBe('number');
    expect(lex.offset).toBe(1);
    expect(lex.next().kind).toBe('eof');
    expect(lex.next().kind).toBe('eof');
  });

  it('parte de un offset dado', () => {
    const lex = new PdfLexer(bytes('1 2'), 2);
    expect(lex.next()).toMatchObject({ kind: 'number', value: 2 });
  });

  it('lee bytes binarios dentro de cadenas literales sin alterarlos', () => {
    const data = raw([0x28, 0x00, 0xff, 0x29]);
    const lex = new PdfLexer(data);
    expect(lex.next()).toMatchObject({ kind: 'string', hex: false });
    const again = new PdfLexer(data).next();
    expect(again.kind === 'string' ? Array.from(again.bytes) : []).toEqual([0x00, 0xff]);
  });
});

describe('PdfLexer · errores', () => {
  it.each([
    ['> suelto', '>'],
    ['paréntesis de cierre suelto', ' )'],
    ['llave suelta', '{'],
    ['cadena literal sin cerrar', '(abc'],
    ['cadena literal sin cerrar tras escape', '(abc\\'],
    ['cadena hexadecimal sin cerrar', '<4E6F'],
    ['dígito hexadecimal no válido', '<4G>'],
  ])('lanza PdfSyntaxError con offset: %s', (_label, text) => {
    expect(() => tokensOf(text)).toThrow(PdfSyntaxError);
  });

  it('el error indica el offset del problema', () => {
    try {
      tokensOf('12 )');
      expect.unreachable('debía lanzar');
    } catch (e) {
      expect(e).toBeInstanceOf(PdfSyntaxError);
      expect(e instanceof PdfSyntaxError ? e.offset : -1).toBe(3);
    }
  });
});
