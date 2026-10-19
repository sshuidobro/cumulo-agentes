---
tipo: tarea
id: PDF-090
titulo: E2E, accesibilidad, interoperabilidad y rendimiento de la iteración 3
app: pdf
estado: en-curso
depende_de: [PDF-083, PDF-043, PDF-044, PDF-088, PDF-089, PDF-105]
intentos: 1
skills: [pruebas-calidad, calidad-profesional]
creado: 2026-10-18
actualizado: 2026-10-19
tags: [tarea, pdf, iteracion-3, e2e, rendimiento]
---

# PDF-090 · E2E, accesibilidad, interoperabilidad y rendimiento de la iteración 3

Plan: [[Apps/Lector PDF/Plan|Plan]] (iteración 3) · Decisiones: [[ADR-0016-e2e-long-tasks-en-serie]] · [[ADR-0019-formularios-acroform]] · [[ADR-0020-firma-visual]] · [[ADR-0021-impresion]] · [[ADR-0027-dialogos-diferidos]]

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

### [programador] ronda 1 — 2026-10-19
- Ficheros cambiados: `.gitignore` y `eslint.config.mjs` (ignorar `apps/lector-pdf/dist-pdf090/`); se quita del índice el `dist-pdf090/` (salida de build de una sesión anterior, 222 ficheros, que lint analizaba y daba 9 628 errores); esta ficha. Los tres specs `tests/e2e/iteration3-{flow,performance,a11y}.spec.ts` ya estaban en el repo y no se han modificado (pasan tal cual). `interop-samples/` regenerado con `interop:samples`.
- Qué he hecho: revisado los tres specs (imports y helpers existen); lint y typecheck en verde; batería e2e completa, `iteration3-flow` y `iteration3-a11y` en verde. `interop:samples` escribe las 5 muestras y `qpdf --check` da 0 en todas; `firmado.pdf` tiene 2 `/Stamp` (dibujada + imagen). Batería repetida: chromium ×3 verde (582/582); chromium-perf ×3 con 2 fallos (ver abajo).
- Comandos ejecutados y resultado:
  - `pnpm lint` → 0 (tras lo de arriba). `pnpm --filter lector-pdf typecheck` → 0.
  - `pnpm --filter lector-pdf e2e` → 0 (206 passed).
  - `e2e --project=chromium --repeat-each=3` → 0 (582 passed).
  - `e2e --project=chromium-perf --no-deps --repeat-each=3` → **1** (34 passed, 2 failed): `ink.spec.ts:141` «dibujar un trazo de 2 000 eventos no produce long tasks @perf» (no es de esta ficha; PDF-035) falla en 2 de 3 repeticiones con una long task de 55 ms y otra de 68 ms (su `expect` exige cero entradas del observador, que cuenta desde 50 ms). En la 1.ª repetición pasó con una de 52 ms. Los 3 iteration3 perf pasan ×3.
  - `pnpm perf` → 0 (29 tests). `pnpm coverage` → 0 (197 ficheros, 2 374 tests; líneas 98,65 %).
  - `pnpm --filter lector-pdf build` → **1**: `bundle:check` marca 500 004 bytes de arranque (máximo 500 000; 4 bytes de exceso). El código de la app no lo he tocado.
  - `qpdf --check` → 0 en `impresion-pagina-1.pdf`, `form-full-iteracion-3.pdf` y `form-full-medido.pdf` (los tests lo comprueban) y en las 5 muestras de `interop-samples/`.
- Medidas (en ms salvo indicación; 3 repeticiones):

