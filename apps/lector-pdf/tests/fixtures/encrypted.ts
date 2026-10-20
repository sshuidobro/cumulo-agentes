import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { run } from '../support/qpdf.ts';

/**
 * Cifra `input` con `qpdf`. `args` son las opciones de `qpdf` que van antes de los ficheros, terminadas en `--`
 * (p. ej. `['--encrypt', 'usuario', 'propietario', '128', '--']`). Usa un directorio temporal que se borra siempre.
 * Lanza con la instrucción de instalación si no hay `qpdf`, y con su salida de error si falla (código distinto de 0).
 */
export function qpdfEncrypt(input: Uint8Array, args: readonly string[]): Uint8Array {
  const dir = mkdtempSync(join(tmpdir(), 'lector-pdf-enc-'));
  try {
    const source = join(dir, 'base.pdf');
    const target = join(dir, 'encrypted.pdf');
    writeFileSync(source, input);
    const { status, stderr } = run([...args, source, target]);
    if (status !== 0) {
      throw new Error(`qpdf falló con código ${String(status)} al cifrar: ${stderr}`);
    }
    return new Uint8Array(readFileSync(target));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
