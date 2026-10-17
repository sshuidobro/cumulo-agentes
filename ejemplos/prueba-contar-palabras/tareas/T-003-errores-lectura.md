---
id: T-003
titulo: Gestionar errores de lectura del fichero
estado: hecha
depende_de: [T-002]
intentos: 0
---

## Objetivo
Que `contar.py` no muestre trazas de Python cuando el fichero no existe, no se puede leer o no es UTF-8 válido: mensaje claro en stderr y código de salida 1.

## Contexto
- Leer: `PLAN.md` (sección "Decisiones de arquitectura", punto "Errores"), `contar.py`, `tests/test_cli.py`.
- Formato decidido: stderr `contar.py: error: <mensaje>: <ruta>`, stdout vacío, `return 1`.

## Qué hay que hacer
1. En `main` de `contar.py`, envolver solo la apertura y lectura del fichero en `try/except`, en este orden:
   | excepción | mensaje exacto en stderr (con `print(..., file=sys.stderr)`) |
   |---|---|
   | `FileNotFoundError` | `f"contar.py: error: no existe el fichero: {args.path}"` |
   | `UnicodeDecodeError` | `f"contar.py: error: el fichero no es UTF-8 válido: {args.path}"` |
   | `OSError` (resto: directorio, permisos...) | `f"contar.py: error: no se puede leer el fichero: {args.path}"` |
   En cada caso `return 1` sin imprimir nada en stdout. No cambiar nada más de `main`.
2. En `tests/test_cli.py` añadir una clase `ErrorTests(unittest.TestCase)` (con su propio `TemporaryDirectory` en `setUp`, igual que `MainTests`) y un helper que llame a `main(argv)` redirigiendo stdout y stderr (`contextlib.redirect_stdout`, `contextlib.redirect_stderr` a `io.StringIO()`) y devuelva `(código, stdout, stderr)`. Tests:
   | método | preparación | esperado |
   |---|---|---|
   | `test_missing_file` | ruta `<tmp>/no_existe.txt` (no crearla) | código `1`, stdout `""`, stderr `"contar.py: error: no existe el fichero: <ruta>\n"` |
   | `test_invalid_utf8` | escribir en binario `b"hola \xff\xfe\n"` en `<tmp>/mal.txt` | código `1`, stdout `""`, stderr `"contar.py: error: el fichero no es UTF-8 válido: <ruta>\n"` |
   | `test_directory` | pasar la ruta del propio directorio temporal | código `1`, stdout `""`, stderr `"contar.py: error: no se puede leer el fichero: <ruta>\n"` |
   | `test_missing_file_as_program` | `subprocess.run([sys.executable, "contar.py", <tmp>/no_existe.txt], cwd=<raíz>, capture_output=True, text=True, encoding="utf-8")` | `returncode == 1`, `stdout == ""`, `"Traceback" not in stderr` |

## Criterios de aceptación
- [ ] `python3 -m unittest discover -s tests -v` (desde la raíz) termina en `OK` con 19 tests.
- [ ] `python3 contar.py no_existe.txt; echo $?` imprime en stderr `contar.py: error: no existe el fichero: no_existe.txt` y luego `1`.
- [ ] `printf 'hola \xff\n' > mal.txt && python3 contar.py mal.txt; echo $?` imprime en stderr `contar.py: error: el fichero no es UTF-8 válido: mal.txt` y luego `1`. (Borrar `mal.txt` después.)
- [ ] `python3 contar.py tests; echo $?` imprime en stderr `contar.py: error: no se puede leer el fichero: tests` y luego `1`.
- [ ] Ninguno de los comandos anteriores muestra `Traceback`.
- [ ] Los 15 tests previos siguen pasando sin modificarlos.

## Fuera de alcance
- Cambiar el formato de salida, las opciones o `count_text`.
- Modificar los tests existentes de `MainTests` o `tests/test_count_text.py`.
- Errores de argumentos (los gestiona `argparse`).

## Registro
<!-- Cada agente añade aquí su entrada al terminar; no borrar las anteriores. -->

### [programador] ronda 1
- Ficheros cambiados: `contar.py`, `tests/test_cli.py`, `tareas/T-003-errores-lectura.md`.
- Qué he hecho: en `main` he envuelto apertura y lectura en `try/except` (FileNotFoundError, UnicodeDecodeError, OSError, en ese orden) con los mensajes exactos y `return 1`. En `tests/test_cli.py` he añadido `ErrorTests` con helper `run_main` que devuelve `(código, stdout, stderr)` y los 4 tests de la tabla.
- Comandos ejecutados y resultado: `python3 -m unittest discover -s tests -v` → 19 tests, OK. `python3 contar.py no_existe.txt` → mensaje correcto en stderr, salida 1. Fichero `mal.txt` con byte `\xff` → mensaje UTF-8, salida 1 (fichero borrado después). `python3 contar.py tests` → mensaje de lectura, salida 1. Ninguno muestra `Traceback`.
- Dudas o cosas que no he podido hacer: ninguna.

### [revisor] ronda 1 — APROBADO
Tests: 19 OK. Comprobados a mano los tres casos de error (mensaje exacto, código 1, sin Traceback). Cambios dentro de alcance, tests previos intactos. Sin problemas.

### [tester] ronda 1 — PASA
| Criterio | Resultado | Evidencia |
|---|---|---|
| 19 tests OK | OK | `python3 -m unittest discover -s tests` -> Ran 19 tests, OK |
| Fichero inexistente | OK | stderr `contar.py: error: no existe el fichero: no_existe.txt`, exit 1 |
| No UTF-8 | OK | stderr `...no es UTF-8 válido: mal.txt`, exit 1 (borrado después) |
| Directorio | OK | stderr `...no se puede leer el fichero: tests`, exit 1 |
| Sin Traceback | OK | ninguna salida lo contiene |
| 15 tests previos intactos | OK | `git diff HEAD~1 -- tests/test_cli.py` sin líneas eliminadas |

Casos límite: ruta con espacios, ñ y emoji (OK, cuenta 1 2 5); inexistente con tilde (mensaje correcto); fichero vacío (0 0 0); /dev/null (0 0 0); ruta vacía "" (error "no existe", exit 1). Permisos 000 no probable: se ejecuta como root, que los ignora.
Tests añadidos: ninguno (cobertura suficiente).
