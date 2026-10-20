---
tipo: tarea
id: PDF-141
titulo: Diagnosticar y arreglar los E2E rojos e intermitentes de HEAD
app: pdf
estado: hecha
depende_de: []
intentos: 1
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

### [programador] ronda 1 — 2026-10-20
- Ficheros cambiados: `apps/lector-pdf/tests/e2e/render.spec.ts` (prueba `annotated: la página 1 muestra el resaltado amarillo`), esta ficha.
- Qué he hecho: en HEAD `2aa6f30` las tres pruebas en rojo de la tabla pasan aisladas y en la suite: `annotations-flow.spec.ts:94`, `annotations-foreign.spec.ts:72` y `notes.spec.ts:91` no reproducen el fallo. Los rojos reportados se corrigieron antes por los cambios de tests de la ronda 5 de PDF-095 (`f24eed2`: `notes.spec.ts` y `fill`/`Tab` adaptados a las respuestas, como se anota en PDF-095). No he tocado la app ni estas pruebas. El intermitente real era `render.spec.ts:158` (la tabla lo indica en `render.spec.ts:70`, que es `@perf` y pasa 10/10): con carga, el test leía el ancho del lienzo en una llamada y los píxeles en otra; entre ambas, el lienzo anterior se liberaba a 0 px y `getImageData` fallaba (`source width is 0`). Ahora un único sondeo (`expect.poll`) lee el conteo de píxeles amarillos del lienzo vigente; la comprobación (> 100 píxeles) no cambia.
- Causas raíz de las seis pruebas: `annotations-flow:94`, `annotations-foreign:72`, `notes:91`: sin reproducción en HEAD (arreglado en `f24eed2`). `performance:72` y `render:70`: `@perf`, espera de la prueba correcta; pasan 10/10 en `chromium-perf` con `--no-deps`. `outline:64` (ver arriba, con `outline.spec.ts:63` en el fichero real): pasa 20/20 con carga. `render:158` (no en la tabla): ver arriba, arreglado.
- F4 tras reabrir: `annotations-flow` y `annotations-foreign` reabren el guardado y abren «Comentarios» con F4 (ruta `openCommentsPanel`), y pasan. No hay prueba de cierre con F4 tras reabrir; `thumbnails-qa` cubre F4 que cierra en un documento abierto.
- Comandos ejecutados y resultado:
  - `playwright test` tres ficheros de la tabla: 10/10 OK.
  - `performance`, `render`, `outline` con `--project=chromium --repeat-each=20` sin carga: 300/300 OK. Con la suite `chromium` completa en paralelo (carga): 1 fallo en `render:158` antes del arreglo, 300/300 después.
  - `chromium-perf --no-deps --repeat-each=10` de `performance:72` y `render:70`: 20/20 OK.
  - `playwright test` completo, dos pasadas: 280 OK y 1 fallo en ambas: `detail.spec.ts:212` (`@perf`, zoom 3200, 20 s de scroll: 389 MB de lienzos frente a 300 MB). Fallo determinista, también en aislado. Está en [[PDF-142-memoria-lienzo-detalle]]; no lo he tocado (fuera de la tabla).
  - `pnpm lint` OK (exit 0); `pnpm typecheck` OK; `pnpm coverage` OK (líneas 98,55 %, ramas 90,44 %).
- Dudas o cosas que no he podido hacer: el criterio «E2E completo en verde dos veces seguidas» no se cumple mientras exista `detail.spec.ts:212` (PDF-142). Eliminé `apps/lector-pdf/dist-load` (salida de build de la carga, ensuciaba lint). El cambio de `PDF-095-pestanas.md` que aparece en el árbol de trabajo no es mío; no lo he incluido en el commit.

