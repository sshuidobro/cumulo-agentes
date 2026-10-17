---
tipo: tarea
id: PDF-029
titulo: Interoperabilidad - validar los PDFs guardados con qpdf, pdf.js y el corpus
app: pdf
estado: pendiente
depende_de: [PDF-028, PDF-004]
intentos: 0
skills: [formatos-ofimatica, pruebas-calidad]
creado: 2026-10-17
actualizado: 2026-10-17
tags: [tarea, pdf, anotaciones, pruebas, formato]
---

# PDF-029 · Interoperabilidad de las anotaciones guardadas

Plan: [[Apps/Lector PDF/Plan|Plan]] · Decisiones: [[ADR-0009-anotaciones-escritor-incremental]] · [[ADR-0011-documentos-de-prueba-pdf]]

## Objetivo
Demostrar con una herramienta independiente (qpdf) que lo que escribimos son **anotaciones PDF estándar** y que el fichero sigue siendo válido, sobre todos los fixtures y el corpus; y dejar la lista de comprobación manual en Adobe Reader para el usuario.

## Contexto
- Leer: `src/core/pdf/incremental.ts` (PDF-028), `fixtures/FUENTES.md`, [[ADR-0011-documentos-de-prueba-pdf]].
- `qpdf` es herramienta de desarrollo del sistema: `apt-get install -y qpdf` (anota la versión). `qpdf --check f.pdf` sale con 0 si no hay errores (2 = errores, 3 = avisos). `qpdf --json --json-key=objects f.pdf` vuelca los objetos (JSON v2: `"obj:12 0 R": { "value": { ... } }`; nombres como `"/Highlight"`).
- Si `qpdf` no está en el `PATH`, los tests de esta ficha **fallan** con el mensaje «Instala qpdf: apt-get install -y qpdf» (no se saltan).

## Qué hay que hacer
1. `tests/support/qpdf.ts`: `export function qpdfCheck(path: string): { code: number; output: string }` y `export function qpdfAnnotations(path: string): Array<{ ref: string; subtype: string; keys: string[] }>` (con `node:child_process` `spawnSync`).
2. `tests/unit/pdf/interop.test.ts`, en un directorio temporal (`os.tmpdir()`), para cada fichero de `fixtures/pdf/generated/` no dañado de ≤ 5 000 páginas y cada PDF del corpus:
   - Añade el **conjunto estándar**: 1 de cada tipo en la página 1 (geometría fija definida en `tests/support/standard-annotations.ts`, colores distintos, autor `Prueba`, contenidos con acentos y `€`).
   - Escribe `original + delta`, ejecuta `qpdf --check` → código 0 o 3 (avisos permitidos **solo** si el original ya los daba: compara con `qpdf --check` del original).
   - `qpdfAnnotations`: aparecen los 6 subtipos con las claves obligatorias (`/Type /Subtype /Rect /AP /F /NM /P /M`; `/QuadPoints` en marcado, `/InkList` en tinta, `/DA` en texto libre, `/Popup` en nota).
   - pdf.js: relee e importa con `importPageAnnotations` (PDF-024) → el modelo importado es igual al escrito (tipo, geometría ±0,01, color ±1/255, contents, autor).
3. Ida y vuelta completa: `annotated.pdf` → importar → modificar 1, borrar 1, añadir 2 → guardar → importar → `diffAnnotations` contra lo esperado vacío. Repite 3 guardados seguidos.
4. Conservación: tras guardar `annotated.pdf`, el `Square` y el `Link` de p3 siguen con su diccionario idéntico (`qpdf --json` antes/después) y `form.pdf` conserva `/AcroForm`.
5. Lista manual (en el Registro; el líder la copia al Manual): abrir en Adobe Acrobat Reader los 3 ficheros que deja `pnpm --filter lector-pdf interop:samples` (script que escribe en `apps/lector-pdf/interop-samples/`, **ignorada por git**) y comprobar: se ven los 6 tipos, el panel de comentarios de Adobe los lista con autor y texto, se pueden responder y Adobe guarda sin errores; reabrir en nuestra app y que sigan ahí.

## Criterios de aceptación
- [ ] (T) `interop.test.ts` pasa para todos los ficheros de los puntos 2-4 (lista de ficheros y versión de qpdf en el Registro).
- [ ] (T) Ningún fichero resultante empeora `qpdf --check` respecto al original.
- [ ] `pnpm --filter lector-pdf interop:samples` genera los 3 ficheros y `git status` no los muestra.
- [ ] Si se encuentra un fallo del escritor, se corrige en `incremental.ts`/`to-pdf.ts` con un test de regresión aquí (el cambio cuenta para esta ficha, máx. 80 líneas; si es mayor, vuelve al líder).
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` con código 0; el conjunto de esta ficha tarda < 60 s.

## Fuera de alcance
- Comprobación real en Adobe (la hace el usuario con la lista). Cifrados (PDF-047).

## Registro
<!-- Cada agente añade aquí su entrada al terminar; no borrar las anteriores. -->
