import { describe, expect, it } from 'vitest';
import { buildFieldAppearance, type FieldValue, type FormField, type FormWidget } from '../../src/core/forms';
import { decodeStreamData } from '../../src/core/pdf/filters';

const field = (o: Partial<FormField> = {}): FormField => ({
  name: 'c', type: 'text', readOnly: false, required: false, multiline: false, password: false,
  comb: false, maxLen: 0, multiSelect: false, editable: false, options: [], align: 0, fontSize: 0,
  textColor: [0, 0, 0], tooltip: '', initial: { kind: 'text', text: '' }, widgets: [], ...o,
});
const widget = (o: Partial<FormWidget> = {}): FormWidget => ({
  id: '1R', ref: { num: 1, gen: 0 }, pageIndex: 0, rect: [0, 0, 100, 20], onState: null,
  rotation: 0, background: null, border: null, ...o,
});
const text = (t: string): FieldValue => ({ kind: 'text', text: t });
function content(f: FormField, w: FormWidget, v: FieldValue): string {
  const s = buildFieldAppearance(f, w, v);
  if (s === null) throw new Error('null');
  return new TextDecoder('latin1').decode(decodeStreamData(s));
}

describe('apariencias · casos límite (QA)', () => {
  const cases: [string, string][] = [
    ['emoji', 'Hola 😀 mundo'],
    ['RTL', 'שלום עולם مرحبا'],
    ['paréntesis y barra', 'a(b)c\\d)'],
    ['enorme', 'x'.repeat(200000)],
    ['saltos', 'a\r\nb\nc\rd'],
  ];
  for (const [n, t] of cases) {
    for (const o of [{}, { multiline: true }, { comb: true, maxLen: 5 }, { password: true }]) {
      it(`${n} ${JSON.stringify(o)}: sin NaN/Infinity ni excepción`, () => {
        const c = content(field(o), widget(), text(t));
        expect(c).not.toMatch(/NaN|Infinity|undefined/);
      });
    }
  }
  it('caja diminuta no genera NaN', () => {
    for (const rect of [[0, 0, 3, 3], [0, 0, 0, 0], [10, 10, 10, 30]] as const) {
      const c = content(field(), widget({ rect: [...rect] }), text('Hola'));
      expect(c).not.toMatch(/NaN|Infinity/);
    }
  });
  it('rect invertido (x2<x1) no produce BBox negativo', () => {
    const c = buildFieldAppearance(field(), widget({ rect: [100, 20, 0, 0] }), text('a'));
    expect(c).not.toBeNull();
  });
  it('paréntesis y barra escapados', () => {
    expect(content(field(), widget(), text('a(b)\\'))).toContain('(a\\(b\\)\\\\) Tj');
  });
  it('valor de tipo equivocado en texto/lista no revienta', () => {
    expect(() => content(field(), widget(), { kind: 'choice', selected: ['a'] })).not.toThrow();
    expect(() => content(field({ type: 'list' }), widget(), text('x'))).not.toThrow();
  });
  it('contraseña con emoji enmascara por carácter Unicode', () => {
    expect(content(field({ password: true }), widget(), text('😀😀'))).toContain('(**) Tj');
  });
});
