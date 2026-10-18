import { describe, expect, it } from 'vitest';
import { UndoStack } from '@suite/shared';
import { EMPTY_EDITS } from '../../src/core/annotations/model';
import { toDraft, fromDraft } from '../../src/core/annotations/draft';
import { setFieldCommand } from '../../src/core/forms/commands';

describe('QA PDF-080: valores de campo en el historial', () => {
  it('varios campos, Unicode, deshacer en orden inverso y rehacer', () => {
    const s = new UndoStack<typeof EMPTY_EDITS>(EMPTY_EDITS);
    s.execute(setFieldCommand('año ñ 😀', { kind: 'text', text: 'Ñandú 😀 שלום' }, 'a'));
    s.execute(setFieldCommand('b', { kind: 'checkbox', checked: true }, 'b'));
    s.execute(setFieldCommand('año ñ 😀', { kind: 'text', text: 'otro' }, 'a'));
    expect(s.doc.fields.size).toBe(2);
    s.undo();
    expect((s.doc.fields.get('año ñ 😀') as { text: string }).text).toBe('Ñandú 😀 שלום');
    s.undo();
    s.undo();
    expect(s.doc.fields.size).toBe(0);
    s.redo();
    s.redo();
    expect(s.doc.fields.size).toBe(2);
  });
  it('borrador v2 con Unicode ida y vuelta y vacío', () => {
    const s = new UndoStack<typeof EMPTY_EDITS>(EMPTY_EDITS);
    s.execute(setFieldCommand('ñ', { kind: 'text', text: '' }, 'x'));
    s.execute(setFieldCommand('z', { kind: 'choice', selected: ['é', '😀'] }, 'z'));
    const back = fromDraft(JSON.parse(JSON.stringify(toDraft(s.doc, 'año 😀.pdf', '2026-10-18T10:00:00.000Z'))));
    expect(back).not.toBeNull();
    expect([...(back?.fields ?? [])]).toEqual([...s.doc.fields]);
  });
  it('rechaza basura', () => {
    expect(fromDraft(null)).toBeNull();
    expect(fromDraft({ version: 2, fileName: 'a', savedAt: '2026-10-18T10:00:00.000Z', upserts: [], removed: [], fields: [['a', { kind: 'x' }]] })).toBeNull();
    expect(fromDraft({ version: 2, fileName: 'a', savedAt: '2026-10-18T10:00:00.000Z', upserts: [], removed: [], fields: 'no' })).toBeNull();
  });
});
