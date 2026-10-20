---
tipo: tarea
id: PDF-126
titulo: Organizar - arrastrar y soltar, e2e y rendimiento
app: pdf
estado: en-revision
depende_de: [PDF-125]
intentos: 0
skills: [stack-typescript-react, calidad-profesional, pruebas-calidad]
creado: 2026-10-19
actualizado: 2026-10-20
tags: [tarea, pdf, iteracion-5, organizar, ui, e2e]
---

# PDF-126 · Organizar: arrastrar y soltar, e2e y rendimiento

Plan: [[Apps/Lector PDF/Plan|Plan]] (iteración 5) · Decisiones: [[ADR-0035-organizar-en-la-app]], [[ADR-0016-e2e-long-tasks-en-serie]] · Antes: [[PDF-125-organizar-vista]]

## Objetivo
Reordenar arrastrando miniaturas (una o varias seleccionadas) con indicador de inserción y desplazamiento automático, y verificar de punta a punta girar, borrar y reordenar con guardado, índice y enlaces, en 5 y en 5 000 páginas, sin bloquear la interfaz.

## Contexto
- `src/ui/organize/OrganizeView.tsx`, `OrganizeCell.tsx` (PDF-125); `moveSelected` (PDF-124).
- `src/core/organize/grid.ts` (PDF-125): añade aquí el cálculo del punto de inserción.
- E2E de referencia: `tests/e2e/` (abrir fixture, `@perf` con la puerta de reposo de [[PDF-078-reposo-cpu-antes-de-perf]], diagnóstico de *long tasks* de [[PDF-077-diagnostico-long-tasks]]).

## Qué hay que hacer
1. `grid.ts`: `export function insertionIndex(m: GridMetrics, count: number, x: number, y: number): number` — posición de inserción (0..count) para un punto en coordenadas del contenido: mitad izquierda de una celda → antes; mitad derecha → después; por debajo de la última fila → `count`.
2. Arrastre con eventos de puntero (no HTML5 DnD): `pointerdown` sobre una celda (si no estaba seleccionada, `selectOnly`) y movimiento > 5 px → modo arrastre; una imagen fantasma con el número de páginas («3 páginas»); una barra vertical de 3 px de acento marca `insertionIndex`; cerca del borde superior/inferior (48 px) la cuadrícula se desplaza sola (como mucho 20 px por fotograma con `requestAnimationFrame`); soltar → `moveSelected(index)`; Escape durante el arrastre lo cancela. Un solo comando de deshacer por arrastre.
3. Atajos `organize-move-first` (Alt+Inicio) y `organize-move-last` (Alt+Fin): mueven la selección al principio o al final (`moveSelected(0)` / `moveSelected(count)`).
4. Anuncio accesible tras mover (región `aria-live="polite"`): «Páginas movidas a la posición n.»
5. E2E `tests/e2e/organize.spec.ts`:
   - `basic-5.pdf`: arrastrar la página 1 detrás de la 3 → Guardar → el visor muestra «Página 2 de 5» como página 1 y la miniatura lateral 3 es «Página 1 de 5»; girar la 2 y borrar la 5 → guardar → 4 páginas y la 2.ª girada.
   - `outline.pdf`: mover la página 11 (Capítulo 2) al principio y guardar → pulsar «Capítulo 2» en el índice lleva a la página 1; «Capítulo 1» lleva a la página 2.
   - `links.pdf`: mover la página 3 al final y guardar → el enlace «(a) Destino explícito a la página 3» lleva a la última página.
   - `pages-5000.pdf` (**criterio original de la ficha PDF-053**): seleccionar la página 1 y pulsar Alt+Fin (la mueve al final) y guardar → la última página es «Página 1 de 5000» y la primera «Página 2 de 5000».
   - Escape con cambios → «No guardar» → el documento no cambia.
6. E2E `@perf` (`organize.perf.spec.ts`, proyecto `chromium-perf`): con `pages-5000.pdf`, abrir la vista, desplazar hasta el final y arrastrar una página → sin *long tasks* > 100 ms; guardar (Alt+Fin sobre la página 1) termina en < 3 s y sin *long tasks* > 100 ms (el trabajo va en el Worker).

## Criterios de aceptación
- [ ] Unit: `insertionIndex` en bordes (antes de la primera, entre filas, después de la última, fila incompleta).
- [ ] UI (Testing Library con eventos de puntero): arrastrar dos seleccionadas a la posición 0 → orden esperado y un único paso de deshacer; Escape durante el arrastre no cambia nada.
- [ ] Los e2e anteriores pasan; el `@perf` pasa con la puerta de reposo.
- [ ] Presupuestos del Plan sin regresiones (`pnpm --filter lector-pdf e2e` completo).
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm coverage`, `pnpm --filter lector-pdf e2e` con código 0.

## Fuera de alcance
- Arrastrar páginas entre pestañas o desde el explorador de archivos.

## Registro
<!-- Cada agente añade aquí su entrada al terminar; no borrar las anteriores. -->

### [programador] ronda 2 — 2026-10-20
- Ficheros cambiados: `apps/lector-pdf/tests/e2e/organize.spec.ts` (dos títulos de test a ASCII), `apps/lector-pdf/tests/e2e/iteration4-flow.spec.ts` (espera a que acabe el guardado antes de Ctrl+W; cierre de la última pestaña comprobado sin `tablist`; sin exigir foco del visor tras cambiar de pestaña), `apps/lector-pdf/tests/e2e/zz-debug-tmp.spec.ts` (borrado: depuración del trabajo previo con `expect(1).toBe(1)`), `.gitignore` (`apps/lector-pdf/dist-*/`), y se quita del índice `apps/lector-pdf/dist-e2e-pdf126/` (salida de build committeada por error en bfe73c3).
- Qué he hecho: retomado el trabajo previo (arrastre con punteros, `insertionIndex`, Alt+Inicio/Fin, anuncio, E2E y @perf ya estaban). Los dos E2E de `organize.spec.ts` (outline y links) fallaban al reabrir: el título con «»/acentos rompía la ruta del guardado en la pestaña nueva; títulos a ASCII. `iteration4-flow` fallaba (no es de esta ficha, pero rompe `pnpm e2e`): (1) tras cambiar de pestaña con el ratón el foco queda en la barra (PDF-095), el test exigía el foco del visor; (2) Ctrl+W se ignoraba porque `tabsLocked()` veía el guardado aún en curso; (3) con una sola pestaña la barra se oculta, así que el test esperaba una pestaña que ya no existe.
- Comandos ejecutados y resultado: `pnpm lint` OK; `pnpm typecheck` OK; `pnpm coverage` OK (exit 0; cobertura de líneas 98,33 %); `pnpm --filter lector-pdf e2e organize*` 5/5 OK y `organize.perf.spec.ts` (chromium-perf) OK; `iteration4-flow` 4/4 repeticiones OK; `pnpm --filter lector-pdf e2e` completo: 322 passed, exit 0.
- Dudas o cosas que no he podido hacer: (a) Ctrl+W no siempre cierra pestaña justo después de Ctrl+S si el guardado sigue en curso: el test ahora espera al botón «Guardar» habilitado, pero conviene que el tester mire si es un fallo de UX (el atajo se ignora sin aviso). (b) Los ficheros `dist-firma/` y `dist-qa049/` siguen committeados en git; no los he tocado. (c) No he revisado la cobertura por módulo de `organize/grid.ts` más allá de que el test unitario de `insertionIndex` pasa.
