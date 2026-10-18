import { describe, expect, it } from 'vitest';
import { importWidget, mergeFields } from '../../src/core/forms';
import type { RawAnnotation } from '../../src/core/annotations/import';

const base = { subtype: 'Widget', id: '5R', rect: [10, 20, 0, 5], fieldName: 'ñandú 😀', fieldType: 'Tx' };
const imp = (o: Record<string, unknown>) => importWidget({ ...base, ...o } as unknown as RawAnnotation, 3);

describe('QA PDF-079', () => {
  it('rect invertido se normaliza y nombre Unicode se conserva', () => {
    const f = imp({ fieldValue: 'Ünï 😀 ‮abc' });
    expect(f?.name).toBe('ñandú 😀');
    expect(f?.widgets[0]?.rect).toEqual([0, 5, 10, 20]);
    expect(f?.widgets[0]?.pageIndex).toBe(3);
    expect(f?.initial).toEqual({ kind: 'text', text: 'Ünï 😀 ‮abc' });
  });
  it('entradas basura no lanzan', () => {
    for (const bad of [null, undefined, 5, 'x', [], { subtype: 'Widget' }, imp({ rect: [NaN, 0, 1, 1] }), imp({ id: '0R' }), imp({ id: 'abc' })]) {
      expect(() => importWidget(bad as unknown as RawAnnotation, 0)).not.toThrow();
    }
    expect(imp({ rect: [NaN, 0, 1, 1] })).toBeNull();
    expect(imp({ id: '0R' })).toBeNull();
    expect(imp({ annotationFlags: 2 })).toBeNull();
  });
  it('radio Off y casilla sin exportValue', () => {
    expect(imp({ fieldType: 'Btn', radioButton: true, buttonValue: 'A', fieldValue: 'Off' })?.initial).toEqual({ kind: 'radio', selected: null });
    expect(imp({ fieldType: 'Btn', checkBox: true, fieldValue: 'Off' })?.initial).toEqual({ kind: 'checkbox', checked: false });
  });
  it('mergeFields no duplica ni muta y conserva referencia sin novedades', () => {
    const a = imp({});
    if (a === null) throw new Error('widget nulo');
    const m1 = mergeFields(new Map(), [a]);
    const m2 = mergeFields(m1, [a]);
    expect(m2.get(a.name)?.widgets).toHaveLength(1);
    expect(mergeFields(m1, [])).toBe(m1);
    expect(m1.size).toBe(1);
  });
});
