---
tipo: tarea
id: COM-004
titulo: Preparar el monorepo para apps (proyectos de Vitest, typecheck por paquete, lint de React, Result y logger)
app: comun
estado: hecha
depende_de: []
intentos: 0
skills: [stack-typescript-react, pruebas-calidad]
creado: 2026-10-17
actualizado: 2026-10-17
tags: [tarea, comun]
---

# COM-004 · Preparar el monorepo para apps

Plan: [[Apps/Comun/Plan|Plan]] · Decisiones: [[ADR-0010-stack-apps-web-y-pruebas]] · [[ADR-0006-eslint]] · [[ADR-0007-motor-y-visor-pdf]] · [[ADR-0008-plataforma-ficheros]]

## Objetivo
Que el monorepo admita paquetes con DOM y apps React: Vitest por proyectos, typecheck encadenado por paquete, ESLint con reglas de React y de capas, y en `@suite/shared` los tipos `Result`/`AppError` y un logger común.

## Contexto
- Leer: `package.json`, `tsconfig.json`, `vitest.config.ts`, `eslint.config.js`, `.gitignore`, `packages/shared/src/index.ts`, [[ADR-0010-stack-apps-web-y-pruebas]].
- Lint estricto: sin `!` (no-non-null-assertion), sin `any`, sin `console.*` (salvo en `logger.ts`, ver abajo).
- Los 59 tests existentes deben seguir pasando sin tocarlos.

## Qué hay que hacer
1. `tsconfig.base.json` (nuevo) con **exactamente** el `compilerOptions` actual de `tsconfig.json`. `tsconfig.json` pasa a:
   ```json
   {
     "extends": "./tsconfig.base.json",
     "include": ["packages/shared/src", "packages/shared/tests", "packages/shared/vitest.config.ts", "vitest.config.ts"]
   }
   ```
2. `package.json` raíz: scripts
   ```json
   "lint": "eslint --max-warnings 0 .",
   "typecheck": "tsc -p tsconfig.json && pnpm -r --if-present run typecheck",
   "test": "vitest run",
   "coverage": "vitest run --coverage",
   "e2e": "pnpm -r --if-present run e2e"
   ```
   y añade a `devDependencies`: `"eslint-plugin-react-hooks": "7.1.1"`, `"globals": "17.13.0"`.
3. `packages/shared/vitest.config.ts`:
   ```ts
   import { defineProject } from 'vitest/config';
   export default defineProject({ test: { name: 'shared', include: ['tests/**/*.test.ts'], environment: 'node' } });
   ```
   `vitest.config.ts` (raíz):
   ```ts
   import { defineConfig } from 'vitest/config';
   export default defineConfig({
     test: {
       projects: ['packages/*/vitest.config.ts', 'apps/*/vitest.config.ts'],
       coverage: {
         provider: 'v8',
         include: ['packages/*/src/**/*.ts', 'apps/*/src/core/**/*.ts'],
         exclude: ['**/*.d.ts'],
         thresholds: { lines: 80 },
       },
     },
   });
   ```
   Si Vitest falla porque `apps/*/vitest.config.ts` no encuentra nada (aún no hay apps), quita ese patrón y anótalo en el Registro (lo añade PDF-001).
4. `eslint.config.js` (texto completo):
   ```js
   import js from '@eslint/js';
   import { defineConfig } from 'eslint/config';
   import reactHooks from 'eslint-plugin-react-hooks';
   import globals from 'globals';
   import tseslint from 'typescript-eslint';

   const noTauri = { group: ['@tauri-apps/*'], message: 'Usa @suite/platform (ADR-0008).' };
   const noNode = { group: ['node:*'], message: 'Este código corre en el navegador.' };
   const noPdfjs = { group: ['pdfjs-dist', 'pdfjs-dist/*'], message: 'Solo src/engine importa pdfjs-dist (ADR-0007).' };
   const noUi = { group: ['react', 'react-dom', 'react-dom/*', 'zustand'], message: 'core/ es lógica pura sin React (stack-typescript-react).' };

   export default defineConfig(
     {
       ignores: ['**/node_modules/', '**/coverage/', '**/dist/', 'boveda/', 'ejemplos/', 'target/',
         '**/src-tauri/target/', '**/src-tauri/gen/', '**/public/pdfjs/', 'fixtures/pdf/generated/',
         '**/playwright-report/', '**/test-results/'],
     },
     js.configs.recommended,
     tseslint.configs.strict,
     {
       rules: {
         'no-console': 'error',
         '@typescript-eslint/no-explicit-any': 'error',
         '@typescript-eslint/no-unused-vars': 'error',
         '@typescript-eslint/consistent-type-imports': 'error',
         '@typescript-eslint/ban-ts-comment': ['error', { 'ts-expect-error': 'allow-with-description' }],
       },
     },
     { files: ['packages/shared/src/logger.ts'], rules: { 'no-console': 'off' } },
     { files: ['apps/**/*.{ts,tsx}', 'packages/platform/**/*.ts'], languageOptions: { globals: { ...globals.browser } } },
     { files: ['apps/**/*.{ts,tsx}'], ...reactHooks.configs.flat.recommended },
     { files: ['apps/*/src/**/*.{ts,tsx}'], rules: { 'no-restricted-imports': ['error', { patterns: [noPdfjs, noTauri, noNode] }] } },
     { files: ['apps/*/src/engine/**/*.{ts,tsx}'], rules: { 'no-restricted-imports': ['error', { patterns: [noTauri, noNode] }] } },
     { files: ['apps/*/src/core/**/*.ts'], rules: { 'no-restricted-imports': ['error', { patterns: [noPdfjs, noTauri, noNode, noUi] }] } },
     { files: ['packages/platform/src/**/*.ts'], ignores: ['packages/platform/src/tauri/**'], rules: { 'no-restricted-imports': ['error', { patterns: [noTauri, noNode] }] } },
     { files: ['**/*.cjs'], languageOptions: { sourceType: 'commonjs', globals: { module: 'writable', require: 'readonly' } } },
     { files: ['**/*.mjs'], languageOptions: { globals: { ...globals.node } } },
   );
   ```
