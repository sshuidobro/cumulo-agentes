---
tipo: plan
app: comun
estado: en-curso
iteracion: 4
creado: 2026-10-17
actualizado: 2026-10-19
tags: [plan, comun]
---

# Plan · Comun (paquetes comunes)

Manual: [[Apps/Comun/Manual|Manual]] · Investigación: [[Deshacer y rehacer en editores]] · Decisiones: [[ADR-0001-tecnologia]] · [[ADR-0004-herramientas-monorepo]] · [[ADR-0005-modelo-deshacer-rehacer]] · [[ADR-0006-eslint]]

## Objetivo
Monorepo mínimo (pnpm workspaces, TypeScript estricto, Vitest, ESLint) y, en `packages/shared`, un `UndoStack` genérico que usarán todas las apps: comandos `apply`/`invert`, agrupación de cambios consecutivos, límite de historial configurable y marca de "documento guardado".

## Alcance de la iteración 1
**Entra:**
- Raíz del monorepo y paquete `@suite/shared` (solo fuente, sin build), con `pnpm lint` ([[ADR-0006-eslint]]).
- `UndoStack<D>`: ejecutar, deshacer, rehacer, límite, guardado/sucio, estado para la UI y suscripción a cambios.
- Agrupación por `mergeKey` + tiempo, `group()` anidable con anulación si falla, `closeGroup()`.

**No entra:**
- Prettier, reglas de React en ESLint, lint con información de tipos, React, Vite, Tauri, zustand.
- Atajos Ctrl+Z / Ctrl+Y, botones y menús (llegarán con `packages/ui-kit` y el registro de atajos).
- `Command.merge` (compresión de pasos), autoguardado, persistencia del historial.
- Historial del procesador de texto: depende del ADR del editor (ver abajo).

**Texto vs. ProseMirror/Lexical:** si el editor elegido trae historial propio, el contenido de texto usará ese historial con un adaptador que exponga el mismo `UndoState`; el `UndoStack` sirve para hoja de cálculo, presentaciones, PDF y lo que el editor no cubra. Detalle en [[ADR-0005-modelo-deshacer-rehacer]].

## Arquitectura
```
package.json            scripts raíz, devDependencies exactas
.pnpmfile.cjs           typescript-eslint usa la API de TS 6 (ADR-0006)
eslint.config.js        flat config
pnpm-workspace.yaml     apps/*, packages/*
tsconfig.json           estricto, noEmit, incluye packages/*/src y packages/*/tests
vitest.config.ts        entorno node, cobertura v8 (umbral 80 % líneas)
packages/shared/
  package.json          @suite/shared, exports ./src/index.ts
  src/index.ts          reexporta los módulos públicos
  src/undo/types.ts     Command, UndoStackOptions, UndoState, UndoListener
  src/undo/undo-stack.ts  clase UndoStack<D>
  src/undo/index.ts     reexporta types + UndoStack
  tests/undo/*.test.ts
```
Flujo: la app crea `new UndoStack(docInicial)` → la UI llama a `execute(cmd)` / `undo()` / `redo()` → la pila actualiza `doc` y avisa a los suscriptores con un `UndoState` (`canUndo`, etiqueta, `isDirty`...). Lógica pura, sin DOM ni Node.

Dependencias permitidas (únicas): `typescript@7.0.2`, `vitest@5.0.5`, `@vitest/coverage-v8@5.0.5`, `eslint@10.13.0`, `@eslint/js@10.0.1`, `typescript-eslint@8.71.2` (y `@typescript/typescript6@6.0.2` solo vía `.pnpmfile.cjs`). Node `>=22.13`.

## Comandos
- Instalar: `pnpm install`
- Lint: `pnpm lint` (= `eslint --max-warnings 0 .`)
- Typecheck: `pnpm typecheck` (= `tsc -p tsconfig.json`)
- Test: `pnpm test` (= `vitest run`)
- Cobertura: `pnpm coverage` (= `vitest run --coverage`, falla por debajo del 80 % de líneas)
- Comprobación completa: `pnpm install && pnpm lint && pnpm typecheck && pnpm coverage` (`pnpm coverage` ya ejecuta todos los tests: no hace falta `pnpm test` antes; [[ADR-0026-ahorro-de-tokens]])

## Tareas
| Id | Título | Depende de | Estado |
|---|---|---|---|
| [[COM-001-esqueleto-monorepo]] | Crear el esqueleto del monorepo y `@suite/shared` | — | hecha |
| [[COM-002-undostack-nucleo]] | Implementar el núcleo de UndoStack (historial, límite, guardado) | COM-001 | hecha |
| [[COM-003-undostack-agrupacion]] | Añadir agrupación de cambios a UndoStack | COM-002 | hecha |

