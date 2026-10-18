---
tipo: tarea
id: PDF-039
titulo: E2E y rendimiento de la iteración 2 (anotaciones)
app: pdf
estado: en-revision
depende_de: [PDF-029, PDF-032, PDF-033, PDF-034, PDF-035, PDF-036, PDF-038, PDF-069, PDF-070, PDF-071, PDF-072, PDF-073]
intentos: 0
skills: [pruebas-calidad, calidad-profesional, formatos-ofimatica]
creado: 2026-10-17
actualizado: 2026-10-18
tags: [tarea, pdf, e2e, rendimiento, anotaciones]
---

# PDF-039 · E2E de anotaciones

Plan: [[Apps/Lector PDF/Plan|Plan]] (sección "Presupuestos") · Decisiones: [[ADR-0009-anotaciones-escritor-incremental]]

## Objetivo
Demostrar el flujo completo que pidió el usuario —subrayar y hacer notas, guardarlas dentro del PDF y volver a verlas— con todos los tipos, deshacer/rehacer, documentos grandes y validación externa del fichero resultante.

## Contexto
- Leer: `tests/e2e/helpers.ts` (PDF-022), todos los `tests/e2e/*` de PDF-031 a PDF-038 (no dupliques; esta ficha añade flujos completos y mediciones), `tests/support/qpdf.ts` (PDF-029), sección "Presupuestos" del Plan.
- Descargas en Playwright: `const d = await page.waitForEvent('download'); await d.saveAs(ruta)`. Los ficheros van a `test.info().outputPath()`.
- Como en PDF-022: no se relajan umbrales; si uno falla, se anota y vuelve al líder.

## Qué hay que hacer
1. `tests/e2e/annotations-flow.spec.ts`: sobre `basic-5.pdf`: crear con la UI un resaltado, un subrayado, un tachado, una nota con texto, un comentario en el resaltado, un texto libre y un dibujo; Ctrl+Z ×2 y Ctrl+Y ×2 (estado comprobado en el panel); Ctrl+S (descarga) → `qpdf --check` del descargado (código 0) y `qpdfAnnotations` con los 6 subtipos + Popup; abrir el descargado → panel con 6 elementos, comentarios y autor correctos; editar el comentario de la nota, borrar el dibujo, guardar de nuevo → abrir → cambios presentes.
2. `tests/e2e/annotations-foreign.spec.ts`: `annotated.pdf` y el corpus `7.18.1-t02-pass-a.pdf`: las existentes se ven y se listan; añadir una nota y guardar → el `Square` y el `Link` siguen (qpdf) y el enlace sigue funcionando.
3. `tests/e2e/annotations-performance.spec.ts`: `pages-5000.pdf`: escaneo de anotaciones completo < 10 s sin *long tasks* > 100 ms; ir a 10 páginas aleatorias y crear un resaltado en cada una; guardar < 1 s (desde Ctrl+S a la descarga) y el fichero crece < 50 KB; `pages-100000.pdf`: anotar la página 99 999 y guardar < 3 s.
4. `tests/e2e/annotations-keyboard.spec.ts`: crear una nota y un resaltado solo con teclado (barra «Comentar» con flechas, Ctrl+A, Intro), navegar a ellos desde el panel con flechas, borrar con Supr.
5. Accesibilidad: añade `@axe-core/playwright` versión exacta `4.14.0` a `devDependencies` de `apps/lector-pdf` (dependencia de pruebas estándar, decidida por el líder) y comprueba la barra «Comentar», la ventana de nota y el panel de comentarios sin violaciones `serious` ni `critical`.
6. Repite toda la batería con `--repeat-each=3`.

