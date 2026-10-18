---
tipo: tarea
id: PDF-029
titulo: Interoperabilidad - validar los PDFs guardados con qpdf, pdf.js y el corpus
app: pdf
estado: hecha
depende_de: [PDF-028, PDF-004]
intentos: 0
skills: [formatos-ofimatica, pruebas-calidad]
creado: 2026-10-17
actualizado: 2026-10-18
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

### [programador] ronda 1 — 2026-10-18
- Ficheros cambiados: `apps/lector-pdf/tests/unit/pdf/interop.test.ts` (nuevo); `apps/lector-pdf/tests/support/qpdf.ts` (nuevo: `qpdfCheck`, `qpdfAnnotations`, más `qpdfObjects` y `qpdfVersion`); `apps/lector-pdf/tests/support/standard-annotations.ts` (nuevo: conjunto estándar, 6 anotaciones en la página 1); `apps/lector-pdf/tests/support/save-annotations.ts` (nuevo: guardado con el escritor real, compartido por test y muestras); `apps/lector-pdf/tests/support/interop-samples.ts` y `apps/lector-pdf/scripts/interop-samples.mjs` (nuevos: muestras); `apps/lector-pdf/package.json` (una línea: script `interop:samples`); `.gitignore` (`apps/lector-pdf/interop-samples/`).
- Qué he hecho: `interop.test.ts` prueba 21 ficheros (11 generados no dañados de ≤ 5 000 páginas: annotated, basic-5, compressed, form, images-200, incremental-updates, links, outline, pages-5000, page-labels, sizes-mixed; y los 10 del corpus). Para cada uno: conjunto estándar en p1, `qpdf --check` sin empeorar, los 6 subtipos con sus claves y reimportación con pdf.js (tipo, geometría ±0,01, color ±1/255, contenido, autor, fechas). Ida y vuelta de `annotated.pdf` en 3 guardados seguidos (modificar 1, borrar 1, añadir 2) con `diffAnnotations` vacío. Conservación: Square y Link de p3 idénticos en qpdf JSON; `/AcroForm` de `form.pdf` igual. No se ha encontrado ningún fallo del escritor: no se ha tocado `incremental.ts` ni `to-pdf.ts`.
- Desviación: la ficha pide `qpdf --json --json-key=objects`, pero con qpdf 11.9.0 esa clave solo vale para JSON v1 y falla. Se usa `qpdf --json=2` y se lee `qpdf[1]` (mismo formato `"obj:N G R"` con `value`). El script `interop:samples` ejecuta el TypeScript con el servidor SSR de Vite (ya es dependencia de desarrollo; el núcleo usa imports sin extensión que Node no resuelve); no se añade ninguna dependencia.
- Comandos ejecutados y resultado:
  - `apt`: qpdf ya instalado, versión **11.9.0**.
  - `npx vitest run tests/unit/pdf/interop.test.ts` → 88 pruebas OK, 5,1 s (el conjunto de la ficha tarda < 60 s).
  - `pnpm --filter lector-pdf interop:samples` → 3 ficheros; `qpdf --check` = 0 en los tres; `git status` no los muestra (ignorados).
  - `pnpm typecheck` → sin errores.
  - `pnpm test` → 88 ficheros, 1180 pruebas OK.
  - `pnpm lint` → **falla fuera de esta ficha**: `apps/lector-pdf/tests/e2e/zoom-qa.spec.ts` (sin versionar, no es mío; 3 errores de `consistent-type-imports` y `no-non-null-assertion`). Mis ficheros pasan ESLint sin avisos (`eslint --max-warnings 0` sobre ellos). No lo he tocado.
- Dudas o cosas que no he podido hacer:
  - Lista manual para Adobe Acrobat Reader (para el Manual; abrir con Adobe y luego con la app):
    1. Abrir `apps/lector-pdf/interop-samples/estandar-basic-5.pdf`, `estandar-annotated.pdf` y `estandar-form.pdf`.
    2. En la página 1 se ven seis marcas: resaltado amarillo, subrayado azul, tachado rojo, nota con icono de comentario verde, texto libre y trazo cian.
    3. El panel de comentarios lista las seis con autor «Prueba» y el texto con acentos y «€».
    4. Responder a una nota y guardar (Ctrl+S) sin mensajes de error.
    5. Reabrir el fichero en la app y comprobar que las anotaciones siguen ahí (la UI de anotaciones llega con PDF-031 y PDF-037). En `estandar-annotated.pdf` deben seguir también las anotaciones previas del fichero; en `estandar-form.pdf`, el formulario.
  - Comprobación real en Adobe: la hace el usuario con esta lista. Pendiente.

### [revisor] ronda 1 — 2026-10-18 — APROBADO
- Verificado: `pnpm lint` (0), `pnpm typecheck` (0), `pnpm test` (88 ficheros, 1180 pruebas OK), `interop.test.ts` 88 pruebas en ~5 s, `interop:samples` genera los 3 ficheros y están ignorados por git. El fallo de lint por `zoom-qa.spec.ts` ya no se reproduce.
- Cubre los criterios: 21 ficheros, `qpdf --check` sin empeorar, 6 subtipos con claves, reimportación con pdf.js, 3 guardados seguidos, conservación de Square/Link y `/AcroForm`. La desviación `--json=2` está justificada.
1. (opcional) `apps/lector-pdf/tests/unit/pdf/interop.test.ts:221` — `importPage1` está declarada después de su uso y duplica la lógica de `importAll`; podría unificarse.

### [tester] ronda 1 — 2026-10-18 — PASA
| Criterio | Resultado | Evidencia |
|---|---|---|
| interop.test.ts en 21 ficheros (qpdf 11.9.0) | OK | `npx vitest run tests/unit/pdf/interop.test.ts` → 88 pruebas OK, 5,0 s |
| qpdf --check no empeora | OK | comprobado dentro del test; muestras generadas con código 0 los tres |
| `interop:samples` genera 3 ficheros e ignorados por git | OK | `ls interop-samples` (3 PDF); `git check-ignore -v` → `.gitignore:12`; `git status` no los muestra |
| Corrección del escritor con regresión | N/A | no se tocó `incremental.ts`/`to-pdf.ts` |
| lint / typecheck / test / build | OK | lint 0, typecheck 0, `pnpm test` 93 ficheros 1235 pruebas OK (36 s), build web OK |
- Sin `skip`/`only`/`expect(true)` en los tests de la ficha; el aviso «Instala qpdf: apt-get install -y qpdf» está implementado en `tests/support/qpdf.ts`.
- Tests añadidos: ninguno adicional (cobertura suficiente). Rendimiento: conjunto de la ficha 5 s (< 60 s).