| Medida | Presupuesto | Valor ×3 |
|---|---|---|
| (a) long tasks al abrir y rellenar 10 campos (`form-full`) | ≤ 100 ms por tarea | 0, 0, 1 tarea de 61 ms |
| (b) guardar formularios `form-full` (Ctrl+S → descarga) | < 1 000 | 58, 62, 64 |
| (c) imprimir 20 páginas de `pages-5000` | < 20 000 | 993, 996, 978 |
| (c) long tasks al imprimir 20 páginas | ≤ 100 | 0, 0, 0 |
| Abrir `basic-5` hasta página 1 | < 1 000 | 507, 532, 494 |
| Abrir `pages-5000` hasta página 1 | < 5 000 | 532, 521, 492 |
| Abrir `pages-100000` hasta página 1 | < 5 000 | 1 017, 1 028, 969 |
| Fin en `pages-5000` / `pages-100000` (página dibujada) | < 1 500 | 131/82, 105/136, 83/84 |
| Lienzos y marcos máx. (5 000 y 100 000) | ≤ 12 | 4 y 4 |
| Heap JS tras 30 saltos en `pages-5000` | < 400 MB | 11,3 MB |
| Búsqueda «marcador-1» en 5 000 páginas (1.ª / completa) | — | 468/2273, 478/3265, 433/1703 |
| Escaneo completo `pages-5000` (PDF-039) | < 10 000 | 1 669, 2 672, 2 729 |
| Guardar 10 anotaciones en `pages-5000` (PDF-039) | < 1 000 | 117, 130, 147 |
| Crecimiento del fichero por 10 anotaciones (PDF-039) | < 51 200 bytes | 9 077 (×3) |
| Detener la búsqueda (PDF-039) | < 200 | 57, 59, 68 |

- Accesibilidad: `iteration3-a11y` 8/8 en verde (claro y oscuro, las 4 vistas), con 0 `serious`/`critical`.
- Dudas o cosas que no he podido hacer:
  1. **Ficha no cumplida, bloqueo para el líder.** (a) `ink.spec.ts` @perf falla de forma intermitente (2 de 3); decisión pendiente: subir el umbral de esa prueba a 100 ms (el presupuesto de la iteración) o investigar la tarea de 55-68 ms. No la he tocado. (b) El arranque pesa 4 bytes por encima del presupuesto; hace falta recortar código o subir el máximo de `bundle:check`, decisión del líder.
  2. Lista manual para Adobe (el líder la copia al Manual). Ficheros en `apps/lector-pdf/interop-samples/` (no versionados):
     - `formulario-relleno.pdf`: `form-full.pdf` con nombre «María José», acepto marcado, color «Azul», país «pt». Comprobar que los campos muestran esos valores y que no aparece ninguna anotación.
     - `firmado.pdf`: sobre `basic-5.pdf`, p1, una firma dibujada (zigzag) y una firma de imagen PNG 40×20 roja. Comprobar que se ven como sellos, sin alterar la página.
     - `estandar-basic-5.pdf`, `estandar-annotated.pdf`, `estandar-form.pdf`: conjunto estándar de anotaciones con fechas fijas (2026-10-18). Comprobar que Adobe lista las anotaciones y que el formulario tiene sus campos.
  3. Lo de Adobe real queda fuera de alcance, lo hace el usuario con la lista.
- Nota: la ficha queda en `en-revision` por petición de la sesión, con el lint y la build en rojo por lo indicado arriba; no debe pasar a `hecha` sin resolver 1.a y 1.b.

### [revisor] ronda 1 — 2026-10-19 — CAMBIOS
1. Criterio «chromium-perf ×3 con código 0» incumplido: `apps/lector-pdf/tests/e2e/ink.spec.ts:141` (PDF-035) falla 2 de 3 con long tasks de 55-68 ms (el observador cuenta desde 50 ms) — decidir y aplicar: estabilizar la prueba (p. ej. umbral de 100 ms = presupuesto de la iteración, documentado) o eliminar la causa. La ficha exige la repetición ×3 en verde y no lo excluye.
2. Criterio «`pnpm --filter lector-pdf build` con código 0 (bundle:check ≤ 500 000)» incumplido: arranque = 500 004 bytes — recortar al menos 4 bytes del arranque (preferible, con margen) o que el líder decida subir el máximo con ADR.
3. Los tres specs no se han modificado en esta ronda y la evidencia (tabla, a11y 8/8, qpdf 0, muestras) es aceptable; no hay otros problemas. Tras 1 y 2, repetir lint, build y las dos baterías ×3 y registrar los valores.

