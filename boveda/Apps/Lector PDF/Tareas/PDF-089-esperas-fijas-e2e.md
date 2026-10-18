---
tipo: tarea
id: PDF-089
titulo: Quitar las esperas fijas de las pruebas e2e y prohibirlas con ESLint
app: pdf
estado: hecha
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
2. `recover-qa.spec.ts`: `await page.clock.install()` antes de `page.goto`; tras abrir el documento, `await page.clock.runFor(2_500)` en lugar de la espera (el reloj falso sigue avanzando solo, así que la importación y el visor funcionan; `runFor` dispara el *debounce* de 2 s de forma determinista).
3. `search.spec.ts`, `links-qa.spec.ts` y `save-qa.spec.ts`: `await settle(page)` en lugar de la espera (lo que no debe ocurrir se lanzaría en el propio manejador del clic, de la tecla o en el siguiente lote de búsqueda, que cede con `setTimeout(0)`; en `search.spec.ts` llama a `settle` 3 veces seguidas para cubrir 3 lotes). No uses `page.clock` en `search.spec.ts`: la búsqueda cede el hilo con temporizadores.
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

### [programador] ronda 1 — 2026-10-18
- Ficheros cambiados: `eslint.config.js`; `apps/lector-pdf/tests/e2e/helpers.ts` (`settle`, `draftCount`); `apps/lector-pdf/tests/e2e/recover-qa.spec.ts`, `search.spec.ts`, `links-qa.spec.ts`, `save-qa.spec.ts`. Retomo trabajo parcial sin commitear de una sesión anterior y lo verifico.
- Qué he hecho: `waitForTimeout` eliminado de las 4 pruebas (0 resultados en `apps/lector-pdf/tests/e2e`); `settle` y `page.clock` según la ficha; regla `no-restricted-properties` para `apps/*/tests/e2e/**/*.ts`. En `links-qa.spec.ts` se añade `expect(internals.nth(2)).toBeAttached()` antes del `count()` para que no lea el número de enlaces antes de que la página 1 esté montada (ajuste de determinismo que no estaba en la ficha; ya estaba en el trabajo parcial).
- Comprobación de la regla ESLint: añadido temporalmente `await page.waitForTimeout(1)` en `save-qa.spec.ts`; `eslint` falla con `no-restricted-properties` y el mensaje «Espera a una condición (expect, page.clock o settle), no a un tiempo fijo». Fichero restaurado.
- Mutaciones (cambio temporal en `apps/lector-pdf/src`, restaurado con `git status` limpio):
  - A · Ctrl+S sin cambios descarga: `save-actions.ts` con `if (false)` → falla `save-qa` «Ctrl+S sin cambios»: `downloads` esperado 0, recibido 1.
  - B · borrador sin cambios: `draft-sync.ts` sin la condición `dirty` y `schedule(t)` al adjuntar → falla `recover-qa` «sin cambios no se ofrece»: `draftCount` esperado 0, recibido 1. (Una primera versión que solo quitaba la condición `dirty` pasaba: sin cambios no llegaba a programarse ningún guardado. Por eso la mutación final añade el `schedule`.)
  - C · sigue buscando tras «Detener»: `search-actions.ts` sin `session.cancel()` → falla `search` «Detener…» en `toBeHidden` del botón Detener (la prueba falla antes de llegar a la comparación del estado congelado; detecta el fallo, pero no por la aserción exacta).
  - D · Ctrl+clic abre la URL: `LinkLayer.tsx` abre `window.open` si hay `ctrlKey` → falla `links-qa` «clic de rueda…» en el `toBeVisible` del diálogo (de nuevo, antes de la aserción de `popups`).
- Comandos ejecutados y resultado:
  - `pnpm --filter lector-pdf e2e --project=chromium --repeat-each=10 links-qa.spec.ts recover-qa.spec.ts save-qa.spec.ts search.spec.ts`: 130/130 passed, código 0 (la primera ejecución falló por el puerto 4173 ocupado por otro proceso; se repitió al quedar libre).
  - `pnpm --filter lector-pdf e2e` completo: 170 passed, código 0.
  - `pnpm test` (raíz): 165 ficheros, 1898 tests passed, código 0.
  - `pnpm typecheck`: código 0.
  - `pnpm lint`: **falla**, código 1, por un único error ajeno a esta ficha: `apps/lector-pdf/tests/unit/forms-history-qa.test.ts:29` (`no-non-null-assertion`). Ese fichero no está commiteado y pertenece a otro trabajo (PDF-080). Los ficheros de esta ficha pasan `eslint --max-warnings 0` con código 0. No lo he tocado.
- Dudas o cosas que no he podido hacer: el criterio «`pnpm lint` código 0» no se cumple hasta que se resuelva ese error en `forms-history-qa.test.ts` (y `forms-import-qa.test.ts` / `print-qa.test.ts` sin commitear, que no dan error). Hay que decidir de quién es dejar esos ficheros sin commitear. En las mutaciones C y D el fallo se produce en la primera aserción, no en la que da nombre a la prueba; cumple «hace fallar», pero conviene que el tester lo vea.

### [revisor] ronda 1 — 2026-10-18 — APROBADO
1. Verificado: 0 `waitForTimeout` en `apps/*/tests/e2e`; `settle`, `page.clock` y regla ESLint según la ficha; `pnpm lint` (raíz) con código 0 (el error ajeno de PDF-080 ya no está); las 4 specs pasan (`--repeat-each=3`, 39/39).
2. (opcional) Mutaciones C y D fallan en una aserción previa a la que da nombre a la prueba; el tester puede confirmar que las aserciones finales (estado congelado, `popups`) son alcanzables.

### [tester] ronda 1 — 2026-10-18 — PASA
Alcance acotado por encargo (otros agentes compilan): solo las 4 specs; lint/typecheck/test globales los verificó el revisor (lint raíz 0).
| Criterio | Resultado | Evidencia |
|---|---|---|
| Sin `waitForTimeout` | OK | `grep -rn waitForTimeout apps/lector-pdf/tests/e2e` sin salida |
| Specs estables | OK | `e2e --project=chromium --repeat-each=3` de las 4 specs: 39 passed (programador: 130/130 con x10) |
| Mutación C (aserción final alcanzable) | OK | La mutación del programador (quitar `session.cancel()`) falla antes en `toBeHidden`. Nueva mutación: `cancelSearch` cancela pero un `setInterval` de 10 ms sigue incrementando `total`; falla en `search.spec.ts:201` (`toBe(frozen)`, esperado «1 de 125», recibido «1 de 141») tras los 3 `settle`. |
| Mutación D (aserción final alcanzable) | OK | `LinkLayer.tsx`: `if (event.ctrlKey) window.open(url,'_blank')` además del diálogo; falla en `links-qa.spec.ts:52` (`opened(page)` recibe `["https://example.org/ruta?x=1","_blank"]`). La línea 51 (`popups`) no detecta `window.open` simulado (el espía `opened` sí); ambas son alcanzables. |
| Restauración | OK | `git checkout` de `search-actions.ts` y `LinkLayer.tsx`; `git status` sin cambios en esos ficheros |
Tests añadidos: ninguno (las mutaciones demuestran que los existentes cubren el criterio). Rendimiento: no aplica.
Nota: `settle` cubre ~50 ms por llamada (2 rAF); una mutación con un temporizador único de 20 ms pasa porque se dispara antes de leer `frozen`, no es un hueco real del criterio.
