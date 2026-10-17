---
tipo: tarea
id: COM-001
titulo: Crear el esqueleto del monorepo y @suite/shared
app: comun
estado: hecha
depende_de: []
intentos: 0
skills: [stack-typescript-react, pruebas-calidad]
creado: 2026-10-17
actualizado: 2026-10-17
tags: [tarea, comun]
---

# COM-001 · Crear el esqueleto del monorepo y @suite/shared

Plan: [[Apps/Comun/Plan|Plan]] · Decisiones: [[ADR-0004-herramientas-monorepo]] · [[ADR-0006-eslint]]

## Objetivo
Que en la raíz del repositorio `pnpm install && pnpm lint && pnpm typecheck && pnpm test && pnpm coverage` funcione con un paquete `@suite/shared` y un test de humo.

## Contexto
- Leer: `CLAUDE.md`, [[ADR-0004-herramientas-monorepo]], [[ADR-0006-eslint]] (por qué existe `.pnpmfile.cjs`), sección "Comandos" del Plan.
- No hay código todavía. Las carpetas `ejemplos/` y `boveda/` no se tocan.
- Esta configuración ya se probó en un borrador: si la copias tal cual, funciona.

## Qué hay que hacer
1. `package.json` (raíz):
   ```json
   {
     "name": "suite-ofimatica",
     "private": true,
     "type": "module",
     "packageManager": "pnpm@10.28.0",
     "engines": { "node": ">=22.13" },
     "scripts": {
       "lint": "eslint --max-warnings 0 .",
       "typecheck": "tsc -p tsconfig.json",
       "test": "vitest run",
       "coverage": "vitest run --coverage"
     },
     "devDependencies": {
       "typescript": "7.0.2",
       "vitest": "5.0.5",
       "@vitest/coverage-v8": "5.0.5",
       "eslint": "10.13.0",
       "@eslint/js": "10.0.1",
       "typescript-eslint": "8.71.2"
     }
   }
   ```
2. `pnpm-workspace.yaml`:
   ```yaml
   packages:
     - "apps/*"
     - "packages/*"
   ```
3. `tsconfig.json`:
   ```json
   {
     "compilerOptions": {
       "target": "es2023", "lib": ["es2023"],
       "module": "preserve", "moduleResolution": "bundler",
       "strict": true, "noUncheckedIndexedAccess": true, "exactOptionalPropertyTypes": true,
       "noImplicitOverride": true, "noFallthroughCasesInSwitch": true,
       "verbatimModuleSyntax": true, "isolatedModules": true,
       "noEmit": true, "skipLibCheck": true, "types": []
     },
     "include": ["packages/*/src", "packages/*/tests", "vitest.config.ts"]
   }
   ```
4. `vitest.config.ts`:
   ```ts
   import { defineConfig } from 'vitest/config';

   export default defineConfig({
     test: {
       include: ['packages/*/tests/**/*.test.ts'],
       environment: 'node',
       coverage: {
         provider: 'v8',
         include: ['packages/*/src/**/*.ts'],
         thresholds: { lines: 80 },
       },
     },
   });
   ```
5. `.gitignore` con: `node_modules/`, `coverage/`, `*.log`. Añade a git el `pnpm-lock.yaml` generado.
6. `packages/shared/package.json`:
   ```json
   { "name": "@suite/shared", "version": "0.0.0", "private": true, "type": "module",
     "exports": { ".": "./src/index.ts" } }
   ```