### [lider] replanificación — 2026-10-19
Decisiones (no se sube ningún umbral ni presupuesto):

**A. Bundle (500 004 > 500 000)** → [[ADR-0027-dialogos-diferidos]]. Cargar bajo demanda los tres diálogos:
1. `src/ui/App.tsx:16,18,138-139`: quitar los imports estáticos de `PropertiesDialog` y `PrintDialog`. Declarar a nivel de módulo
   `const PropertiesDialog = lazy(() => import('./properties/PropertiesDialog').then((m) => ({ default: m.PropertiesDialog })));` (igual para `PrintDialog` desde `./print/PrintDialog`). Leer `usePropertiesDialog((s) => s.open)` y `usePrintDialog((s) => s.open)` en `App` y renderizar `{propertiesOpen && <Suspense fallback={null}><PropertiesDialog /></Suspense>}` (ídem impresión). `PrintProgress` y `PrintContainer` se quedan estáticos.
2. `src/ui/signature/SignatureMenu.tsx:8,34-41`: mismo patrón con `SignatureDialog`; renderizar solo si `creating` (mantener `open={creating}` en las props).
3. Los tests de componente que abran estos diálogos pasan a esperar con `findBy*`/`await waitFor` (no se borra ninguno ni se relaja ninguna aserción).
4. Comprobar: `pnpm --filter lector-pdf build` → 0 y la línea «Arranque: N bytes» con **N ≤ 485 000**; anotar N en el Registro. Si N > 485 000, no tocar el presupuesto: escalar al líder con la lista de los 10 módulos más grandes del `index-*.js.map`.

**B. `ink.spec.ts:141` (55-68 ms)** → regla de [[ADR-0016-e2e-long-tasks-en-serie]] (revisión 2): se diagnostica, el umbral de 50 ms no cambia.
1. Repetir solo esa prueba con la máquina en reposo: `pnpm --filter lector-pdf e2e --project=chromium-perf --no-deps --repeat-each=5 -g "2 000 eventos"`. Anotar de cada repetición los adjuntos de `perf-fixture` (duración e instante de cada *long task*, `reposo-cpu`, `cpu-durante`).
2. Si `cpu-durante` supera claramente la referencia de [[PDF-078-reposo-cpu-antes-de-perf]] → es la máquina: buscar el intruso en `top`, repetir sin él y registrar. Sin cambios de código.
3. Si la *long task* cae **al soltar** (instante ≈ `mouse.up`) con CPU normal → regresión de la app (el diagnóstico de ADR-0016 medía 9-11 ms al soltar). Arreglo fijado: en `src/ui/viewer/AnnotationLayer.tsx` → `endInk`, envolver la llamada `addAnnotation(newInkAnnotation({...}))` en `startTransition(() => { ... })` (import de `react`) para que React trocee el render en vez de hacerlo en una tarea. `clearInk()` y `simplifyPath` se quedan fuera, igual que ahora.
4. Si cae **durante el trazo** → escalar al líder con la traza (no tocar la vista previa de [[ADR-0018-vista-previa-del-trazo-en-canvas]] sin ficha).
5. Si cae **antes del primer movimiento** (trabajo diferido de la apertura) → en la prueba, añadir justo antes de `clearLongTasks(page)` (línea 150) `await expect(pageFrame(page, 1).locator('.textLayer span').first()).toBeAttached();` y `await settle(page);` (`settle` de `helpers.ts:138`). Ni el trazo ni el `expect(...).toEqual([])` cambian.
6. Criterio: 5/5 en verde en el paso 1 y luego las dos baterías ×3 del punto 5 de la ficha con código 0.

Luego repetir lint, typecheck, test, coverage, perf, build y las dos baterías ×3; actualizar la tabla de medidas. `intentos` se mantiene (el bloqueo no era del programador).