5. `.gitignore`: añade `target/`, `dist/`, `fixtures/pdf/generated/`, `apps/*/public/pdfjs/`, `playwright-report/`, `test-results/`, `apps/*/src-tauri/gen/`.
6. `packages/shared/src/result.ts`:
   ```ts
   export interface AppError {
     /** Código estable en inglés, p. ej. 'not-pdf'. */
     readonly code: string;
     /** Mensaje para el usuario, en español. */
     readonly message: string;
     readonly cause?: unknown;
   }
   export type Result<T, E = AppError> =
     | { readonly ok: true; readonly value: T }
     | { readonly ok: false; readonly error: E };
   export function ok<T>(value: T): Result<T, never> { return { ok: true, value }; }
   export function err<E>(error: E): Result<never, E> { return { ok: false, error }; }
   ```
7. `packages/shared/src/logger.ts`:
   ```ts
   export type LogLevel = 'debug' | 'info' | 'warn' | 'error';
   export type LogSink = (level: LogLevel, scope: string, message: string, data?: unknown) => void;
   export interface Logger { debug(m: string, data?: unknown): void; info(m: string, data?: unknown): void; warn(m: string, data?: unknown): void; error(m: string, data?: unknown): void; }
   export const consoleSink: LogSink;              // console[level](`[${scope}] ${message}`) y `data` como 2.º argumento solo si no es undefined
   export function configureLogging(opts: { readonly sink?: LogSink | null; readonly minLevel?: LogLevel }): void; // por defecto sink = consoleSink, minLevel = 'warn'; null = sin salida
   export function createLogger(scope: string): Logger; // consulta la configuración en cada llamada (no al crearse)
   ```
   Orden de niveles: debug < info < warn < error.
8. `packages/shared/src/index.ts`: añade `export * from './result';` y `export * from './logger';`.
9. Tests: `packages/shared/tests/result.test.ts` y `packages/shared/tests/logger.test.ts` (un `it` por criterio (T)).

## Criterios de aceptación
- [ ] `pnpm install` sin avisos de *peer*; `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm coverage` con código 0. Los 59 tests anteriores siguen en verde.
- [ ] `pnpm test` muestra el proyecto `shared` en la salida (`|shared|`).
- [ ] (T) `ok(3)` → `{ ok: true, value: 3 }`; `err({ code: 'x', message: 'y' })` → `{ ok: false, error: {...} }`; un `switch` sobre `r.ok` estrecha el tipo (test de tipos con `expectTypeOf` de Vitest).
- [ ] (T) Logger: con `configureLogging({ sink: fake, minLevel: 'info' })`, `debug` no llega al sink e `info`/`warn`/`error` sí con `(level, scope, message, data)`; con `sink: null` no se llama nada; `createLogger` creado **antes** de `configureLogging` respeta la configuración nueva.
- [ ] Lint de capas comprobado a mano: un fichero temporal `apps/x/src/core/t.ts` con `import 'react'` da error `no-restricted-imports`; bórralo después y anota la salida en el Registro.
- [ ] `git status` no muestra `target/` ni `dist/` tras compilar.

## Fuera de alcance
- Crear `packages/platform` o apps (COM-005, PDF-001). Prettier. Atajos (COM-011).

## Registro
<!-- Cada agente añade aquí su entrada al terminar; no borrar las anteriores. -->