## Criterios de aceptación
- [ ] `pnpm --filter lector-pdf e2e` con código 0, y con `--repeat-each=3` también.
- [ ] Medidas del punto 3 anotadas en el Registro y dentro de presupuesto.
- [ ] Los PDFs guardados pasan `qpdf --check` (salida en el Registro).
- [ ] Axe: 0 violaciones `serious`/`critical` en las tres vistas.
- [ ] Ninguna prueba usa `waitForTimeout`, `test.skip` ni `.only`.
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` con código 0.

## Fuera de alcance
- Comprobación en Adobe Reader real (lista manual de PDF-029, la hace el usuario).

## Registro
<!-- Cada agente añade aquí su entrada al terminar; no borrar las anteriores. -->

### [lider] replanificación — 2026-10-17
- `depende_de` gana [[PDF-069-barra-comentar]] (la barra «Comentar» que se prueba con teclado y axe sale ahora de esa ficha, no de PDF-030).

### [programador] ronda 1 — 2026-10-18
- Ficheros cambiados: `apps/lector-pdf/package.json` (`@axe-core/playwright` 4.14.0 exacta en devDependencies), `pnpm-lock.yaml`; nuevos `apps/lector-pdf/tests/e2e/annotations-kit.ts` (utilidades compartidas), `annotations-live.ts` (anotaciones referenciadas desde `/Annots` vía qpdf), `annotations-flow.spec.ts`, `annotations-foreign.spec.ts`, `annotations-keyboard.spec.ts`, `annotations-performance.spec.ts`, `annotations-a11y.spec.ts`.
- Qué he hecho: flujo completo (6 anotaciones, deshacer/rehacer por el panel, Ctrl+S, qpdf, reapertura, edición y borrado, segundo guardado); `annotated.pdf` y `7.18.1-t02-pass-a.pdf` con nota nueva (Square, Link y enlace externo tras guardar); teclado (resaltado con Ctrl+A e Intro, navegación del panel con ↑↓, Intro y Supr); rendimiento en 5 000 y 100 000 páginas; axe en las tres vistas. No se usan `waitForTimeout`, `test.skip` ni `.only`.
- Medidas (Chromium, qpdf 11.9.0):
  - pages-5000, escaneo de anotaciones desde abrir hasta el panel «sin comentarios»: 1 721 ms (< 10 000). Long tasks desde el inicio del documento (carga y escaneo): 1, máxima 82 ms (< 100).
  - pages-5000, 10 resaltados en páginas aleatorias (semilla fija) y Ctrl+S → descarga: 103 ms (< 1 000). Crecimiento del fichero: 9 077 bytes (< 51 200).
  - pages-100000, resaltado en la página 99 999 y Ctrl+S → descarga: 237 ms (< 3 000).
  - Nota: en 5 000 páginas el panel escanea solo al abrir el documento (no hay botón «Buscar en todo el documento»); la medida incluye la carga, así que es una cota superior.
- Comandos ejecutados y resultado:
  - `pnpm lint`: sin errores. `pnpm typecheck`: sin errores. `pnpm test`: 143 ficheros, 1 685 tests, todos en verde.
  - `pnpm --filter lector-pdf e2e`: 153 pasan, 1 falla (`annotations-a11y.spec.ts`, panel de comentarios). Con `--repeat-each=3`: 459 pasan, 3 fallan (la misma prueba en cada repetición).
  - `qpdf --check` (código 0, «No syntax or stream encoding errors found») en `basic-5-anotado.pdf`, `basic-5-revisado.pdf`, `annotated-con-nota.pdf`, `verapdf-con-nota.pdf`, `pages-5000-anotado.pdf` y `pages-100000-anotado.pdf`. Las pruebas comprueban el código 0 en cada guardado.
- Dudas o cosas que no he podido hacer:
  1. **Axe en el panel de comentarios: falla (no relajado).** Según axe, en `src/ui/sidebar/CommentsPanel.tsx` (PDF-036): (a) `label-content-name-mismatch` en 6 filas: el `aria-label` «Resaltado de Usuario, página 1» no contiene el texto visible (extracto, fecha); (b) `nested-interactive` en 5 nodos: el botón «Borrar» va dentro de `role="option"`. Arreglarlo cambia cómo se nombran las filas y dónde va el botón «Borrar»: es decisión del líder y está fuera del alcance de esta ficha; no lo he tocado. Hace falta reabrir PDF-036 o crear una ficha de corrección.
  2. **Nota solo con teclado: no es posible en la app.** `createNoteAt` solo responde al puntero; no hay forma de colocar una nota con teclado. La prueba `annotations-keyboard` activa «Nota» con foco y Intro, y la coloca con un clic. Decidir cómo colocarla con teclado es una decisión de producto.
  3. **Bug en la barra «Comentar» (PDF-069), fuera de alcance:** con el foco en un botón de la barra, ←/→ mueven el foco entre botones y además cambian de página (el atajo global `next-page` también recibe la tecla; `CommentToolbar` no detiene la propagación). Reproducción: foco en «Resaltar», pulsar → una vez: página +1. La prueba de teclado no usa ←→ en la barra para no depender de ese bug; conviene arreglarlo con un test rojo previo en PDF-069.
  4. Por lo anterior, la ficha no cumple «`pnpm --filter lector-pdf e2e` con código 0» ni el criterio de axe. No la paso a `en-revision` con pruebas en rojo: queda `bloqueada` hasta que el líder decida sobre los puntos 1 y 2 (y corrija el 3).
  5. Commit: solo los ficheros de esta ficha. Quedan sin commitear cambios ajenos que ya había (`apps/lector-pdf/tests/ui/ink.test.tsx` y la ficha PDF-035), que no tocan esta ficha.

### [lider] replanificación — 2026-10-18
Decisiones técnicas y de accesibilidad (no de producto) sobre los puntos de la ronda 1:
1. Panel de comentarios (axe) → [[PDF-070-panel-comentarios-accesible]]: el nombre de la fila pasa a ser su contenido visible (empieza por «Nota de Ana, página 1»), sin `aria-label`; ningún control enfocable dentro de `role="option"`: borrar con Supr/Retroceso en la lista, botón «Borrar comentario» en la barra del panel y papelera decorativa (`aria-hidden`) para el ratón. Esa ficha adapta los localizadores de los e2e de esta ficha (`optionName()` en `annotations-kit.ts`).
2. Nota solo con teclado → [[PDF-072-nota-con-teclado]]: activar «Nota» con Intro/Espacio (clic con `detail === 0`) crea la nota en la página actual, arriba a la izquierda de lo visible, con su ventana abierta; Esc y flechas la mueven. Con ratón, sin cambios.
3. ←/→ de la barra «Comentar» cambiando de página → [[PDF-071-barra-comentar-flechas]] (test rojo previo; falta `stopPropagation()`).
- `depende_de` gana PDF-070, PDF-071 y PDF-072. Estado → `pendiente`, `intentos: 0`. Lo commiteado en la ronda 1 se conserva.
- **Qué queda en esta ficha al reanudarla:**
  - `annotations-keyboard.spec.ts`: recorrer la barra «Comentar» con ←/→ (comprobando que el indicador de página no cambia) y crear la nota solo con teclado (foco en «Nota», Intro, escribir, Esc, flechas), sin ningún clic; quitar la nota de cabecera sobre el clic.
  - Volver a ejecutar toda la batería: `pnpm --filter lector-pdf e2e` y con `--repeat-each=3` (código 0, incluido axe), `qpdf --check` y medidas del punto 3 en el Registro.
  - Los cambios ajenos sin commitear (`tests/ui/ink.test.tsx`, ficha PDF-035) no son de esta ficha.

### [programador] ronda 2 — 2026-10-18
- Ficheros cambiados: `apps/lector-pdf/tests/e2e/annotations-keyboard.spec.ts` (paso nuevo: con la nota creada solo con teclado, ←/→ la mueven y su caja crece en x), esta ficha. El resto de la batería ya estaba commiteado (PDF-070, PDF-071 y PDF-072). No hay otros cambios de código.
- Qué he hecho: he revisado «Qué queda en esta ficha»: el recorrido de la barra con ←/→ (página sin cambios), la nota solo con teclado (Intro en «Nota», escribir, Esc) y el panel con flechas, Intro y Supr ya estaban cubiertos. Faltaba mover la nota con flechas, que he añadido. He repetido la batería completa.
- Comandos ejecutados y resultado:
  - `pnpm --filter lector-pdf e2e` (una vez): 155 pasan, 1 falla. La falla es `search.spec.ts` «durante la búsqueda…» (long task de 101 ms frente a 100). En tres ejecuciones aisladas de esa prueba: 2 pasan y 1 falla (117 ms). Es una prueba preexistente.
  - `pnpm --filter lector-pdf e2e --repeat-each=3`: 467 pasan, 1 falla. La falla es `viewer.spec.ts` «durante un scroll continuo no hay tareas largas de más de 100 ms» (102 ms). Aislada: 4 de 4 pasan. Es otra prueba preexistente con el mismo tipo de umbral.
  - Todos los tests de anotaciones pasan en todas las repeticiones, incluido axe (`annotations-a11y`, 0 violaciones serious/critical). `annotations-keyboard` pasa 3 de 3 tras el paso nuevo.
  - Medidas (Chromium, qpdf 11.9.0), en presupuesto:
    - pages-5000: escaneo completo hasta el panel «sin comentarios»: 2 819 ms (< 10 000). Long tasks desde el inicio: 1, máxima 79 ms (< 100).
    - pages-5000: 10 resaltados y Ctrl+S → descarga: 158 ms (< 1 000). Crecimiento: 9 077 bytes (< 51 200).
    - pages-100000: resaltado en la página 99 999 y Ctrl+S → descarga: 352 ms (< 3 000).
  - `qpdf --check`: cada guardado de `annotations-flow`, `annotations-foreign`, `annotations-performance` comprueba código 0 con `qpdfCheck` y pasa en las 3 repeticiones.
  - `pnpm lint` sin avisos. `pnpm typecheck` sin errores. `pnpm test`: 143 ficheros, 1 709 tests en verde.
- Dudas o cosas que no he podido hacer:
  1. **Criterio de la ficha no cumplido: `e2e` con código 0.** Las dos fallas son long tasks de 101-117 ms en pruebas preexistentes de `search.spec.ts` y `viewer.spec.ts`, no de anotaciones. Bajo carga (2 workers, la batería completa) superan 100 ms; aisladas pasan casi siempre. No relajo el umbral ni salto la prueba. Decisión para el líder: estabilizar esas medidas (p. ej. medirlas sin carga concurrente o con `workers: 1` para esa categoría) o asumir el riesgo. Es una decisión de infraestructura de pruebas, no de producto.
  2. **Cambio ajeno sin commitear**: `apps/lector-pdf/tests/ui/comments-panel.test.tsx` añade el test «al borrar con Supr la última fila, la activa pasa a la anterior». No es de esta ficha; no lo incluyo en el commit y lo dejo sin tocar. Pasa en la batería unitaria.
  3. Por lo anterior, la ficha queda `bloqueada`, no `en-revision`.

### [lider] replanificación — 2026-10-18 (ronda 2)
Decisión técnica (infraestructura de pruebas, no de producto) → [[ADR-0016-e2e-long-tasks-en-serie]]:
- Las dos fallas de la ronda 2 son pruebas de *long tasks* preexistentes que superan 100 ms solo con la batería en paralelo. No se relaja el umbral ni se reintenta: las 7 pruebas que miden *long tasks* llevan `{ tag: '@perf' }` y corren en un proyecto Playwright `chromium-perf` con `workers: 1`, después del proyecto paralelo → [[PDF-073-e2e-long-tasks-en-serie]].
- `depende_de` gana PDF-073. Estado → `pendiente`, `intentos: 0`. Lo de la ronda 2 ya está commiteado (`ff96d56`).
- El cambio sin commitear `tests/ui/comments-panel.test.tsx` es el test que añadió el tester de [[PDF-070-panel-comentarios-accesible]] (su Registro lo cita); se commitea aparte como PDF-070.
- **Qué queda en esta ficha al reanudarla (sin cambios de código previstos):** con PDF-073 hecha, ejecutar `pnpm --filter lector-pdf e2e` y `pnpm --filter lector-pdf e2e --repeat-each=3` (código 0), anotar en el Registro las medidas del punto 3 (ahora salen del proyecto `chromium-perf`) y la salida de `qpdf --check`, y pasar a `en-revision`. `annotations-performance.spec.ts` recibe la etiqueta `@perf` en PDF-073: no la toques aquí. Si una prueba de anotaciones falla también en serie, se anota con su valor y vuelve al líder.

### [programador] ronda 3 — 2026-10-18
- Ficheros cambiados: esta ficha (estado y Registro). No hay cambios de código: las pruebas de anotaciones ya estaban commiteadas y PDF-070, PDF-071, PDF-072 y PDF-073 están en `hecha`.
- Qué he hecho: he repetido la batería completa en serie y sin otras ejecuciones en paralelo. La primera pasada y las repeticiones van en dos comandos, como indica el Plan: el proyecto `chromium` con `--repeat-each=3` y `chromium-perf` con `--no-deps --repeat-each=3`. Las pruebas de anotaciones pasan en todas las repeticiones, incluido axe.
- Comandos ejecutados y resultado:
  - `pnpm --filter lector-pdf e2e`: **160 passed, 0 failed**, código 0 (3,6 min).
  - `pnpm --filter lector-pdf e2e --project=chromium --repeat-each=3`: **459 passed, 0 failed**, código 0 (6,5 min).
  - `pnpm --filter lector-pdf e2e --project=chromium-perf --no-deps --repeat-each=3`: **21 passed, 0 failed**, código 0 (4,1 min).
  - Medidas de `annotations-performance.spec.ts` (Chromium, sin otra carga, repetición aislada con reporter JSON; presupuesto entre paréntesis):
    - pages-5000, escaneo completo hasta el panel «sin comentarios»: 2 738 ms (< 10 000). Long tasks desde el inicio del documento: 0, máxima 0 ms (< 100).
    - pages-5000, 10 resaltados en páginas aleatorias y Ctrl+S → descarga: 131 ms (< 1 000). Crecimiento del fichero: 9 077 bytes (< 51 200).
    - pages-100000, resaltado en la página 99 999 y Ctrl+S → descarga: 242 ms (< 3 000).
  - `qpdf --check`: cada guardado de `annotations-flow`, `annotations-foreign` y `annotations-performance` ejecuta `qpdfCheck` y exige código 0. Todas las pasadas lo cumplen. Comprobado a mano sobre `pages-5000-anotado.pdf` de las tres repeticiones: «No syntax or stream encoding errors found» (exit 0).
  - `pnpm lint`: 0. `pnpm typecheck`: 0. `pnpm test`: 148 ficheros, 1 732 tests en verde, código 0.
- Dudas o cosas que no he podido hacer:
  1. `annotations-performance.spec.ts`, la prueba de 100 000 páginas no lleva `@perf` (solo mide el guardado, no long tasks). Por eso corre en el proyecto `chromium`, en paralelo con el resto, y su 19,5 s de duración incluye la carga. Su medida de guardado (242 ms) la he tomado en serie, aislada; en la batería en paralelo también cumplió su presupuesto. Si el líder quiere que la medida sea siempre en serie, hay que añadir `@perf` a esa prueba. No lo he tocado, porque la ficha dice que no toque este fichero.
  2. Hay `waitForTimeout` en `save-qa.spec.ts`, `search.spec.ts`, `links-qa.spec.ts` y `recover-qa.spec.ts`. Son pruebas de otras fichas, no de las de anotaciones de esta ficha, que no usan `waitForTimeout`. No las cambio: quitarlos es trabajo para otra ficha.
  3. Comandos de las pruebas guardados en `/tmp/claude-0/` (logs), no en el repositorio.