### [programador] ronda 2 — 2026-10-19
- Ficheros cambiados: `apps/lector-pdf/src/ui/App.tsx` y `apps/lector-pdf/src/ui/signature/SignatureMenu.tsx` (diálogos de Propiedades, Imprimir y Crear firma cargados con `lazy` + `Suspense`, según ADR-0027). `tests/e2e/ink.spec.ts` se ha tocado solo para diagnosticar y está restaurado (sin cambios en git). Esta ficha.
- Qué he hecho: (A) diálogos diferidos, arranque ya en 486 857 bytes (≤ 500 000, pero **por encima de los 485 000 pedidos**, no sigo: escalo). (B) diagnóstico de `ink.spec.ts:141` con 10 repeticiones (ver abajo): no es regresión en `AnnotationLayer` al soltar; no he aplicado el arreglo del paso 3 porque la long task cae durante el trazo (paso 4: escalo).
- Comandos ejecutados y resultado:
  - `pnpm lint` → 0. `pnpm --filter lector-pdf typecheck` → 0.
  - `pnpm coverage` → 0 (197 ficheros, 2 374 tests; líneas 98,65 %).
  - `pnpm --filter lector-pdf build` → 0; `Arranque: 486857 bytes en 11 ficheros JS (máximo 500000)`.
  - `e2e --project=chromium` sobre `print`, `properties`, `signature`, `iteration3-flow`, `iteration3-a11y` → 0 (32 passed; los diálogos diferidos funcionan en navegador).
  - `e2e --project=chromium-perf --no-deps --repeat-each=5 -g "2 000 eventos"` (×3 lanzamientos, sin cambios de código entre ellos): 4/5 y 5/5 y 5/5 en el primer, segundo y tercero, con 2 fallos en 15 repeticiones en total. No he ejecutado las dos baterías ×3 completas: la prueba no es estable todavía.
  - Diagnóstico (`reposo-cpu` 0–2 %, `cpu-durante` 28–29 % de 4 núcleos en **todas** las repeticiones, falladas o no; no es la máquina). Fallo con timestamps (run 1, repetición 1): long task de 51 ms @ 33 430 ms; el trazo va de `mouse.down` ≈ 850 ms a `mouse.up` ≈ 34 250–34 600 ms: cae **durante el trazo**. En el otro fallo (run 2, repetición 4) la long task de 62 ms cae dentro de la ventana del trazo, pero no registré su instante. Las long tasks de 51–52 ms al inicio (≈ 75 ms) no entran en la ventana medida.
- Medidas: no se han repetido las medidas (a)–(c) ni los presupuestos del Plan en esta ronda; la tabla de la ronda 1 sigue vigente para el código anterior a la ronda 2.
- Dudas o cosas que no he podido hacer (para el líder):
  1. **Bundle (A).** 486 857 > 485 000. Los 11 ficheros del arranque: `index` 330 477; `PrintDialog.module` 62 534 (estático: lo importa `PrintProgress.tsx` desde `PrintDialog.module.css`, sin verificar qué código arrastra); `engine` 53 050; `Dialog` 28 314; `ink-preview` 3 589; `notice` 3 463; `preload-helper` 1 534; `prefs` 1 393; `properties-store` 1 390; `rolldown-runtime` 599; `logger` 514. Los 10 módulos más grandes del `index` (por fuente): `react-dom` (625 168 caracteres de fuente), `AnnotationLayer.tsx` 28 536, `Viewer.tsx` 16 800, `CommentsPanel.tsx` 15 734, `FormLayer.tsx` 14 859, `comment-list.ts` 11 210, `layout.ts` 10 891, `CommentToolbar.tsx` 10 377, `scheduler` 10 181, `MainToolbar.tsx` 8 206. Decidir: recortar el arranque (p. ej. el 62 KB de `PrintDialog.module`) o subir el margen con ADR.
  2. **Ink (B), paso 4.** La long task cae durante el trazo, no al soltar. Escalo: decidir si se aísla el coste del trazo (ADR-0018 sin ficha) o se acepta el umbral de 100 ms de la iteración con ADR. No he tocado `AnnotationLayer.tsx` ni el umbral. La traza de la repetición fallida no se ha conservado (las ejecuciones siguientes borraron `test-results/`).
  3. Por lo anterior, la ficha sigue sin cumplir: `chromium-perf ×3` y `build` con el margen pedido. Dejo `en-revision` y no la paso a `hecha`.

