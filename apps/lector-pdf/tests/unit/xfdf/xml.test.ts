import { describe, expect, it } from 'vitest';
import {
  MAX_XML_CHARS,
  MAX_XML_ELEMENTS,
  child,
  escapeXml,
  parseXml,
  textOf,
  type XmlElement,
} from '../../../src/core/xfdf/xml';

function rootOf(text: string): XmlElement {
  const r = parseXml(text);
  if (!r.ok) throw new Error(`debería ser válido: ${r.error.code}`);
  return r.value;
}

function codeOf(text: string): string {
  const r = parseXml(text);
  return r.ok ? 'ok' : r.error.code;
}

describe('parseXml · formas válidas', () => {
  it('lee elementos, atributos y texto', () => {
    const r = rootOf('<?xml version="1.0"?><a x="1" y=\'dos\'><b>hola</b></a>');
    expect(r.name).toBe('a');
    expect(r.attrs.get('x')).toBe('1');
    expect(r.attrs.get('y')).toBe('dos');
    expect(textOf(r)).toBe('hola');
  });

  it('quita el prefijo de espacio de nombres del nombre del elemento', () => {
    const r = rootOf('<xfdf:xfdf xmlns:xfdf="http://ns.adobe.com/xfdf/"><xfdf:annots/></xfdf:xfdf>');
    expect(r.name).toBe('xfdf');
    expect(child(r, 'annots')?.name).toBe('annots');
  });

  it('acepta CDATA, comentarios y la declaración XML', () => {
    const r = rootOf('<?xml version="1.0"?>\n<!-- aviso -->\n<t><![CDATA[a < b & "c"]]><!-- nada --></t>');
    expect(textOf(r)).toBe('a < b & "c"');
  });

  it('acepta las 5 entidades predefinidas y referencias numéricas decimales y hexadecimales', () => {
    const r = rootOf('<t a="&amp;&lt;&gt;&quot;&apos;">&#233;&#xE9;&amp;lt;</t>');
    expect(r.attrs.get('a')).toBe('&<>"\'');
    expect(textOf(r)).toBe('éé&lt;');
  });

  it('acepta un BOM al principio', () => {
    expect(codeOf('﻿<a/>')).toBe('ok');
  });

  it('acepta un anidamiento de 100 000 niveles sin desbordar la pila', () => {
    const depth = 100_000;
    const text = `${'<a>'.repeat(depth)}x${'</a>'.repeat(depth)}`;
    let result: ReturnType<typeof parseXml> | undefined;
    expect(() => {
      result = parseXml(text);
    }).not.toThrow();
    expect(result?.ok).toBe(true);
    if (result?.ok) expect(textOf(result.value)).toBe('x');
  });

  it('acepta exactamente MAX_XML_ELEMENTS elementos', () => {
    const text = `<r>${'<a/>'.repeat(MAX_XML_ELEMENTS - 1)}</r>`;
    expect(codeOf(text)).toBe('ok');
  });
});

