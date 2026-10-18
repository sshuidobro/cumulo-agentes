---
tipo: tarea
id: PDF-099
titulo: E2E, accesibilidad, interoperabilidad y rendimiento de la iteración 4
app: pdf
estado: pendiente
depende_de: [PDF-047, PDF-048, PDF-095, PDF-097, PDF-051]
intentos: 0
skills: [stack-typescript-react, calidad-profesional, pruebas-calidad]
creado: 2026-10-18
actualizado: 2026-10-18
tags: [tarea, pdf, iteracion-4, e2e, rendimiento, accesibilidad]
---

# PDF-099 · E2E, accesibilidad, interoperabilidad y rendimiento de la iteración 4

Plan: [[Apps/Lector PDF/Plan|Plan]] (iteración 4) · Decisiones: [[ADR-0016-e2e-long-tasks-en-serie]] · [[ADR-0022-pdf-cifrados]] · [[ADR-0023-pestanas-y-recientes]] · [[ADR-0024-modos-de-pagina]] · [[ADR-0025-lienzo-de-detalle]]

## Objetivo
Cerrar la iteración 4 con evidencia: un flujo completo (abrir cifrado, varias pestañas, modos de vista, zoom alto, anotar, guardar, reabrir desde recientes) estable, presupuestos sin regresión, accesibilidad sin incidencias graves y muestras cifradas para comprobar en Adobe.

## Contexto
- Leer: `tests/e2e/iteration3-flow.spec.ts`, `iteration3-performance.spec.ts`, `iteration3-a11y.spec.ts` (PDF-090, mismo patrón), `tests/fixtures/encrypted.ts` (PDF-091), `tests/support/qpdf.ts`, `tests/support/interop-samples.ts`, `tests/e2e/recent.spec.ts` (OPFS, PDF-049), la sección «Comandos» del Plan.
- Regla del coordinador: las pruebas `@perf` se lanzan sin otras baterías en la máquina.

## Qué hay que hacer
1. `tests/e2e/iteration4-flow.spec.ts`: abrir `encrypted-aes-256.pdf` (contraseña «usuario») y `basic-5.pdf` desde OPFS (dos pestañas); en el cifrado, «Doble página», resaltar texto de la p2 y añadir una nota; cambiar a `basic-5.pdf`, zoom 3 200 % y volver a 100 %; volver al cifrado: el resaltado sigue sin guardar; Ctrl+S; cerrar ambas pestañas; reabrir el cifrado desde «Recientes» → pide contraseña, abre en la página donde estaba y muestra las anotaciones; `qpdf --check --password=usuario` del descargado con código 0.
2. `tests/e2e/iteration4-performance.spec.ts` (`@perf`): (a) abrir un cifrado AES-256 de 1 000 páginas (generado con `qpdfEncrypt` sobre el fixture de rendimiento) hasta la p1 pintada ≤ 1,5 × el tiempo del mismo sin cifrar; (b) guardar una anotación en él < 2 s; (c) cambio de pestaña (de PDF-095) y modos (de PDF-050) siguen en presupuesto; (d) los presupuestos de PDF-022, PDF-039 y PDF-090 siguen en verde (no se tocan sus pruebas).
3. `tests/e2e/iteration4-a11y.spec.ts`: axe (`serious`/`critical` = 0) con: diálogo de contraseña (con error), barra de pestañas con 3 documentos, menú «Vista», menú «Abrir recientes», propiedades › Seguridad, pantalla completa; en tema claro y oscuro.
4. `pnpm --filter lector-pdf interop:samples` añade `cifrado-anotado-aes256.pdf` y `cifrado-anotado-rc4.pdf` (contraseña «usuario», con resaltado, nota y firma) y `cifrado-formulario.pdf` (`form-full.pdf` cifrado y relleno) en `apps/lector-pdf/interop-samples/` (ignorada por git); el Registro incluye la lista manual para Adobe (el líder la copia al Manual).
5. Repetir: `e2e --project=chromium --repeat-each=3` y `e2e --project=chromium-perf --no-deps --repeat-each=3`.

## Criterios de aceptación
- [ ] `pnpm --filter lector-pdf e2e` con código 0; las dos repeticiones ×3 con código 0 (con la puerta de reposo pasada).
- [ ] Medidas en el Registro (tabla: medida, presupuesto, valor ×3) para (a)-(c) y los presupuestos del Plan.
- [ ] Axe 0 `serious`/`critical` en las 12 vistas (6 × 2 temas).
- [ ] `qpdf --check --password=usuario` 0 en todos los cifrados guardados por las pruebas nuevas.
- [ ] Sin `waitForTimeout`, `test.skip` ni `.only`.
- [ ] Ninguna contraseña aparece en `localStorage`, IndexedDB (borradores, recientes) ni en la consola del navegador durante el flujo (el test los recorre y busca «usuario»/«propietario»).
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm coverage`, `pnpm perf` con código 0; `pnpm --filter lector-pdf build` con código 0 (`bundle:check` dentro del presupuesto del Plan; si `@noble/*` lo supera, se carga en diferido como pdf.js — anotarlo).

## Fuera de alcance
- Comprobación en Adobe Reader real (la hace el usuario con la lista). Nuevas funciones.

## Registro
<!-- Cada agente añade aquí su entrada al terminar; no borrar las anteriores. -->
