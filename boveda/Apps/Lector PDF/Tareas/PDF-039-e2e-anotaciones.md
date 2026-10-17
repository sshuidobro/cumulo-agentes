---
tipo: tarea
id: PDF-039
titulo: E2E y rendimiento de la iteración 2 (anotaciones)
app: pdf
estado: pendiente
depende_de: [PDF-029, PDF-032, PDF-033, PDF-034, PDF-035, PDF-036, PDF-038]
intentos: 0
skills: [pruebas-calidad, calidad-profesional, formatos-ofimatica]
creado: 2026-10-17
actualizado: 2026-10-17
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