describe('parseXml · rechazos (xfdf-invalid)', () => {
  it('rechaza DOCTYPE con entidades internas', () => {
    expect(codeOf('<!DOCTYPE x [<!ENTITY a "b">]><x>&a;</x>')).toBe('xfdf-invalid');
  });

  it('rechaza cualquier declaración <!ENTITY', () => {
    expect(codeOf('<!ENTITY a "b"><x/>')).toBe('xfdf-invalid');
  });

  it('rechaza entidades desconocidas', () => {
    expect(codeOf('<x>&foo;</x>')).toBe('xfdf-invalid');
    expect(codeOf('<x a="&foo;"/>')).toBe('xfdf-invalid');
  });

  it('rechaza & sin terminar', () => {
    expect(codeOf('<x>a & b</x>')).toBe('xfdf-invalid');
  });

  it('rechaza referencias numéricas no válidas', () => {
    expect(codeOf('<x>&#0;</x>')).toBe('xfdf-invalid');
    expect(codeOf('<x>&#xD800;</x>')).toBe('xfdf-invalid');
    expect(codeOf('<x>&#x110000;</x>')).toBe('xfdf-invalid');
  });

  it('rechaza etiquetas cruzadas', () => {
    expect(codeOf('<a><b></a></b>')).toBe('xfdf-invalid');
  });

  it('rechaza etiquetas sin cerrar', () => {
    expect(codeOf('<a><b>')).toBe('xfdf-invalid');
  });

  it('rechaza cierres sin apertura y varias raíces', () => {
    expect(codeOf('</a>')).toBe('xfdf-invalid');
    expect(codeOf('<a/><b/>')).toBe('xfdf-invalid');
    expect(codeOf('<a/>texto')).toBe('xfdf-invalid');
  });

  it('rechaza documentos vacíos o solo con espacios', () => {
    expect(codeOf('')).toBe('xfdf-invalid');
    expect(codeOf('   \n ')).toBe('xfdf-invalid');
  });

  it('rechaza atributos sin comillas, duplicados o con < dentro del valor', () => {
    expect(codeOf('<a x=1/>')).toBe('xfdf-invalid');
    expect(codeOf('<a x="1" x="2"/>')).toBe('xfdf-invalid');
    expect(codeOf('<a x="<"/>')).toBe('xfdf-invalid');
    expect(codeOf('<a x="1"y="2"/>')).toBe('xfdf-invalid');
  });

  it('rechaza un texto de 20 000 001 caracteres', () => {
    const text = `<a>${'x'.repeat(MAX_XML_CHARS + 1 - 7)}</a>`;
    expect(text.length).toBe(MAX_XML_CHARS + 1);
    expect(codeOf(text)).toBe('xfdf-invalid');
  });

  it('rechaza más de MAX_XML_ELEMENTS elementos', () => {
    const text = `<r>${'<a/>'.repeat(MAX_XML_ELEMENTS)}</r>`;
    expect(codeOf(text)).toBe('xfdf-invalid');
  });

  it('no lanza nunca, ni con entradas basura', () => {
    const basura = ['<', '<<>>', '<a', '<a x="', '<!--', '<![CDATA[', '<?', '</', '&#', '<a>&amp</a>'];
    for (const t of basura) {
      expect(() => parseXml(t)).not.toThrow();
      expect(codeOf(t)).toBe('xfdf-invalid');
    }
  });
});

describe('escapeXml', () => {
  it('escapa & < > " y \' a entidades', () => {
    expect(escapeXml(`a & b < c > "d" 'e'`)).toBe('a &amp; b &lt; c &gt; &quot;d&quot; &apos;e&apos;');
  });

  it('lo que escapa vuelve a leerse igual', () => {
    const original = `Tú & yo <3 "ñ" 'é' ]]>`;
    const r = rootOf(`<t a="${escapeXml(original)}">${escapeXml(original)}</t>`);
    expect(r.attrs.get('a')).toBe(original);
    expect(textOf(r)).toBe(original);
  });
});

describe('textOf y child', () => {
  it('concatena el texto de todos los descendientes en orden', () => {
    const r = rootOf('<a>uno<b>dos<c>tres</c></b>cuatro</a>');
    expect(textOf(r)).toBe('unodostrescuatro');
  });

  it('child devuelve el primer hijo element con ese nombre o undefined', () => {
    const r = rootOf('<a>texto<b n="1"/><b n="2"/></a>');
    expect(child(r, 'b')?.attrs.get('n')).toBe('1');
    expect(child(r, 'z')).toBeUndefined();
  });

  it('textOf de un anidamiento profundo no desborda la pila', () => {
    const depth = 50_000;
    const r = rootOf(`${'<a>'.repeat(depth)}x${'</a>'.repeat(depth)}`);
    expect(textOf(r)).toBe('x');
  });
});
