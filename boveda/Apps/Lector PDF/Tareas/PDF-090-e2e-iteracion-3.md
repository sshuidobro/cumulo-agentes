---
tipo: tarea
id: PDF-090
titulo: E2E, accesibilidad, interoperabilidad y rendimiento de la iteración 3
app: pdf
estado: en-curso
depende_de: [PDF-083, PDF-043, PDF-044, PDF-088, PDF-089]
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
