---
tipo: decision
id: ADR-0028
app: pdf
estado: aceptada
fecha: 2026-10-19
creado: 2026-10-19
actualizado: 2026-10-19
tags: [decision, pdf, formato, organizar]
---

# ADR-0028 · Reescribir PDFs (organizar páginas) con el escritor propio, sin pdf-lib, qpdf ni mupdf

## Contexto
La iteración 5 necesita girar, borrar, reordenar, extraer, dividir, insertar y combinar páginas, y crear PDF desde imágenes ([[Paridad Adobe Acrobat]], área «Organizar»). Requisito transversal: igual con 5 que con 100 000 páginas. [[PDF-052-organizar-adr|PDF-052]] se bloqueó para preguntar al usuario por licencias GPL/AGPL. Investigación: [[Librerias y arquitectura PDF]].

Hechos que cambian la pregunta:
- `pdf-lib` y sus forks (`@cantoo/pdf-lib`, `@pdfme/pdf-lib`) son **MIT**; qpdf es **Apache-2.0**. Solo `mupdf` es AGPL. Ninguna opción permisiva obliga a preguntar al usuario.
- Ya tenemos en `src/core/pdf/` un lector de objetos por rangos (`ObjectReader`, ADR-0014), descifrado y cifrado (ADR-0022), serializador y escritor incremental (ADR-0009) que pasan qpdf y pdf.js.

## Opciones consideradas
| Opción | Ventajas | Inconvenientes | Licencia |
|---|---|---|---|
| **A. Escritor propio: incremento del árbol de páginas (organizar en el sitio) + copia de objetos alcanzables (documento nuevo)** | Sin dependencias; lee por rangos (no carga 100 000 páginas en memoria); conserva cifrado, anotaciones, enlaces e índice por construcción; mismo código en web y Tauri | Hay que escribir el recorrido de objetos y la renumeración | propia |
| B. `pdf-lib` o un fork | API hecha (`copyPages`, `removePage`) | Carga y parsea el documento entero (memoria y tiempo con 100 000 páginas); reescribe todo; el original no cifra ni descifra y está sin publicar desde 2022; forks sin auditar; no hay guardado incremental | MIT |
| C. qpdf compilado a WASM | Muy robusto (repara xref) | No hay paquete oficial mantenido; WASM de varios MB; necesita el fichero entero en un FS virtual; segundo motor que mantener | Apache-2.0 |
| D. `mupdf` (WASM) | Completo | AGPL; WASM grande; necesitaría decisión del usuario | AGPL-3.0 |

## Decisión
**Opción A.** No se añade ninguna dependencia: **la pregunta de licencias desaparece** y PDF-052 se desbloquea.
1. **Organizar en el sitio** (girar, borrar, reordenar; más adelante insertar): una **actualización incremental** que reescribe el árbol de páginas (`src/core/pdf/page-tree.ts`, [[PDF-052-organizar-adr|PDF-052]]):
   - El nodo raíz `/Pages` conserva su número (el catálogo no se toca). Los nodos intermedios son objetos nuevos, en un árbol equilibrado de **32 hijos** por nodo.
   - Cada página que se conserva se reescribe con su mismo número: `/Parent` nuevo y los atributos heredables (`/Resources`, `/MediaBox`, `/CropBox`, `/Rotate`) copiados a la página si los heredaba. Sus `/Annots` (anotaciones, enlaces, widgets) no cambian.
   - Las páginas borradas no se escriben: quedan en el fichero sin referenciar (el tamaño no baja; «Guardar optimizado» llegará con la opción 2).
   - Solo giros (mismo orden): se reescriben únicamente las páginas cuyo `/Rotate` cambia.
   - Índice y enlaces a páginas que siguen: válidos (mismas referencias). A páginas borradas: pdf.js no las resuelve (`getPageIndex` falla) y `engine/dest.ts` ya devuelve `null` (el clic no hace nada). Limpiarlos queda para [[PDF-053-organizar-paginas|PDF-053]].
   - Funciona igual en PDFs cifrados: `DeltaWriter` cifra lo que escribe.
2. **Documento nuevo** (extraer, dividir, combinar, crear desde imágenes, guardar optimizado): escritor de **copia de objetos alcanzables** desde las páginas elegidas, con renumeración y xref clásica nueva, flujos copiados sin decodificar (descifrados si el original estaba cifrado). Se detalla en [[PDF-054-extraer-dividir|PDF-054]] y [[PDF-055-insertar-combinar|PDF-055]].
3. **Reparar xref** (reconstruir escaneando `N G obj`): fuera de PDF-052; se planifica con la opción 2.
4. El código común del incremento (`DeltaWriter`, xref, trailer, `/ID`) se separa de `incremental.ts` en `src/core/pdf/delta-writer.ts` ([[PDF-106-escritor-de-incrementos|PDF-106]]) para que lo usen el guardado de anotaciones y el de páginas.
5. Las operaciones largas (más de 5 000 páginas) se ejecutarán en un Web Worker con progreso y cancelar ([[PDF-053-organizar-paginas|PDF-053]]); el núcleo acepta `signal` y `onProgress`.

## Medidas
Medidas de PDF-052 (`pnpm perf`, calentamiento + mejor de 3, `ObjectReader.open` incluido; máquina de desarrollo sin comprobar el reposo de CPU).

| Caso | Tiempo | Delta (bytes) |
|---|---|---|
| `pages-5000.pdf`: borrar la página 2 | 218 ms | 729 947 |
| `pages-100000.pdf`: borrar la página 2 | 5 299 ms | 15 123 448 |
| `pages-100000.pdf`: girar la página 50 000 | 2 521 ms | 317 |

## Consecuencias
- Sin dependencias ni licencias nuevas. Todo el código vive en `core/` y se prueba en Node con qpdf y pdf.js.
- Borrar páginas no reduce el tamaño del fichero hasta que exista «Guardar optimizado» (opción 2). Se dirá en el Manual.
- Reescribir el árbol toca todas las páginas conservadas: con 100 000 páginas el incremento es de varios MB y tarda segundos (ver Medidas); si supera el presupuesto, revisar este ADR (reutilizar nodos intermedios sin cambios).
- Formularios: los widgets de páginas borradas siguen en `/AcroForm /Fields`; quitarlos es parte de PDF-053.

## Revisión 2026-10-19 (líder, al detallar la iteración 5)
- La interfaz, el Worker, los documentos nuevos (opción 2) y los formularios de páginas borradas se deciden en [[ADR-0035-organizar-en-la-app]] y [[ADR-0034-operaciones-en-worker]].
- Las entradas del índice que apuntan a páginas borradas **no** se limpian en PDF-053 (siguen sin hacer nada al pulsarlas); queda en «Mejoras conocidas» del Plan. Los widgets de páginas borradas sí se quitan de `/AcroForm` ([[PDF-119-organizar-escritura]]).