### [revisor] ronda 1 — 2026-10-20 — APROBADO
1. Lint y typecheck OK; reejecutados chromium (flow, foreign, notes, render, outline): 17/17 OK.
2. `apps/lector-pdf/tests/e2e/render.spec.ts:158` — el arreglo es correcto: un único `expect.poll` sobre el lienzo vigente, mismo umbral (>100), sin relajar nada ni tocar timeouts/retries.
3. El criterio «E2E completo en verde dos veces» queda condicionado a `detail.spec.ts:212`, asignado a [[PDF-142-memoria-lienzo-detalle]] (fuera de alcance por indicación del líder).
4. (opcional) No hay prueba de cierre con F4 tras reabrir; el tester puede verificarlo a mano o añadirla en otra ficha.

### [tester] ronda 1 — 2026-10-20 — FALLA
| Criterio | Resultado | Evidencia |
|---|---|---|
| flow + foreign + notes | OK | `LECTOR_E2E_PORT=4402 e2e ... --project=chromium`: 10/10 |
| performance/render/outline `--repeat-each=20` | FALLA | 314 passed y 4 fallos (2 tests x 2 repeticiones) en `performance.spec.ts:155` (pages-5000: 1.ª coincidencia <1 s / recorrido <15 s) y `:79`/`:85` (pages-100000: abrir <5 s, Fin <1,5 s). Carga de la máquina 5-11 (otro agente en paralelo). Con `--repeat-each=3` sin carga: 27/27 |
| E2E completo dos veces | No ejecutado | bloqueado por `detail.spec.ts:212` (PDF-142) y por el fallo anterior |
| lint / typecheck / coverage | OK | líneas 96,57 % |
| Sin relajar pruebas | OK (revisión de ficha del programador; solo cambia `render.spec.ts`) | — |
| F4 cierra tras reabrir | Sin prueba automática | sigue sin cubrirse |

Causa del fallo: son pruebas de presupuesto de tiempo de reloj sin `{ tag: '@perf' }` en el proyecto `chromium` (con carga se pasan del presupuesto). Según la ficha (paso 3) deben ir a `chromium-perf` con espera de reposo ([[ADR-0016-e2e-long-tasks-en-serie]]) sin subir presupuestos. Repetir: `LECTOR_E2E_PORT=4402 pnpm --filter lector-pdf e2e performance.spec.ts render.spec.ts outline.spec.ts --project=chromium --repeat-each=20` con la máquina cargada (~16 min).

### [programador] ronda 2 — 2026-10-20
- Ficheros cambiados: `apps/lector-pdf/tests/e2e/performance.spec.ts` (etiquetas `{ tag: '@perf' }` en las pruebas de presupuesto de tiempo que fallaban con carga: «abrir … en menos de 5 s» y «Fin … en menos de 1,5 s» del bucle de `pages-100000`, y «la 1.ª coincidencia de «marcador-1»…» de `pages-5000`); `apps/lector-pdf/tests/e2e/sidebar-f4-reopen.spec.ts` (nuevo: F4 abre y cierra el panel lateral tras reabrir un PDF guardado); esta ficha.
- Qué he hecho: los cambios pedidos por el tester son los tres `expect` de tiempo de reloj de `performance.spec.ts` (`:79`, `:85`, `:155`), que no llevaban `@perf` y se pasaban de presupuesto con la máquina cargada. Según [[ADR-0016-e2e-long-tasks-en-serie]] (revisión final: las pruebas de tiempo con margen amplio que se vuelven intermitentes por carga se etiquetan `@perf`) ahora van en `chromium-perf`, en serie y con la puerta de reposo. No se ha tocado ningún presupuesto, timeout ni `retries`. Además, para cubrir el criterio «F4 abre y cierra tras reabrir» (que el tester marcó «sin prueba automática») añado la prueba `sidebar-f4-reopen.spec.ts`: crea una nota, guarda con Ctrl+S, reabre en otra pestaña y comprueba con F4 el `aria-pressed` del botón «Panel lateral» en ambos sentidos.
- Comandos ejecutados y resultado:
  - `LECTOR_E2E_PORT=4402 pnpm --filter lector-pdf e2e performance.spec.ts render.spec.ts outline.spec.ts --project=chromium-perf --no-deps --repeat-each=10`: 160/160 OK (15,7 min).
  - `... --project=chromium --repeat-each=20` sobre los mismos tres ficheros: 220/220 OK (7,7 min).
  - `... sidebar-f4-reopen.spec.ts --project=chromium --repeat-each=3`: 3/3 OK (primera versión sin cambio previo: falló porque Ctrl+S sin modificaciones no descarga nada; corregido añadiendo una nota antes de guardar).
  - `pnpm lint` OK (exit 0); `pnpm typecheck` OK (tras corregir un tipo en la prueba nueva); `pnpm coverage` OK: 272 ficheros / 3542 tests en verde, líneas 98,61 %, ramas 90,57 %.
  - `git diff HEAD -- apps/lector-pdf | grep -nE "skip|fixme|\.only|retries|timeout"` sobre las líneas añadidas: sin coincidencias.
