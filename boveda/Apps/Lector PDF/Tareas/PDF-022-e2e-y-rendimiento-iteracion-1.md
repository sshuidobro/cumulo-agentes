---
tipo: tarea
id: PDF-022
titulo: E2E de extremo a extremo y presupuestos de rendimiento de la iteración 1
app: pdf
estado: pendiente
depende_de: [PDF-004, PDF-011, PDF-012, PDF-013, PDF-014, PDF-016, PDF-018, PDF-019, PDF-020, PDF-021]
intentos: 0
skills: [pruebas-calidad, calidad-profesional]
creado: 2026-10-17
actualizado: 2026-10-17
tags: [tarea, pdf, e2e, rendimiento]
---

# PDF-022 · E2E y presupuestos de la iteración 1

Plan: [[Apps/Lector PDF/Plan|Plan]] (sección "Presupuestos") · Decisiones: [[ADR-0007-motor-y-visor-pdf]] · [[ADR-0011-documentos-de-prueba-pdf]]

## Objetivo
Una batería E2E que demuestra que la iteración 1 cumple lo prometido al usuario: abrir y leer **cualquier** PDF de cualquier tamaño con todas las funciones del visor, dentro de los presupuestos de tiempo y memoria del Plan, solo con teclado si hace falta, y sin errores con el corpus real.

## Contexto
- Leer: sección "Presupuestos" del [[Apps/Lector PDF/Plan|Plan]], todos los `tests/e2e/*.spec.ts` existentes (no dupliques: esta ficha añade los flujos completos y las mediciones), `fixtures/FUENTES.md`.
- Medir en el navegador: `performance.now()`, `PerformanceObserver({ type: 'longtask', buffered: true })`, `performance.memory.usedJSHeapSize` (Chromium). Inyecta los observadores con `page.addInitScript`.
- Esta ficha **no cambia código de la app** salvo para añadir `data-testid` que falten (anótalos). Si un presupuesto no se cumple, el test falla: no se relaja el umbral; se anota en el Registro y la ficha vuelve al líder.

## Qué hay que hacer
1. `tests/e2e/helpers.ts`: `openFixture(page, name)` (vía `[data-testid=open-input]`), `waitPageRendered(page, n)`, `installPerfProbes(page)`, `longTasks(page)`, `heapMB(page)`, `canvasCount(page)`.
2. `tests/e2e/performance.spec.ts` — una prueba por fila de la tabla de presupuestos del Plan (abrir pequeño < 1 s; 5 000 y 100 000 < 5 s; Fin < 1,5 s; ≤ 12 lienzos y ≤ 12 marcos; heap < 400 MB tras 30 saltos aleatorios por `pages-5000.pdf`; búsqueda en 5 000 páginas: 1.ª coincidencia < 1 s con la consulta `marcador-1` y recorrido completo < 15 s; ninguna *long task* > 100 ms durante scroll, zoom y búsqueda). Cada prueba imprime su medida con `test.info().annotations.push({ type: 'medida', description })`.
3. `tests/e2e/corpus.spec.ts`: para cada PDF de `fixtures/pdf/corpus/` y de `generated/` no dañado: abrir, esperar la página 1 dibujada, ir a la última página, comprobar que no hay errores en consola (`page.on('console')` tipo `error` y `page.on('pageerror')`). Los dañados muestran su mensaje y la app sigue usable (se puede abrir otro después).
4. `tests/e2e/keyboard.spec.ts`: flujo solo con teclado tras abrir `outline.pdf`: Tab hasta el visor, Av Pág, `Ctrl+Mayús+N` 12 Intro, `F4`, pestaña Marcadores con flechas, activar `Anexo` con Intro, `Alt+←`, `Ctrl+F` «Página 7» Intro, `Ctrl++`, `Ctrl+0`, `Ctrl+Mayús+→`, Esc. Comprueba el estado tras cada paso.
5. `tests/e2e/stress.spec.ts`: `pages-100000.pdf` + `pages-20000-flat.pdf`: abrir, Fin, Inicio, buscar `aguja` y detener, cambiar zoom 5 veces, girar 4 veces; la app responde en todo momento (cada acción visible en < 2 s).
6. Ejecuta toda la batería 3 veces seguidas (`--repeat-each=3`) para detectar pruebas inestables; las inestables se arreglan (esperas por estado, nunca `waitForTimeout`).

## Criterios de aceptación
- [ ] `pnpm --filter lector-pdf e2e` con código 0, y con `--repeat-each=3` también.
- [ ] Todas las filas de la tabla de presupuestos del Plan tienen una prueba y su medida anotada; copia la tabla con los valores medidos en el Registro.
- [ ] Los 10 PDFs del corpus y todos los generados válidos se abren y recorren sin errores de consola.
- [ ] El flujo de teclado completo pasa sin usar el ratón.
- [ ] Ninguna prueba usa `waitForTimeout`, `test.skip` ni `.only` (`grep` en el Registro).
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` con código 0.

## Fuera de alcance
- Corregir problemas de rendimiento encontrados (el líder crea fichas nuevas). Pruebas en Tauri real (lista manual de PDF-021).

## Registro
<!-- Cada agente añade aquí su entrada al terminar; no borrar las anteriores. -->
