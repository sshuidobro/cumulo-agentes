---
id: T-001
titulo: Crear esqueleto y función count_text
estado: hecha
depende_de: []
intentos: 0
---

## Objetivo
Que exista `contar.py` con la función pura `count_text` y sus tests en `tests/test_count_text.py`, y que el comando de test del proyecto pase.

## Contexto
- Leer: `PLAN.md` (secciones "Decisiones de arquitectura", "Estructura" y "Comando de test").
- Solo librería estándar. Python 3.
- Semántica decidida: líneas = `text.count("\n")`, palabras = `len(text.split())`, caracteres = `len(text)`.

## Qué hay que hacer
1. Crear `contar.py` en la raíz con:
   - Docstring de módulo de una línea: `"""Count lines, words and characters of a UTF-8 text file, like wc."""`
   - La función:
     ```python
     def count_text(text: str) -> tuple[int, int, int]:
         """Return (lines, words, chars) for text."""
     ```
     que devuelve `(text.count("\n"), len(text.split()), len(text))`.
   - Al final:
     ```python
     if __name__ == "__main__":
         pass
     ```
     (T-002 lo sustituirá por la CLI; no implementar nada más.)
2. Crear la carpeta `tests/` (sin `__init__.py`) y `tests/test_count_text.py` con una clase `CountTextTests(unittest.TestCase)` que importe `from contar import count_text` y tenga estos tests, uno por caso:
   | método | entrada | resultado esperado |
   |---|---|---|
   | `test_empty` | `""` | `(0, 0, 0)` |
   | `test_two_lines` | `"hola mundo\nadiós\n"` | `(2, 3, 17)` |
   | `test_no_trailing_newline` | `"a b"` | `(0, 2, 3)` |
   | `test_multiple_spaces_and_tabs` | `"  uno\t\tdos  \n"` | `(1, 2, 13)` |
   | `test_non_ascii_counts_code_points` | `"ñandú\n"` | `(1, 1, 6)` |
   | `test_crlf_keeps_carriage_return` | `"a\r\nb\r\n"` | `(2, 2, 6)` |
3. Ejecutar el comando de test desde la raíz y confirmar que pasa.

## Criterios de aceptación
- [ ] `python3 -m unittest discover -s tests -v` (desde la raíz) ejecuta 6 tests y termina con `OK`.
- [ ] `python3 -c "from contar import count_text; print(count_text('hola mundo\nadiós\n'))"` imprime `(2, 3, 17)`.
- [ ] `python3 contar.py` no imprime nada y sale con código 0.
- [ ] `contar.py` no importa nada fuera de la librería estándar.

## Fuera de alcance
- Argumentos de línea de comandos, lectura de ficheros, mensajes de error (T-002 y T-003).
- Crear `tests/__init__.py`, `setup.py`, `pyproject.toml` o cualquier otro fichero no listado.

## Registro
<!-- Cada agente añade aquí su entrada al terminar; no borrar las anteriores. -->

### [programador] ronda 1
- Ficheros cambiados: `contar.py` (nuevo), `tests/test_count_text.py` (nuevo), `tareas/T-001-esqueleto-count-text.md` (estado y registro).
- Qué he hecho: creado `contar.py` con `count_text` (semántica de PLAN.md) y el bloque `if __name__ == "__main__": pass`. Creado `tests/test_count_text.py` con la clase `CountTextTests` y los 6 casos de la tabla.
- Comandos ejecutados y resultado: `python3 -m unittest discover -s tests -v` → 6 tests, OK. `python3 -c "...count_text('hola mundo\nadiós\n')"` → `(2, 3, 17)`. `python3 contar.py` → sin salida, código 0. `contar.py` solo usa código sin imports.
- Dudas o cosas que no he podido hacer: `PLAN.md` y `tareas/` están sin seguir en git (untracked); no los he incluido en el commit, solo los ficheros de esta tarea.

### [revisor] ronda 1 — APROBADO
Build/tests: 6 tests OK; `count_text` imprime (2, 3, 17); `python3 contar.py` sin salida y código 0; sin imports. Sin cambios fuera de alcance. Sin problemas.

### [tester] ronda 1 — PASA
| Criterio | Resultado | Evidencia |
|---|---|---|
| 6 tests y OK | Pasa | `python3 -m unittest discover -s tests -v` → Ran 6 tests, OK |
| Imprime `(2, 3, 17)` | Pasa | salida `(2, 3, 17)` |
| `python3 contar.py` sin salida, código 0 | Pasa | sin salida, rc=0 |
| Solo librería estándar | Pasa | `contar.py` no tiene imports |

Casos límite (manuales): emoji `'😀 a\n'` → (1,2,4); `'\n\n\n'` → (3,0,3); 1 millón de caracteres → 1000000; espacios Unicode (nbsp, em space) separan palabras → (0,3,5). Sin regresiones ni fallos.
Tests añadidos: ninguno (los 6 cubren los casos de la ficha).
