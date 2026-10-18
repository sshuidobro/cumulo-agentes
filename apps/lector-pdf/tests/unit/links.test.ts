import { describe, expect, it } from 'vitest';
import { classifyUrl, linkTargetFromAnnotation } from '../../src/core/links';

describe('classifyUrl', () => {
  it.each([
    ['https://a.b', 'web'],
    ['http://a.b/x?y=1', 'web'],
    ['mailto:x@y.z', 'mail'],
  ] as const)('%s es %s', (url, kind) => {
    expect(classifyUrl(url)).toBe(kind);
  });

  it.each([
    'javascript:alert(1)',
    'JAVASCRIPT:x',
    'file:///etc',
    'data:text/html,x',
    'vbscript:x',
    '//a.b',
    'ftp://a.b',
    '',
  ])('bloquea %j', (url) => {
    expect(classifyUrl(url)).toBe('blocked');
  });
});

describe('linkTargetFromAnnotation', () => {
  it('una URL segura es externa', () => {
    expect(linkTargetFromAnnotation({ url: 'https://example.org/ruta?x=1' })).toEqual({
      kind: 'external',
      url: 'https://example.org/ruta?x=1',
    });
  });

  it('una URL no permitida se bloquea como insegura, aunque tenga destino', () => {
    expect(linkTargetFromAnnotation({ url: 'javascript:alert(1)', dest: 'x' })).toEqual({
      kind: 'blocked',
      reason: 'unsafe-url',
    });
  });

  it('unsafeUrl sin url se bloquea como insegura', () => {
    expect(linkTargetFromAnnotation({ unsafeUrl: 'javascript:x' })).toEqual({ kind: 'blocked', reason: 'unsafe-url' });
  });

  it('un destino nombrado o explícito es interno', () => {
    expect(linkTargetFromAnnotation({ dest: 'destino-final' })).toEqual({ kind: 'internal', dest: 'destino-final' });
    const explicit = [{ num: 4, gen: 0 }, { name: 'Fit' }];
    expect(linkTargetFromAnnotation({ dest: explicit })).toEqual({ kind: 'internal', dest: explicit });
  });

  it.each([
    ['NextPage', 'next-page'],
    ['PrevPage', 'prev-page'],
    ['FirstPage', 'first-page'],
    ['LastPage', 'last-page'],
    ['GoBack', 'back'],
    ['GoForward', 'forward'],
  ] as const)('la acción con nombre %s es %s', (name, action) => {
    expect(linkTargetFromAnnotation({ action: name })).toEqual({ kind: 'action', action });
    expect(linkTargetFromAnnotation({ action: { name } })).toEqual({ kind: 'action', action });
  });

  it('cualquier otra cosa (JavaScript, Launch, sin datos) queda bloqueada como no soportada', () => {
    expect(linkTargetFromAnnotation({ action: 'JavaScript' })).toEqual({ kind: 'blocked', reason: 'unsupported' });
    expect(linkTargetFromAnnotation({})).toEqual({ kind: 'blocked', reason: 'unsupported' });
    expect(linkTargetFromAnnotation({ dest: 42 })).toEqual({ kind: 'blocked', reason: 'unsupported' });
  });
});
