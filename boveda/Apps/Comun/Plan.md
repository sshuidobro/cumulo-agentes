---
tipo: plan
app: comun
estado: iteracion-cerrada
iteracion: 1
creado: 2026-10-17
actualizado: 2026-10-17
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
- Comprobación completa: `pnpm install && pnpm lint && pnpm typecheck && pnpm test && pnpm coverage`

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
- [ ] **Reloj que retrocede agrupa.** Si `now()` devuelve un valor menor que `lastTime`, la diferencia negativa cuenta como "dentro de la ventana". Inocuo con `Date.now()` salvo cambios de hora del sistema; valorar `Math.abs` o usar `performance.now()` por defecto. (COM-003)

## Siguiente iteración (propuesta, sin planificar)
Lo que piden las apps antes de su primera iteración vertical: `packages/platform` (abrir/guardar en Tauri y navegador, guardado atómico), registro único de atajos (Ctrl+Z / Ctrl+Y conectados a `UndoStack`), logger común y, con React, el puente `UndoState` → store zustand. Se planificará cuando se elija la primera app y su investigación esté hecha.
