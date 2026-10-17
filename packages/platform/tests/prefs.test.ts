import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { configureLogging, createLogger } from '@suite/shared';
import type { LogLevel, LogSink } from '@suite/shared';
import { createStorageStore } from '../src/index';

interface N { readonly n: number }
function isN(v: unknown): v is N {
  return typeof v === 'object' && v !== null && typeof (v as { n?: unknown }).n === 'number';
}

// Sink falso que recoge los avisos del logger común.
function captureLogs(): { level: LogLevel; scope: string; message: string }[] {
  const calls: { level: LogLevel; scope: string; message: string }[] = [];
  const sink: LogSink = (level, scope, message) => { calls.push({ level, scope, message }); };
  configureLogging({ sink, minLevel: 'debug' });
  return calls;
}

describe('createStorageStore', () => {
  let logs: { level: LogLevel; scope: string; message: string }[];

  beforeEach(() => {
    localStorage.clear();
    logs = captureLogs();
  });

  afterEach(() => {
    configureLogging({ sink: null });
    localStorage.clear();
  });

  it('guarda y recupera un valor con guard', () => {
    const prefs = createStorageStore(localStorage, 'app.');
    prefs.set('a', { n: 1 });
    expect(prefs.get('a', isN)).toEqual({ n: 1 });
  });

  it('usa como clave real prefijo más clave en localStorage', () => {
    const prefs = createStorageStore(localStorage, 'app.');
    prefs.set('a', { n: 1 });
    expect(localStorage.getItem('app.a')).toBe('{"n":1}');
    expect(localStorage.getItem('a')).toBeNull();
  });

  it('remove borra la clave', () => {
    const prefs = createStorageStore(localStorage, 'app.');
    prefs.set('a', { n: 1 });
    prefs.remove('a');
    expect(localStorage.getItem('app.a')).toBeNull();
    expect(prefs.get('a', isN)).toBeNull();
  });

  it('JSON roto devuelve null y borra la clave', () => {
    localStorage.setItem('app.a', '{no es json');
    const prefs = createStorageStore(localStorage, 'app.');
    expect(prefs.get('a', isN)).toBeNull();
    expect(localStorage.getItem('app.a')).toBeNull();
  });

  it('si guard es falso devuelve null y borra la clave', () => {
    localStorage.setItem('app.a', '{"x":1}');
    const prefs = createStorageStore(localStorage, 'app.');
    expect(prefs.get('a', isN)).toBeNull();
    expect(localStorage.getItem('app.a')).toBeNull();
  });

  it('una clave inexistente devuelve null sin tocar el almacén', () => {
    const prefs = createStorageStore(localStorage, 'app.');
    expect(prefs.get('nada', isN)).toBeNull();
  });

  it('si setItem lanza (cuota), no propaga y avisa por el logger', () => {
    const full: Storage = {
      length: 0,
      clear: () => undefined,
      key: () => null,
      getItem: () => null,
      removeItem: () => undefined,
      setItem: () => { throw new DOMException('cuota llena', 'QuotaExceededError'); },
    };
    const prefs = createStorageStore(full, 'app.');
    expect(() => { prefs.set('a', { n: 1 }); }).not.toThrow();
    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatchObject({ level: 'warn', scope: 'platform' });
    expect(logs[0]?.message).toContain('a');
  });

  it('con storage null funciona en memoria', () => {
    const prefs = createStorageStore(null, 'x.');
    expect(prefs.get('a', isN)).toBeNull();
    prefs.set('a', { n: 7 });
    expect(prefs.get('a', isN)).toEqual({ n: 7 });
    prefs.remove('a');
    expect(prefs.get('a', isN)).toBeNull();
    expect(localStorage.length).toBe(0);
  });

  it('el logger de prueba recibe avisos con el scope de la plataforma', () => {
    createLogger('platform').warn('prueba');
    expect(logs.at(-1)).toEqual({ level: 'warn', scope: 'platform', message: 'prueba' });
  });
});