### [programador] ronda 1 — 2026-10-17
- Ficheros cambiados: `tsconfig.base.json` (nuevo), `tsconfig.json`, `vitest.config.ts`, `packages/shared/vitest.config.ts` (nuevo), `eslint.config.js`, `package.json`, `pnpm-lock.yaml`, `.gitignore`, `packages/shared/src/index.ts`, `packages/shared/src/result.ts` (nuevo), `packages/shared/src/logger.ts` (nuevo), `packages/shared/tests/result.test.ts` (nuevo), `packages/shared/tests/logger.test.ts` (nuevo).
- Qué he hecho: configuración de monorepo según la ficha (base de tsconfig, proyectos de Vitest con `shared`, ESLint con reglas de React y de capas, scripts raíz, `.gitignore`). Añadidos `AppError`/`Result`/`ok`/`err` y el logger (`configureLogging`, `createLogger`, `consoleSink`) con sus tests. Los 59 tests anteriores no se han tocado. `apps/*/vitest.config.ts` se mantiene en `projects` (no ha dado error con 0 apps).
- Desviación menor: `tsconfig` tiene `types: []` y `lib` sin DOM, así que `console` no existe para el tipo. En `logger.ts` y en su test se accede a la consola mediante un tipo mínimo `ConsoleApi` sobre `globalThis` (sin cambiar `tsconfig`). El comportamiento es el de la ficha.
- Comandos ejecutados y resultado: `pnpm install` sin avisos de peer (grep de peer/warn vacío). `pnpm lint` 0. `pnpm typecheck` 0. `pnpm test` 0: 67 tests en 7 ficheros (59 previos + 8 nuevos), salida con `|shared|`. `pnpm coverage` 0: 100 % líneas (logger.ts 100 %, ramas 83 %).
- Comprobación de capas: fichero temporal `apps/x/src/core/t.ts` con `import 'react'`. Salida: `1:1 error 'react' import is restricted from being used by a pattern. core/ es lógica pura sin React (stack-typescript-react) no-restricted-imports`, exit 1. Fichero y carpeta `apps/x` borrados.
- `git status`: no aparecen `dist/` ni `target/`. Hay una carpeta `target/` (Cargo, creada a las 17:08 por otro proceso, no por este compilado de TS) que ya está ignorada por `.gitignore`. No la he borrado.
- Dudas o cosas que no he podido hacer: ninguna de la ficha. Pendiente para el líder: `pnpm e2e` no tiene ningún paquete con script `e2e` todavía (se resolverá con PDF-001).

### [revisor] ronda 1 — 2026-10-17 — APROBADO
Comprobado: `pnpm lint`, `typecheck`, `test` (67 en verde), `coverage` (100 % líneas) con código 0; configuración idéntica a la ficha; `git status` limpio de `target/`/`dist/`. Tests de `Result` y logger cubren cada criterio (T), incluido el logger creado antes de configurar y `sink: null`.
1. (opcional) criterio `|shared|`: el reporter por defecto de `pnpm test` no imprime el nombre del proyecto; solo aparece con `--reporter=verbose`. El proyecto sí está registrado; el tester debe verificarlo con verbose.
2. (opcional) `logger.ts`: la desviación del tipo `ConsoleApi` sobre `globalThis` es aceptable dado `types: []`.

### [tester] ronda 1 — 2026-10-17 — PASA
| Criterio | Resultado | Evidencia (comando / salida) |
|---|---|---|
| install sin avisos peer; lint, typecheck, test, coverage con código 0; 59 previos en verde | OK | `pnpm install --frozen-lockfile` sin avisos; lint/typecheck/coverage exit 0; 68 tests en 7 ficheros; líneas 100 % |
| `pnpm test` muestra `\|shared\|` | OK (con `vitest run --reporter=verbose`; el reporter por defecto no lo imprime) | `✓ \|shared\| tests/undo/...` |
| (T) Result ok/err y estrechamiento | OK | `result.test.ts` con `expectTypeOf`, verificado también por `tsc` (los tests están en `include`) |
| (T) Logger | OK | `logger.test.ts`: minLevel, sink null, logger creado antes de configurar |
| Lint de capas | OK, repetido por mí | `apps/x/src/core/t.ts`: react, pdfjs-dist y node:fs dan `no-restricted-imports`; en `ui/`: pdfjs-dist, @tauri-apps, `any`, `console`, `!` dan error (8 errores). Carpeta borrada. |
| `git status` sin `target/` ni `dist/` | OK | solo aparecen notas de la bóveda y ficheros de COM-008 |

Hallazgo: mutación `minLevel` inicial `warn`→`info` en `logger.ts` sobrevivía a los tests (el `beforeEach` fija la configuración y nunca se probaba el valor inicial). Corregido con test nuevo que recarga el módulo (`vi.resetModules`); ahora la mutación lo hace fallar. Código de producción restaurado intacto.
Tests añadidos: 1 en `packages/shared/tests/logger.test.ts` (valores iniciales del módulo, con Unicode ñ/emoji/RTL).
Rendimiento: no aplica (ficha de configuración); suite completa en ~0,5 s.
