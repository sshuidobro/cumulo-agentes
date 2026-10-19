import { describe, expect, it } from 'vitest';
import { RECENT_SHOWN, folderOf, formatRecentDate } from '../../src/core/recent';

/** Fecha local (los tests no dependen de la zona horaria de la máquina). */
const at = (y: number, m: number, d: number, h = 0, min = 0): number => new Date(y, m - 1, d, h, min).getTime();

describe('formatRecentDate', () => {
  const now = at(2026, 10, 19, 15, 0);

  it('muestra la hora de hoy', () => {
    expect(formatRecentDate(at(2026, 10, 19, 10, 42), now)).toBe('hoy, 10:42');
  });

  it('rellena con ceros la hora y los minutos', () => {
    expect(formatRecentDate(at(2026, 10, 19, 7, 5), now)).toBe('hoy, 07:05');
  });

  it('muestra «ayer» el día anterior, a cualquier hora', () => {
    expect(formatRecentDate(at(2026, 10, 18, 23, 59), now)).toBe('ayer');
    expect(formatRecentDate(at(2026, 10, 18, 0, 0), now)).toBe('ayer');
  });

  it('muestra día y mes abreviado de los días anteriores', () => {
    expect(formatRecentDate(at(2026, 10, 12, 9, 0), now)).toBe('12 oct');
    expect(formatRecentDate(at(2026, 1, 3), now)).toBe('3 ene');
  });

  it('añade el año si no es el actual', () => {
    expect(formatRecentDate(at(2025, 12, 31, 12, 0), now)).toBe('31 dic 2025');
  });

  it('trata una fecha futura (reloj desviado) como de hoy', () => {
    expect(formatRecentDate(at(2026, 10, 20, 8, 30), now)).toBe('hoy, 08:30');
  });
});

describe('folderOf', () => {
  it('devuelve la carpeta de una ruta POSIX', () => {
    expect(folderOf('/home/ana/docs/informe.pdf')).toBe('/home/ana/docs');
  });

  it('devuelve la carpeta de una ruta de Windows', () => {
    expect(folderOf('C:\\Users\\Ana\\Documentos\\informe.pdf')).toBe('C:\\Users\\Ana\\Documentos');
  });

  it('un fichero en la raíz de POSIX da «/»', () => {
    expect(folderOf('/informe.pdf')).toBe('/');
  });

  it('un nombre sin carpeta da cadena vacía', () => {
    expect(folderOf('informe.pdf')).toBe('');
  });
});

describe('RECENT_SHOWN', () => {
  it('muestra hasta 10 recientes', () => {
    expect(RECENT_SHOWN).toBe(10);
  });
});
