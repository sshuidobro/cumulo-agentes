---
tipo: tarea
id: PDF-090
titulo: E2E, accesibilidad, interoperabilidad y rendimiento de la iteración 3
app: pdf
estado: en-curso
depende_de: [PDF-083, PDF-043, PDF-044, PDF-088, PDF-089]
intentos: 0
skills: [pruebas-calidad, calidad-profesional]
creado: 2026-10-18
actualizado: 2026-10-18
tags: [tarea, pdf, iteracion-3, e2e, rendimiento]
---

# PDF-090 · E2E, accesibilidad, interoperabilidad y rendimiento de la iteración 3

Plan: [[Apps/Lector PDF/Plan|Plan]] (iteración 3) · Decisiones: [[ADR-0016-e2e-long-tasks-en-serie]] · [[ADR-0019-formularios-acroform]] · [[ADR-0020-firma-visual]] · [[ADR-0021-impresion]]

## Objetivo
Cerrar la iteración 3 con evidencia: un flujo completo de usuario (rellenar, firmar, comentar, imprimir, guardar, reabrir) en verde de forma estable, presupuestos de rendimiento sin regresión, accesibilidad sin incidencias graves y muestras para la comprobación manual en Adobe.

## Contexto
- Leer: `tests/e2e/annotations-flow.spec.ts`, `annotations-performance.spec.ts`, `annotations-a11y.spec.ts` (modelo de PDF-039), `tests/e2e/helpers.ts`, `tests/support/qpdf.ts`, `tests/support/interop-samples.ts`, la sección «Comandos» del Plan (proyecto `chromium-perf`, puerta de reposo de CPU).
- Regla del coordinador: las pruebas `@perf` se lanzan sin otras baterías en la máquina.

## Qué hay que hacer
1. `tests/e2e/iteration3-flow.spec.ts`: en `form-full.pdf`, rellenar `nombre`, `acepto`, `color`, `pais`; colocar una firma dibujada en la p1; resaltar texto de la p1; imprimir la p1 (con `window.print` sustituido y `page.pdf()`); Ctrl+S; reabrir lo descargado y comprobar valores, firma (como `Stamp`) y resaltado; `qpdf --check` 0.
2. `tests/e2e/iteration3-performance.spec.ts` (`@perf` donde mida *long tasks*): (a) abrir `form-full.pdf` y rellenar 10 campos seguidos: ninguna *long task* > 100 ms; (b) guardar formularios en `form-full.pdf` < 1 s; (c) imprimir 20 páginas de `pages-5000.pdf` < 20 s y sin *long tasks*; (d) los presupuestos de PDF-022 y PDF-039 siguen en verde (no se tocan sus pruebas).
3. `tests/e2e/iteration3-a11y.spec.ts`: axe (`serious`/`critical` = 0) con: campo de formulario enfocado, diálogo «Crear firma», diálogo «Imprimir», diálogo «Propiedades» (pestaña Fuentes), en tema claro y oscuro.
4. `pnpm --filter lector-pdf interop:samples` deja `formulario-relleno.pdf`, `firmado.pdf` (firma dibujada + firma de imagen) en `apps/lector-pdf/interop-samples/` (ignorada por git) y el Registro incluye la lista manual para Adobe (el líder la copia al Manual).
5. Repetir la batería: `e2e --project=chromium --repeat-each=3` y `e2e --project=chromium-perf --no-deps --repeat-each=3`.

## Criterios de aceptación
- [ ] `pnpm --filter lector-pdf e2e` con código 0; las dos repeticiones ×3 con código 0 (con la puerta de reposo pasada).
- [ ] Medidas en el Registro (tabla: medida, presupuesto, valor ×3) para (a)-(c) y para los presupuestos del Plan.
- [ ] Axe 0 `serious`/`critical` en las 8 vistas (4 × 2 temas).
- [ ] `qpdf --check` 0 en todos los ficheros guardados por las pruebas nuevas.
- [ ] Sin `waitForTimeout`, `test.skip` ni `.only` (la regla de PDF-089 lo garantiza).
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm coverage`, `pnpm perf` con código 0; `pnpm --filter lector-pdf build` con código 0 (`bundle:check` ≤ 500 000 bytes).

## Fuera de alcance
- Comprobación en Adobe Reader real (la hace el usuario con la lista). Nuevas funciones.

## Registro
<!-- Cada agente añade aquí su entrada al terminar; no borrar las anteriores. -->
