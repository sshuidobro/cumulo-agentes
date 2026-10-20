---
tipo: tarea
id: PDF-141
titulo: Diagnosticar y arreglar los E2E rojos e intermitentes de HEAD
app: pdf
estado: en-curso
depende_de: []
intentos: 0
skills: [pruebas-calidad, stack-typescript-react]
creado: 2026-10-19
actualizado: 2026-10-20
tags: [tarea, e2e, calidad]
---

# PDF-141 · Diagnosticar y arreglar los E2E rojos e intermitentes de HEAD

Plan: [[Apps/Lector PDF/Plan|Plan]] · Decisiones: [[ADR-0016-e2e-long-tasks-en-serie]], [[ADR-0012-suite-de-rendimiento]] · Relacionadas: [[PDF-116-hilos-en-el-panel]], [[PDF-078-reposo-cpu-antes-de-perf]]

## Objetivo
Que toda la suite E2E del lector pase en HEAD de forma estable, encontrando la causa real de cada fallo y arreglándola (en el código de la app si es un fallo de producto, en la prueba solo si la prueba está mal), **sin desactivar, saltar ni relajar** ninguna prueba.

## Contexto
Los testers de otras fichas reportan fallos ajenos a sus cambios:

| Prueba (fichero:línea del `test`) | Síntoma | Tipo |
|---|---|---|
| `apps/lector-pdf/tests/e2e/annotations-flow.spec.ts:94` | Tras reabrir el PDF guardado, F4 no abre el panel «Comentarios» | rojo siempre |
| `apps/lector-pdf/tests/e2e/annotations-foreign.spec.ts:72` | Igual: tras reabrir, F4 no abre «Comentarios» | rojo siempre |
| `apps/lector-pdf/tests/e2e/notes.spec.ts:91` | Falla en HEAD (ventana de nota: Tab, Borrar, Cerrar) | rojo siempre |
| `apps/lector-pdf/tests/e2e/performance.spec.ts:72` | Intermitente bajo carga | flaky |
| `apps/lector-pdf/tests/e2e/render.spec.ts:70` | Intermitente bajo carga | flaky |
| `apps/lector-pdf/tests/e2e/outline.spec.ts:64` | Intermitente bajo carga | flaky |

- Sospechoso principal de los tres rojos: el commit `27a0348` (PDF-116, respuestas y estados en el panel de comentarios). Revisar con `git show 27a0348 --stat` y comparar con el padre.
- Atajo F4: `apps/lector-pdf/src/ui/shortcuts.ts` → entrada `toggle-sidebar` (línea ~71) y quién la consume (`node scripts/indice-codigo.mjs apps/lector-pdf/src --buscar toggleSidebar`).
- Ayudas compartidas de E2E: `apps/lector-pdf/tests/e2e/helpers.ts`, `annotations-kit.ts` (`openInNewPage`), `perf-fixture.ts`, `cpu-usage.ts`.
- Configuración: `apps/lector-pdf/playwright.config.ts` (timeout 60 s, `expect` 10 s, 2 workers, `retries: 0`; proyecto `chromium-perf` en serie).
- Comandos E2E y reglas de repetición: sección «Comandos» del Plan.

## Qué hay que hacer
1. Reproducir cada prueba aislada: `pnpm --filter lector-pdf e2e <fichero>:<línea>`. Guardar traza (`--trace on`) y anotar en el Registro el paso exacto que falla y el mensaje.
2. Rojos (flow, foreign, notes): bisecar con `git bisect run` sobre el comando de la prueba (empezar en `27a0348^` como bueno si pasa). Identificar la causa (p. ej. foco atrapado en un elemento que consume F4, panel que no se monta tras reabrir, cambio de nombre accesible, cambio de orden de Tab por los controles de respuesta de PDF-116).
   - Si es fallo de producto: arreglar la app. F4 debe abrir/cerrar la barra lateral también tras reabrir un documento guardado, con el foco en el visor o en cualquier control que no sea un campo de texto.
   - Si la prueba describe un comportamiento que ha cambiado a propósito (decisión de PDF-116 documentada en su ficha), actualizar la prueba al nuevo comportamiento manteniendo la misma comprobación de fondo, y citar la decisión en el Registro.
3. Intermitentes (performance:72, render:70, outline:64): repetir con `--repeat-each=20` con 2 workers y con carga (lanzar a la vez la suite completa `chromium`). Distinguir:
   - Espera frágil (aserción sin `expect.poll`/`toBeVisible`, condición de carrera en la prueba): corregir la espera para que observe el estado real (`data-rendered`, rol, texto).
   - Presupuesto de tiempo medido con la máquina cargada: la prueba debe llevar `{ tag: '@perf' }` y correr en `chromium-perf` con espera de reposo ([[ADR-0016-e2e-long-tasks-en-serie]]). **No** subir los presupuestos del Plan ni los timeouts de Playwright.
   - Fallo real de la app (render perdido, índice que no llega): arreglar la app.
4. Si el arreglo afecta a la app, añadir una prueba unitaria o de UI (Vitest + Testing Library) que reproduzca el fallo sin Playwright.

## Criterios de aceptación
- [ ] `pnpm --filter lector-pdf e2e annotations-flow.spec.ts annotations-foreign.spec.ts notes.spec.ts` pasa.
- [ ] `pnpm --filter lector-pdf e2e performance.spec.ts render.spec.ts outline.spec.ts --project=chromium --repeat-each=20` pasa 20/20 (y, si alguna se mueve a `@perf`, `--project=chromium-perf --no-deps --repeat-each=10` pasa 10/10).
- [ ] `pnpm --filter lector-pdf e2e` completo en verde dos veces seguidas.
- [ ] Ningún `test.skip`, `test.fixme`, `.only`, `retries` > 0, timeout o presupuesto aumentado: `git diff HEAD -- apps/lector-pdf | grep -nE "skip|fixme|\.only|retries|timeout"` no muestra líneas añadidas que relajen pruebas.
- [ ] F4 abre y cierra la barra lateral con teclado tras reabrir un PDF guardado (calidad profesional: atajo estándar usable con teclado).
- [ ] En el Registro: causa raíz de cada una de las seis pruebas y el arreglo aplicado.
- [ ] `pnpm lint && pnpm typecheck && pnpm coverage` sin errores.

## Fuera de alcance
- Funciones nuevas o cambios de diseño del panel de comentarios.
- Cambiar presupuestos del Plan, `retries` o timeouts globales de Playwright.
- Otras pruebas E2E que no estén en la tabla (si aparecen más rojos, anotarlos en el Registro para una ficha aparte).

## Registro
<!-- Cada agente añade aquí su entrada al terminar; no borrar las anteriores. -->
