# PLAN: contar.py (un `wc` mínimo en Python)

## Objetivo
Herramienta de línea de comandos `contar.py` que cuenta líneas, palabras y caracteres de un fichero de texto UTF-8, como `wc`, con las opciones `-l`, `-w` y `-c`. Es una prueba pequeña del equipo de agentes (máximo 3 tareas).

## Alcance
Entra:
- Un único fichero por invocación: `python3 contar.py [-l] [-w] [-c] FICHERO`.
- Conteo de líneas, palabras y caracteres (puntos de código Unicode).
- Mensajes de error y códigos de salida para fichero inexistente, ilegible o no UTF-8.
- Tests con `unittest`.

NO entra:
- Varios ficheros ni línea de totales.
- Lectura desde la entrada estándar (`-` o sin fichero).
- Conteo de bytes (`wc -c` real) ni `-L`, `-m`.
- Alineación en columnas como `wc`, empaquetado (`setup.py`, `pyproject.toml`), instalación.

## Decisiones de arquitectura
- **Python 3 solo con librería estándar** (`argparse`, `sys`, `unittest`, `tempfile`, `subprocess`, `contextlib`, `io`). Por qué: lo exige el objetivo; cero dependencias.
- **Un solo módulo `contar.py` en la raíz**, importable y ejecutable. Por qué: el programa es diminuto; separar en paquete no aporta nada.
- **Lógica pura separada de la E/S**: `count_text(text) -> (lines, words, chars)` no toca ficheros; `main(argv) -> int` hace argumentos, lectura y salida. Por qué: se prueba la lógica sin ficheros y `main` sin lanzar procesos.
- **Semántica de conteo (igual que `wc`)**:
  - líneas = número de caracteres `"\n"` (`text.count("\n")`); un fichero sin salto final cuenta una línea menos.
  - palabras = `len(text.split())` (secuencias separadas por espacio en blanco Unicode).
  - caracteres = `len(text)` (puntos de código, no bytes). Por qué: el objetivo pide "caracteres"; `-c` aquí equivale a `wc -m`.
- **Lectura**: `open(path, encoding="utf-8", newline="")`. Por qué: `newline=""` evita convertir `\r\n` en `\n`, así `\r` cuenta como carácter, igual que `wc`.
- **Formato de salida**: una línea `"<n1> <n2> ... <ruta>"`, números separados por un espacio, siempre en orden líneas, palabras, caracteres, y la ruta tal como se pasó. Sin opciones se muestran los tres. Por qué: sencillo de comprobar en tests; el orden fijo imita a `wc`.
- **Errores**: mensaje en `stderr` con prefijo `contar.py: error: `, nada en `stdout`, código de salida `1`. Errores de argumentos los gestiona `argparse` (código `2`).
- **Tests** en `tests/`, un fichero por tarea, ejecutados desde la raíz.

## Estructura
```
contar.py                 módulo y CLI
tests/test_count_text.py  tests de count_text (T-001)
tests/test_cli.py         tests de main y del ejecutable (T-002, T-003 lo amplía)
```

## Comando de test
Desde la raíz del proyecto:
```
python3 -m unittest discover -s tests -v
```

## Tareas
| id | título | depende_de | estado |
|---|---|---|---|
| T-001 | Crear esqueleto y función count_text | [] | hecha |
| T-002 | Añadir CLI con opciones -l -w -c | [T-001] | hecha |
| T-003 | Gestionar errores de lectura del fichero | [T-002] | hecha |

**Iteración 1 cerrada (2026-10-17).** Las tres tareas se completaron sin rechazos (`intentos: 0`). Verificación final: 19 tests OK con el comando de test y CLI comprobado a mano.

## Siguiente iteración (propuesta, sin fichas todavía)
Objetivo: acercar `contar.py` al comportamiento de `wc`. Se planificarán fichas cuando el usuario resuelva las decisiones abiertas.

| id provisional | título | depende_de | notas |
|---|---|---|---|
| T-004 | Varios ficheros y línea `total` | [] | Una línea por fichero y, si hay 2 o más, una última línea con la etiqueta `total`. Un fichero con error se informa en `stderr`, se sigue con el resto y el código de salida final es `1`. |
| T-005 | Lectura desde stdin | [T-004] | Sin ficheros o con `-` se lee `sys.stdin` (decodificado como UTF-8); en la salida no se imprime ruta. |
| T-006 | `-c` como bytes y `-m` como caracteres | [T-004] | Depende de la decisión D1. Obliga a leer en binario y decodificar a mano (`count_text` recibiría `bytes` o habría una función nueva `count_bytes`). |
| T-007 | Alineado en columnas | [T-004, T-006] | Ancho común = número de dígitos del mayor valor mostrado (incluido `total`), números alineados a la derecha. Va al final porque cambia el formato que comprueban todos los tests anteriores. |

Todas tocan `contar.py` y `main`, así que se harán en secuencia, no en paralelo.

### Decisiones abiertas (las responde el usuario)
- **D1. Significado de `-c`.** (a) Igual que `wc`: `-c` = bytes y se añade `-m` = caracteres. Cambia el significado actual de `-c` y obliga a reescribir sus tests. (b) Se mantiene `-c` = caracteres y se añade `-b`/`--bytes`. Recomendación del líder: (a), porque el objetivo es imitar a `wc`.
- **D2. Columnas.** ¿Basta con el ancho calculado de T-007, o hay que copiar exactamente la salida de GNU `wc` (que usa un ancho mínimo de 7 cuando lee de stdin)? Recomendación: el ancho calculado, que es más sencillo de probar.