### [lider] replanificación 2 — 2026-10-19
Estado → `pendiente`. `intentos` se mantiene (escalado correcto, no es fallo del programador).

**A. Bundle: cerrado, sin trabajo.** 486 857 ≤ 500 000 cumple el criterio de la ficha; los 485 000 eran un margen interno. Anotado en [[ADR-0027-dialogos-diferidos]] (revisión). No tocar `App.tsx`, `SignatureMenu.tsx` ni el presupuesto.

**B. `ink.spec.ts` «2 000 eventos»** → [[ADR-0016-e2e-long-tasks-en-serie]] (revisión 3): el umbral no cambia; atribuir y corregir.
1. Diagnóstico (no se versiona; al acabar `git diff tests/` debe salir vacío). En la prueba, envolver solo `mouse.down`…`mouse.up` con
   `await page.context().browser()!.startTracing(page, { path: test.info().outputPath('ink-trace.json'), categories: ['devtools.timeline','disabled-by-default-devtools.timeline','disabled-by-default-v8.cpu_profiler','v8.gc'] })` y `await page.context().browser()!.stopTracing()`. Lanzar `pnpm --filter lector-pdf e2e --project=chromium-perf --no-deps --repeat-each=5 -g "2 000 eventos"` hasta tener **un fallo**; copiar su `ink-trace.json` al scratchpad antes de relanzar.
2. En la traza, buscar en el hilo principal del renderer el `RunTask` ≥ 50 ms y anotar en el Registro sus 5 hijos de más duración (nombre, ms) y, si hay, las funciones JS con más tiempo propio.
3. Según el hijo dominante:
   - **GC** (`MajorGC`, `V8.GC_MARK_COMPACTOR`, `V8.GCFinalizeMC*` ≥ 30 ms) → quitar asignaciones por evento en `src/ui/viewer/AnnotationLayer.tsx` → `addInkSample`:
     - En `ink-preview.ts` añadir `export function invertTransform(t: readonly number[]): readonly [number, number, number, number, number, number]` (det = a·d − b·c; resultado `[d/det, −b/det, −c/det, a/det, (c·f − d·e)/det, (b·e − a·f)/det]`) con test unitario: para el `transform` de un viewport con rotación 0 y 90, aplicar `t` y luego la inversa devuelve el punto (±1e-9).
     - `InkStroke` gana `bounds: readonly [number, number, number, number]` (= `pageBoundsPt()` en `beginInk`) e `inv` (= `invertTransform(viewport.transform)` en `beginInk`). `addInkSample` calcula `u = clientX − box.left`, `v = clientY − box.top`, `x = inv[0]·u + inv[2]·v + inv[4]`, `y = inv[1]·u + inv[3]·v + inv[5]` y recorta con `stroke.bounds`, sin crear arrays. Mismo resultado que `convertToPdfPoint` (lo cubren las pruebas de posición de `ink.spec.ts`).
   - **Cualquier otro** (render de React, `Paint`/`Layout`/raster, pdf.js, tarea sin código de la app) → no cambiar código: escalar al líder con lo del paso 2 y la ruta de la traza.
4. Tras el arreglo: 3 lanzamientos de `--repeat-each=5 -g "2 000 eventos"` → 15/15 en verde. Luego todo el punto 5 de la ficha y los criterios: lint, typecheck, test, coverage, perf, build, las dos baterías ×3 con código 0, y **rehacer la tabla de medidas** (la de la ronda 1 es de un código anterior).