## Historial de iteraciones
- Iteración 1 (2026-10-17): planificada.
- 2026-10-17: se añade ESLint sin replanificar ([[ADR-0006-eslint]]); cambian COM-001 y la comprobación de COM-002/003.
- Iteración 1 (2026-10-17): **cerrada**. COM-001, COM-002 y COM-003 hechas a la primera (0 rechazos, `intentos: 0`). Verificación final desde cero por el coordinador: `pnpm lint` 0, `pnpm typecheck` 0, `pnpm test` 59 tests en verde (5 ficheros: humo, núcleo, casos límite, agrupación, QA de agrupación), `pnpm coverage` 100 % de líneas (`undo-stack.ts` ramas 94,44 %). Rendimiento: 100 000 `execute` en ~60 ms (presupuesto 1000 ms). Uso: [[Apps/Comun/Manual|Manual]].
- Iteración 2 (2026-10-17): planificada junto con el Lector PDF (COM-004 a COM-013).
- Iteración 2 (2026-10-18): **cerrada** junto con las iteraciones 1 y 2 del Lector PDF (COM-004 a COM-013 hechas).
- Iteración 3 (2026-10-18): planificada con las iteraciones 3 y 4 del Lector PDF (COM-014 a COM-017).

## Lo aprendido en la iteración 1
- **typescript-eslint 8 no admite TypeScript 7.** Se resolvió con `.pnpmfile.cjs`, que hace que los paquetes de typescript-eslint usen `@typescript/typescript6@6.0.2` mientras `tsc` sigue en TS 7 ([[ADR-0006-eslint]]). Hay que crearlo **antes** del primer `pnpm install` y el lockfile debe llevar `pnpmfileChecksum:`. Revisar cuando salga un typescript-eslint con soporte de TS 7: entonces se borra el fichero y se actualiza el ADR.
- **Lint estricto y campos privados.** `no-unused-private-class-members` obliga a usar todo campo `#` en la misma tarea que lo crea. En COM-002 se añadió un getter público `groupDelayMs` solo para satisfacerlo; en COM-003 se **retiró** al usar `#groupDelayMs` en `execute` (se quitaron sus 2 aserciones en `undo-stack.test.ts`, única modificación de un test anterior). Lección para fichas futuras: no pedir campos que una tarea no use; si hace falta, reservarlos para la tarea que los use.
- **Sin operador `!`** (`no-non-null-assertion` en `tseslint.configs.strict`): con `noUncheckedIndexedAccess`, estrechar con `if (x === undefined)`. Avisarlo en el Contexto de cada ficha funcionó.
- **`performance.now()` sin tipos de DOM ni Node**: el test de rendimiento lo usa vía `globalThis` porque `tsconfig` tiene `types: []`.
- Fichas con el código de configuración literal y criterios con salida exacta → 0 rechazos. Mantener ese nivel de detalle.

## Mejoras pendientes (no planificadas)
Observaciones de revisor y tester. No bloquean nada; se convertirán en fichas solo cuando una app las necesite o en una iteración de mantenimiento.
- [ ] **Listener que lanza deja la notificación a medias.** `#notify()` (`undo-stack.ts:289`) recorre los listeners sin `try`: si uno lanza, los siguientes no reciben el estado y el error sale de `execute`/`undo`/... aunque el cambio ya se aplicó. Opciones: aislar cada listener (`try/catch` y registrar con el logger común cuando exista) o documentar que los listeners no deben lanzar. Decidir al crear el logger común. (COM-002, COM-003)
- [ ] **`fn` asíncrona en `group()` no está soportada.** Si `fn` devuelve una promesa, el grupo se cierra al devolverla; lo que se ejecute después del `await` cae fuera del grupo y un rechazo no anula nada. Opciones: rechazar en tiempo de tipos/ejecución los `thenable` o añadir `groupAsync`. De momento, documentado en el [[Apps/Comun/Manual|Manual]]. (COM-003)
- [ ] **Ramas defensivas sin cubrir** en `undo-stack.ts`: línea 269 (`this.#undo.at(-1) === entry` en `#rollbackGroup`, hoy siempre cierta) y línea 284 (`if (removed === undefined) break;` en `#trim`, inalcanzable). Ramas 94,44 %. Son defensivas y válidas; valorar sustituirlas por una aserción de bug o aceptar la cobertura de ramas actual. (COM-003)
- [ ] **Mover el assert de tiempo de COM-002 a la suite de rendimiento** ([[ADR-0012-suite-de-rendimiento]]): `packages/shared/tests/undo/undo-stack.test.ts` ("100 000 execute < 1000 ms") → `packages/shared/tests/perf/undo-stack.perf.test.ts`; el test de comportamiento (doc final `100000`, `undoDepth 100`) se queda en `tests/undo/`. Añadir a `vitest.perf.config.ts` un proyecto `{ test: { name: 'shared-perf', root: './packages/shared', include: ['tests/perf/**/*.perf.test.ts'], environment: 'node', fileParallelism: false } }`. Margen actual 16×, no urge; hacerlo la próxima vez que se toque `packages/shared`. (2026-10-17)
- [ ] **Reloj que retrocede agrupa.** Si `now()` devuelve un valor menor que `lastTime`, la diferencia negativa cuenta como "dentro de la ventana". Inocuo con `Date.now()` salvo cambios de hora del sistema; valorar `Math.abs` o usar `performance.now()` por defecto. (COM-003)