7. `packages/shared/src/index.ts`: `export const SHARED_PACKAGE_NAME = '@suite/shared';` (se mantendrá; COM-002 añadirá reexports debajo).
8. `packages/shared/tests/smoke.test.ts`: importa `SHARED_PACKAGE_NAME` desde `'../src/index'` (sin extensión `.ts`) con `import { describe, expect, it } from 'vitest'` y comprueba que vale `'@suite/shared'`.
9. `.pnpmfile.cjs` (raíz; hace que typescript-eslint use la API de TypeScript 6, ver [[ADR-0006-eslint]]). Créalo **antes** del primer `pnpm install`:
   ```js
   // typescript-eslint 8 no admite TypeScript 7 (ADR-0006).
   // Sus paquetes usan la API de TypeScript 6 (@typescript/typescript6);
   // `tsc` del proyecto sigue siendo TypeScript 7.
   const TS6 = 'npm:@typescript/typescript6@6.0.2';

   function readPackage(pkg) {
     const usesTs =
       pkg.name === 'typescript-eslint' ||
       pkg.name === 'ts-api-utils' ||
       pkg.name.startsWith('@typescript-eslint/');
     if (usesTs && pkg.peerDependencies && pkg.peerDependencies.typescript) {
       delete pkg.peerDependencies.typescript;
       pkg.dependencies = { ...pkg.dependencies, typescript: TS6 };
     }
     return pkg;
   }

   module.exports = { hooks: { readPackage } };
   ```
10. `eslint.config.js` (raíz):
   ```js
   import js from '@eslint/js';
   import { defineConfig } from 'eslint/config';
   import tseslint from 'typescript-eslint';

   export default defineConfig(
     { ignores: ['**/node_modules/', '**/coverage/', '**/dist/', 'boveda/', 'ejemplos/'] },
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
     {
       files: ['**/*.cjs'],
       languageOptions: {
         sourceType: 'commonjs',
         globals: { module: 'writable', require: 'readonly' },
       },
     },
   );
   ```

## Criterios de aceptación
- [ ] `pnpm install` en la raíz termina sin errores ni avisos `unmet peer` y crea `pnpm-lock.yaml` (con línea `pnpmfileChecksum:`).
- [ ] `pnpm lint` termina con código 0 y sin salida de problemas.
- [ ] `pnpm typecheck` termina con código 0 y sin salida de errores.
- [ ] `pnpm test` muestra `Tests  1 passed (1)`.
- [ ] `pnpm coverage` termina con código 0 y muestra `Lines : 100%`.
- [ ] Prueba de rigor: añadir temporalmente `const a: string[] = []; const b: string = a[0];` a `src/index.ts` hace fallar `pnpm typecheck` con `TS2322` (se revierte después; demuestra `noUncheckedIndexedAccess`).
- [ ] Prueba de lint: añadir temporalmente a `src/index.ts`
  ```ts
  import { describe } from 'vitest';
  export function lintProbe(value: any): void {
    console.log(value);
  }
  ```
  hace fallar `pnpm lint` (código 1) con 3 errores: `@typescript-eslint/no-unused-vars`, `@typescript-eslint/no-explicit-any` y `no-console`. Se revierte y `pnpm lint` vuelve a 0. Copia la salida en el Registro.
- [ ] `git status` no muestra `node_modules/` ni `coverage/`.
- [ ] Ninguna dependencia distinta de las seis listadas en `package.json` (raíz ni paquete). `@typescript/typescript6` aparece solo en el lockfile, no en `package.json`.

## Fuera de alcance
- Prettier, `eslint-plugin-react-hooks`, lint con información de tipos, React, Vite, Tauri, `@types/node`.
- Carpeta `apps/` (no crearla; el workspace la admite vacía).
- Cualquier código de deshacer/rehacer.

## Registro
<!-- Cada agente añade aquí su entrada al terminar; no borrar las anteriores. -->

