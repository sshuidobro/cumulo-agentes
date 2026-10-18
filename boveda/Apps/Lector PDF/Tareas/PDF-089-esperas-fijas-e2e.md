---
tipo: tarea
id: PDF-089
titulo: Quitar las esperas fijas de las pruebas e2e y prohibirlas con ESLint
app: pdf
estado: pendiente
depende_de: []
intentos: 0
skills: [pruebas-calidad]
creado: 2026-10-18
actualizado: 2026-10-18
tags: [tarea, pdf, iteracion-3, pruebas, deuda]
---

# PDF-089 · Quitar las esperas fijas de las pruebas e2e y prohibirlas con ESLint

Plan: [[Apps/Lector PDF/Plan|Plan]] (iteración 3) · Origen: revisión de [[PDF-039-e2e-anotaciones]] (deuda no bloqueante)

## Objetivo
Ninguna prueba e2e usa `page.waitForTimeout`: las que esperan a un temporizador de la app usan el reloj falso de Playwright y las que comprueban que «no pasa nada» usan un asentamiento determinista. Una regla de ESLint impide volver a añadirlas.

## Contexto
- Hoy hay 4 (todas comentadas como «espera negativa legítima»): `tests/e2e/links-qa.spec.ts:50` (300 ms, no se abre ventana), `recover-qa.spec.ts:55` (2 500 ms, no se escribe borrador; *debounce* de 2 s), `save-qa.spec.ts:38` (500 ms, Ctrl+S sin cambios no descarga), `search.spec.ts:197` (1 000 ms, tras Detener el estado no cambia).
- Playwright 1.56: `page.clock.install()` antes de `page.goto` y `page.clock.runFor(ms)` adelantan `setTimeout`/`setInterval` de la página de forma determinista.
- Leer: `eslint.config.js` (bloques por `files`), `tests/e2e/helpers.ts`.

## Qué hay que hacer
1. `tests/e2e/helpers.ts`: `export async function settle(page: Page): Promise<void>` — espera dos `requestAnimationFrame` y una vuelta de `setTimeout(0)` dentro de la página (`page.evaluate`), para que los manejadores síncronos y sus microtareas hayan terminado.
2. `recover-qa.spec.ts` y `search.spec.ts`: `page.clock.install()` al principio de la prueba y `await page.clock.runFor(2_500)` / `runFor(1_000)` en lugar de la espera.
3. `links-qa.spec.ts` y `save-qa.spec.ts`: `await settle(page)` en lugar de la espera (los eventos que no deben ocurrir se lanzarían en el propio manejador del clic o de la tecla).
4. `eslint.config.js`: bloque `{ files: ['apps/*/tests/e2e/**/*.ts'], rules: { 'no-restricted-properties': ['error', { property: 'waitForTimeout', message: 'Espera a una condición (expect, page.clock o settle), no a un tiempo fijo.' }] } }`.

## Criterios de aceptación
- [ ] `grep -rn "waitForTimeout" apps/lector-pdf/tests/e2e` sin resultados.
- [ ] Añadir temporalmente `await page.waitForTimeout(1)` en una spec hace fallar `pnpm lint` con el mensaje de la regla (comprobarlo y quitarlo; anotarlo en el Registro).
- [ ] Las 4 pruebas pasan 10 veces seguidas: `pnpm --filter lector-pdf e2e --project=chromium --repeat-each=10 links-qa.spec.ts recover-qa.spec.ts save-qa.spec.ts search.spec.ts` con código 0.
- [ ] Mutaciones (demuestran que las pruebas siguen detectando el fallo): una mutación temporal que provoque lo que cada prueba prohíbe (descargar al pulsar Ctrl+S sin cambios; escribir borrador sin cambios; seguir buscando tras «Detener»; abrir la URL con Ctrl+clic) hace fallar su prueba. Anotar el resultado de las 4 en el Registro y deshacerlas.
- [ ] `pnpm --filter lector-pdf e2e` completo con código 0; `pnpm lint`, `pnpm typecheck`, `pnpm test` con código 0.

## Fuera de alcance
- Cambiar el comportamiento de la app o los umbrales de rendimiento.

## Registro
<!-- Cada agente añade aquí su entrada al terminar; no borrar las anteriores. -->