## Iteración 2 · Base para las apps (planificada 2026-10-17 con el [[Apps/Lector PDF/Plan|Lector PDF]]) · cerrada 2026-10-18
**Objetivo:** lo que necesita la primera app vertical (Lector PDF) y reutilizarán las demás: monorepo preparado para apps React/Vite (Result, logger, capas de lint), `@suite/platform` (abrir/guardar por rangos y de forma atómica en navegador y en Tauri), crate Rust `suite-platform` con los comandos Tauri, registro de atajos, almacén de borradores y cierre de ventana con confirmación.
**Decisiones:** [[ADR-0008-plataforma-ficheros]] · [[ADR-0010-stack-apps-web-y-pruebas]] (versiones exactas de React, Vite, zustand, Tauri, Playwright…).
**No entra:** ui-kit compartido (los componentes nacen en `apps/lector-pdf/src/ui/kit` y se moverán a `packages/` cuando una segunda app los necesite), i18n, actualizaciones automáticas.

| Id | Título | Depende de | Estado |
|---|---|---|---|
| [[COM-004-monorepo-para-apps]] | Preparar el monorepo para apps (tsconfig base, Vitest por proyectos, lint por capas, Result, logger) | — | hecha |
| [[COM-005-platform-tipos-y-bytesource]] | @suite/platform: tipos, ByteSource y preferencias | COM-004 | hecha |
| [[COM-006-platform-web-abrir]] | Platform web: abrir, soltar, enlaces, título | COM-005 | hecha |
| [[COM-007-platform-web-guardar]] | Platform web: guardar y guardar como (atómico, `append`) | COM-006 | hecha |
| [[COM-008-crate-rust-ficheros]] | Crate Rust `suite-platform`: registro de rutas y E/S atómica | — | hecha |
| [[COM-009-comandos-tauri-platform]] | Comandos Tauri de `suite-platform` | COM-008 | hecha |
| [[COM-010-platform-tauri]] | Platform Tauri (TS) con `mockIPC` | COM-005 | hecha |
| [[COM-011-registro-de-atajos]] | Registro de atajos de teclado | COM-004 | hecha |
| [[COM-012-almacen-de-borradores]] | Almacén de borradores en IndexedDB | COM-005 | hecha |
| [[COM-013-cerrar-ventana]] | `Platform.closeWindow()` | COM-007, COM-010 | hecha |

COM-004 a COM-011 los necesita la iteración 1 del Lector PDF; COM-012 y COM-013, su iteración 2. Paralelo desde el inicio: COM-004 y COM-008.

## Iteración 3 · Plataforma para las iteraciones 3 y 4 del Lector PDF (planificada 2026-10-18)
**Objetivo:** imprimir la ventana, documentos recientes y pantalla completa en `@suite/platform`, en web y en Tauri.
**Decisiones:** [[ADR-0021-impresion]] · [[ADR-0023-pestanas-y-recientes]] · [[ADR-0024-modos-de-pagina]].
**No entra:** listas de saltos del SO (Jump List, Dock), impresión nativa sin diálogo.

| Id | Título | Depende de | Estado |
|---|---|---|---|
| [[COM-014-imprimir-desde-la-plataforma]] | `Platform.print()` en web y en Tauri | — | pendiente |
| [[COM-015-recientes-web]] | Documentos recientes: tipos e implementación web | COM-014 | pendiente |
| [[COM-016-recientes-tauri]] | Documentos recientes en Tauri (lista guardada por Rust) | COM-015 | pendiente |
| [[COM-017-pantalla-completa]] | Pantalla completa | COM-016 | pendiente |

Van en serie porque las cuatro amplían la interfaz `Platform` (`types.ts`) y las implementaciones. COM-014 la necesita la iteración 3 del Lector (PDF-044); las otras tres, su iteración 4.

## Iteración 4 · Plataforma para la iteración 6 del Lector PDF (planificada 2026-10-19)
**Objetivo:** guardar exportaciones (imágenes, texto, ZIP, XFDF) sin que entren en «Recientes».
**Decisiones:** [[ADR-0032-exportar-imagenes-y-texto]] · [[ADR-0030-respuestas-estados-xfdf]].

| Id | Título | Depende de | Estado |
|---|---|---|---|
| [[COM-018-exportar-fichero]] | `Platform.exportFile` (web y Tauri) | COM-017 | pendiente |
| [[COM-019-importar-varios-ficheros]] | `Platform.importFiles` (varios ficheros, web y Tauri) | COM-018 | pendiente |

## Siguiente iteración
Sin planificar: se decidirá con la segunda app (mover componentes comunes a `packages/ui-kit`, resolver las mejoras pendientes de `UndoStack`).