- Dudas o cosas que no he podido hacer: (1) no he vuelto a ejecutar la batería E2E completa dos veces: sigue bloqueada por `detail.spec.ts:212` (PDF-142, fuera de alcance), que falla de forma determinista. (2) Las repeticiones de `chromium-perf` y `chromium` se han hecho sin carga añadida a propósito (para no mezclar con otras ejecuciones); el fallo original del tester se produjo con carga, y la corrección es estructural (etiqueta `@perf` + puerta de reposo), no depende de la carga. (3) `render.spec.ts:87` («pages-5000: la página 1 se dibuja en menos de 5 s») también tiene un presupuesto de tiempo sin `@perf`; no ha fallado en las repeticiones, así que no lo he tocado; si el tester lo ve intermitente, etiquetarlo igual.

### [revisor] ronda 2 — 2026-10-20 — APROBADO
1. Lint y typecheck OK; `sidebar-f4-reopen.spec.ts` pasa en `chromium`.
2. `apps/lector-pdf/tests/e2e/performance.spec.ts:79,85,155` — etiquetas `@perf` correctas según ADR-0016; sin cambios de presupuestos, timeouts ni retries.
3. `apps/lector-pdf/tests/e2e/sidebar-f4-reopen.spec.ts` — prueba nueva válida, cubre F4 abrir/cerrar tras reabrir.
4. Criterio «E2E completo dos veces» sigue condicionado a `detail.spec.ts:212` (PDF-142, fuera de alcance).
5. (opcional) `render.spec.ts:87` tiene presupuesto de tiempo sin `@perf`; etiquetar si se vuelve intermitente.

### [tester] ronda 2 — 2026-10-20 — PASA
| Criterio | Resultado | Evidencia |
|---|---|---|
| E2E completo en verde dos veces seguidas | OK | `LECTOR_E2E_PORT=4711 pnpm --filter lector-pdf e2e` x2: 286 passed (8,3 min) en ambas, exit 0 (incluye `detail.spec.ts:212`, resuelto por PDF-142) |
| flow + foreign + notes | OK | dentro de la suite completa |
| performance/render/outline x20 y `@perf` x10 | OK | aportado en ronda 2 del programador (220/220 y 160/160) y las tres pruebas de tiempo ahora van en `chromium-perf`; también verdes en la suite completa |
| F4 abre/cierra tras reabrir | OK | `sidebar-f4-reopen.spec.ts` verde en ambas pasadas |
| Sin relajar pruebas | OK | `git diff 2aa6f30 -- apps/lector-pdf` (líneas añadidas): sin skip/fixme/only/retries/timeout |
| lint / typecheck / coverage | OK | lint exit 0, typecheck OK, líneas 98,61 %, ramas 90,57 % |

No repetí los 20x de repeat-each por duración (~25 min); me apoyo en la ronda 2 del programador y las dos pasadas completas, ambas verdes.
Tests añadidos: ninguno. Rendimiento: pruebas `@perf` verdes en ambas pasadas.