### [programador] ronda 1 — 2026-10-17
- Ficheros cambiados: `package.json`, `pnpm-workspace.yaml`, `tsconfig.json`, `vitest.config.ts`, `.gitignore`, `.pnpmfile.cjs`, `eslint.config.js`, `pnpm-lock.yaml`, `packages/shared/package.json`, `packages/shared/src/index.ts`, `packages/shared/tests/smoke.test.ts`.
- Qué he hecho: he creado el esqueleto según la ficha, copiando el texto exacto de los ficheros. Compruebo antes con `npm view` que existen las seis versiones fijadas y `@typescript/typescript6@6.0.2`. `pnpm install` no muestra avisos de `unmet peer` y el lockfile incluye `pnpmfileChecksum:`. Las pruebas de rigor se hicieron con cambios temporales y se revirtieron.
- Comandos ejecutados y resultado:
  - `pnpm install`: OK, sin avisos. `pnpm install --frozen-lockfile`: OK.
  - `pnpm lint`: código 0, sin problemas.
  - `pnpm typecheck`: código 0.
  - `pnpm test`: `Test Files  1 passed (1)`, `Tests  1 passed (1)`.
  - `pnpm coverage`: código 0, `Lines : 100% ( 1/1 )`.
  - Prueba de rigor `noUncheckedIndexedAccess`: `packages/shared/src/index.ts(3,7): error TS2322: Type 'string | undefined' is not assignable to type 'string'.`, código 1. Revertido.
  - Prueba de lint, salida copiada: `2:10 error 'describe' is defined but never used @typescript-eslint/no-unused-vars`; `3:34 error Unexpected any. Specify a different type @typescript-eslint/no-explicit-any`; `4:3 error Unexpected console statement no-console`; `✖ 3 problems (3 errors, 0 warnings)`, código 1. Revertido, `pnpm lint` vuelve a código 0.
  - Dependencias: `package.json` tiene exactamente las seis listadas. `@typescript/typescript6` solo aparece en el lockfile.
- Dudas o cosas que no he podido hacer: `pnpm install` deja sin tocar `boveda/` (excepto esta ficha). Los cambios sin commitear de `boveda/` que no son de esta ficha (Plan, COM-002, COM-003, ADR-0004, Inicio, ADR-0006) no los he incluido en mi commit. `apps/` no se ha creado, según la ficha.

### [revisor] ronda 1 — 2026-10-17 — APROBADO
Verificado en limpio: `pnpm install --frozen-lockfile` OK (lockfile con `pnpmfileChecksum:` y tracked), `pnpm lint` 0, `pnpm typecheck` 0, `pnpm test` 1 passed (1), `pnpm coverage` 0 con `Lines : 100%`. Ficheros idénticos a la ficha, `package.json` con solo las seis dependencias, `node_modules/` y `coverage/` ignorados, sin `apps/`. Las pruebas de rigor y de lint quedan documentadas por el programador; las revisará el tester.

### [tester] ronda 1 — 2026-10-17 — PASA
| Criterio | Resultado | Evidencia |
|---|---|---|
| install sin errores/unmet peer, lockfile con pnpmfileChecksum | OK | `rm -rf node_modules coverage && pnpm install --frozen-lockfile` código 0, 0 líneas con unmet/warn; lockfile línea 7 `pnpmfileChecksum: sha256-31Cb...` |
| lint | OK | código 0, sin salida |
| typecheck | OK | código 0, sin salida |
| test | OK | `Test Files 1 passed (1)`, `Tests 1 passed (1)` |
| coverage | OK | código 0, `Lines : 100% ( 1/1 )` |
| Rigor TS2322 | OK | `packages/shared/src/index.ts(2,31): error TS2322: Type 'string \| undefined' is not assignable to type 'string'.` código 1; revertido con git checkout, typecheck vuelve a 0 |
| Lint (3 errores) | OK | `2:10 no-unused-vars`, `3:34 no-explicit-any`, `4:3 no-console`; `✖ 3 problems (3 errors, 0 warnings)`, código 1; revertido, lint vuelve a 0 |
| git status limpio de node_modules/coverage | OK | solo aparece la ficha modificada |
| Solo seis dependencias | OK | `typescript6` ausente de ambos package.json, 11 apariciones solo en lockfile; sin `apps/` |

Tests añadidos: ninguno (el test de humo cubre el alcance). Rendimiento: no aplica (test completo ~200 ms).