### [programador] ronda 3 — 2026-10-19
- Ficheros cambiados: ninguno de código ni de tests (`git diff -- apps/lector-pdf/tests/` vacío tras restaurar la prueba de diagnóstico). Solo esta ficha. Trazas guardadas fuera del repo: `/tmp/claude-0/-home-claude-cumulo-agentes/409a8bbc-9d52-502a-8457-def03208983e/scratchpad/ink-trace-r3.json` y `.../scratchpad/ink-trace-r2.json`; logs de las 4 tandas en `/tmp/claude-0/ink-run-1.log` a `ink-run-4.log`.
- Qué he hecho: paso B.1 (trazado con `startTracing` solo entre `mouse.down` y `mouse.up`, sin cambiar aserciones) y B.2 (análisis del `RunTask` ≥ 50 ms del `CrRendererMain`). Paso B.4 de la traza: cae **durante el trazo**, así que según la replanificación 2 no toco código y escalo.
- Comandos ejecutados y resultado:
  - `e2e --project=chromium-perf --no-deps --repeat-each=5 -g "2 000 eventos"` ×4 tandas (con el trazado activo): 3/5, 5/5, 3/5, 2/5 → **7 fallos de 20**. Las long tasks falladas: 60, 73, 74 ms (ver abajo).
  - Análisis de trazas con script propio (no versionado) en el scratchpad.
- Traza (la misma en las dos trazas analizadas):
  - Ventana del trazo según `EventDispatch`: `pointerdown` a 90,0 ms y `pointerup` a 33 636 ms (2 001 `pointermove`).
  - Fallo en tanda 4, repetición 3: `RunTask` de **74,1 ms** a 30 212 ms; hijo dominante `Commit` **68,8 ms** (frameSeqId 2044, layerTreeId 1); resto: `EventDispatch` 2,9 ms, `PrePaint` 0,7 ms. Sin GC dentro de la tarea.
  - Fallo en tanda 4, repetición 2: `RunTask` de **74,1 ms** a 32 925 ms; hijo dominante `Commit` **69,5 ms** (frameSeqId 2207); resto: `EventDispatch` 2,6 ms, `PrePaint` 0,3 ms. Hay un GC menor (`MC_EVACUATE` 17 ms) a 32 881 ms, fuera de la tarea.
  - Las tareas de 71–82 ms a ~3 ms (`EvaluateScript`) ocurren antes de `pointerdown`, fuera de la ventana medida.
  - Conclusión del paso 2: el coste dominante es el `Commit` del compositor (no es GC ni `AnnotationLayer` al soltar). La causa concreta (raster/paint de alguna capa durante el trazo) **no está verificada**; es una hipótesis.
- Dudas o cosas que no he podido hacer (para el líder):
  1. **Escalado (paso 4 de la replanificación 2).** La long task es un `Commit` de ~70 ms durante el trazo. No es GC (paso 3, primera rama) y no es una tarea de la app al soltar (paso 3, segunda rama). Según la regla, es «cualquier otro»: no cambio código. Decidir si se investiga la capa que se repinta durante el trazo (¿ADR-0018 vista previa en canvas?, ¿capa de anotaciones?) o si se aísla el trazo con una ficha nueva.
  2. Las 20 repeticiones no cumplen el criterio «15/15» del punto 4: no se ha hecho el arreglo ni se han repetido las baterías ×3, ni el lint, build y medidas, porque el paso 4 no se ejecuta sin decisión del líder.
  3. Ficha en `en-revision`, sin cambios de código ni de tests.

### [lider] replanificación 3 — 2026-10-19
Estado → `pendiente`, depende de [[PDF-105-vista-previa-trazo-offscreen]]. `intentos` se mantiene (escalado correcto).
- **B (ink «2 000 eventos»)**: el `Commit` de ≈ 69 ms se ataca en PDF-105 (vista previa con `transferControlToOffscreen`, con contraste previo sin vista previa). Ver revisión de [[ADR-0018-vista-previa-del-trazo-en-canvas]]. En esta ficha no se toca `ink-preview.ts`, `AnnotationLayer.tsx` ni `ink.spec.ts`.
- **A (bundle)**: cerrado en la replanificación 2.
- Cuando PDF-105 esté `hecha`: hacer solo el punto 4 de la replanificación 2 desde «Luego todo el punto 5»: lint, typecheck, test, coverage, perf, build (anotar «Arranque: N»), las dos baterías ×3 con código 0 y la **tabla de medidas nueva** completa.
- Si PDF-105 acaba `bloqueada` (la hipótesis falla), la 090 sigue esperándola; el líder decide allí.
