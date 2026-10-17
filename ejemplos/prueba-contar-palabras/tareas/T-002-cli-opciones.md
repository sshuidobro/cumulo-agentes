---
id: T-002
titulo: Añadir CLI con opciones -l -w -c
estado: hecha
depende_de: [T-001]
intentos: 0
---

## Objetivo
Que `python3 contar.py [-l] [-w] [-c] FICHERO` lea el fichero UTF-8 e imprima sus conteos en el formato decidido, con tests en `tests/test_cli.py`.

## Contexto
- Leer: `PLAN.md` (secciones "Decisiones de arquitectura" y "Comando de test"), `contar.py`, `tests/test_count_text.py`.
- Formato de salida: `"<n1> <n2> ... <ruta>"`, un espacio entre campos, orden fijo líneas, palabras, caracteres, ruta tal como se recibió. Sin opciones se muestran los tres.
- Lectura con `open(path, encoding="utf-8", newline="")`.
- Solo librería estándar (`argparse`, `sys`).

## Qué hay que hacer
1. En `contar.py`, añadir `import argparse` e `import sys` arriba y estas funciones (no cambiar `count_text`):
   ```python
   def build_parser() -> argparse.ArgumentParser:
       """Return the argument parser for contar.py."""

   def format_counts(counts: tuple[int, int, int], path: str,
                     show_lines: bool, show_words: bool, show_chars: bool) -> str:
       """Return the output line, e.g. '2 4 20 f.txt'."""

   def main(argv: list[str] | None = None) -> int:
       """Run the CLI. argv excludes the program name. Return the exit code."""
   ```
   - `build_parser`: `argparse.ArgumentParser(prog="contar.py", description="Cuenta líneas, palabras y caracteres de un fichero UTF-8.")` con:
     - `-l`, `--lines`, `action="store_true"`, `help="muestra el número de líneas"`
     - `-w`, `--words`, `action="store_true"`, `help="muestra el número de palabras"`
     - `-c`, `--chars`, `action="store_true"`, `help="muestra el número de caracteres"`
     - posicional `path`, `help="fichero de texto UTF-8"`
   - `format_counts`: construye la lista con los números seleccionados en orden líneas, palabras, caracteres; añade `path`; une con `" "`.
   - `main`: `args = build_parser().parse_args(argv)`; si ninguno de `args.lines`, `args.words`, `args.chars` es `True`, ponerlos los tres a `True`; leer el fichero con `with open(args.path, encoding="utf-8", newline="") as f: text = f.read()`; `print(format_counts(count_text(text), args.path, args.lines, args.words, args.chars))`; `return 0`. No capturar excepciones (eso es T-003).
2. Sustituir el bloque final por:
   ```python
   if __name__ == "__main__":
       sys.exit(main())
   ```
3. Crear `tests/test_cli.py` con una clase `MainTests(unittest.TestCase)`:
   - En `setUp`, crear un `tempfile.TemporaryDirectory()` (limpiarlo con `self.addCleanup(tmp.cleanup)`) y en él `f.txt` escrito con `open(..., "w", encoding="utf-8", newline="")` y contenido `"hola mundo\nañade ñu\n"`. Guardar la ruta en `self.path` (str).
   - Helper `run_main(self, argv) -> tuple[int, str]` que llama a `main(argv)` con `contextlib.redirect_stdout(io.StringIO())` y devuelve `(código, salida)`.
   - Tests (salida esperada sin contar el `"\n"` final de `print`; `P` = `self.path`):
     | método | argv | salida |
     |---|---|---|
     | `test_no_options_shows_all` | `[P]` | `f"2 4 20 {P}"` |
     | `test_lines_only` | `["-l", P]` | `f"2 {P}"` |
     | `test_words_only` | `["-w", P]` | `f"4 {P}"` |
     | `test_chars_only` | `["-c", P]` | `f"20 {P}"` |
     | `test_order_is_fixed` | `["-c", "-l", P]` | `f"2 20 {P}"` |
     | `test_combined_flags` | `["-lw", P]` | `f"2 4 {P}"` |
     | `test_long_options` | `["--words", "--chars", P]` | `f"4 20 {P}"` |
     Todos comprueban además que el código devuelto es `0`.
   - `test_format_counts`: `format_counts((1, 2, 3), "x.txt", True, False, True)` devuelve `"1 3 x.txt"`.
   - `test_script_runs_as_program`: `subprocess.run([sys.executable, "contar.py", "-l", self.path], cwd=<raíz del proyecto>, capture_output=True, text=True, encoding="utf-8")`, donde la raíz es `pathlib.Path(__file__).resolve().parent.parent`; comprobar `returncode == 0` y `stdout == f"2 {self.path}\n"`.

## Criterios de aceptación
- [ ] `python3 -m unittest discover -s tests -v` (desde la raíz) termina en `OK` con 15 tests (6 de T-001 + 9 nuevos).
- [ ] Con `printf 'hola mundo\nañade ñu\n' > f.txt` en la raíz:
  - `python3 contar.py f.txt` imprime `2 4 20 f.txt`
  - `python3 contar.py -l f.txt` imprime `2 f.txt`
  - `python3 contar.py -c -w f.txt` imprime `4 20 f.txt`
  - cada uno sale con código 0. (Borrar `f.txt` después.)
- [ ] `python3 contar.py --help` muestra `usage: contar.py` y las tres opciones; código 0.
- [ ] `python3 contar.py` (sin fichero) sale con código 2 y error de `argparse` en stderr.

## Fuera de alcance
- Capturar errores de fichero inexistente, ilegible o no UTF-8 (T-003).
- Modificar `count_text` o `tests/test_count_text.py`.
- Varios ficheros, stdin, alineación en columnas.

## Registro
<!-- Cada agente añade aquí su entrada al terminar; no borrar las anteriores. -->

### [programador] ronda 1
- Ficheros cambiados: `contar.py`, `tests/test_cli.py` (nuevo), `tareas/T-002-cli-opciones.md`.
- Qué he hecho: añadido `build_parser`, `format_counts` y `main` en `contar.py` con argparse (sin tocar `count_text`) y bloque final `sys.exit(main())`. Creado `tests/test_cli.py` con `MainTests` (9 tests) según la ficha.
- Comandos ejecutados y resultado: `python3 -m unittest discover -s tests -v` → 15 tests OK. Manual: `contar.py f.txt` → `2 4 20 f.txt`; `-l` → `2 f.txt`; `-c -w` → `4 20 f.txt`, todos rc 0; `--help` muestra usage y rc 0; sin fichero → error de argparse y rc 2. `f.txt` temporal borrado.
- Dudas o cosas que no he podido hacer: ninguna.

### [revisor] ronda 1 — APROBADO
Build y tests: 15 tests OK. Comprobados a mano los criterios (salidas, --help rc 0, sin fichero rc 2). Código y tests conforme a la ficha, sin cambios fuera de alcance. Sin problemas.

### [tester] ronda 1 — PASA
| Criterio | Resultado | Evidencia (comando / salida) |
|---|---|---|
| 15 tests OK | OK | `python3 -m unittest discover -s tests -v` → Ran 15 tests, OK |
| Salidas con f.txt, rc 0 | OK | `f.txt` → `2 4 20 f.txt`; `-l` → `2 f.txt`; `-c -w` → `4 20 f.txt`; rc=0 en todos |
| `--help` | OK | muestra `usage: contar.py [-h] [-l] [-w] [-c] path` y las 3 opciones; rc=0 |
| Sin fichero | OK | `contar.py: error: the following arguments are required: path`; rc=2 |

Casos límite: fichero vacío → `0 0 0 e.txt`; CRLF + emoji → `1 3 6 u.txt` (correcto); ruta con espacios y ñ → OK; `-lwc` → tres conteos. Fichero inexistente da traceback (esperado, es T-003).
Tests añadidos: ninguno (cobertura suficiente). Ficheros temporales borrados.
