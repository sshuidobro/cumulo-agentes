---
tipo: decision
id: ADR-0006
app: comun
estado: aceptada
fecha: 2026-10-17
creado: 2026-10-17
actualizado: 2026-10-17
tags: [decision, stack, comun, lint]
---

# ADR-0006 · ESLint en el monorepo (convivencia con TypeScript 7)

## Contexto
[[ADR-0004-herramientas-monorepo]] dejó el monorepo sin ESLint. Las normas de `CLAUDE.md` permiten al líder añadir herramientas estándar del stack (skill `stack-typescript-react`: ESLint flat config + typescript-eslint). Queremos que `pnpm lint` detecte `console.*`, imports sin usar, `any` explícito y `@ts-ignore`, que hoy vigila el revisor a mano.

Problema: el proyecto usa **TypeScript 7.0.2** (compilador nativo). Su paquete `typescript` ya no expone la API de JavaScript que necesita typescript-eslint. Comprobado el 2026-10-17 con `npm view` y en un borrador fuera del repositorio:
- `typescript-eslint@8.71.2` (última, también la canary) declara `peerDependencies.typescript: ">=4.8.4 <6.1.0"` y al cargar con TS 7 lanza `Error: typescript-eslint does not support TS 7.0.`
- Microsoft publica `@typescript/typescript6@6.0.2`, que reexporta la API de TypeScript 6 (bin `tsc6`, no choca con `tsc`).
- `pnpm.overrides` y `packageExtensions` **no** cambian la resolución de un *peer* (probado: sigue cogiendo 7.0.2).

## Opciones consideradas
| Opción | Ventajas | Inconvenientes | Licencia |
|---|---|---|---|
| A. Sin ESLint hasta que typescript-eslint admita TS 7 | Cero cambios | Revisión manual de `console.log`, `any`, imports sin usar | — |
| B. Bajar todo el proyecto a TypeScript 6 | Configuración estándar | Contradice ADR-0004 y la skill; replanificar | Apache-2.0 |
| C. Alias `"typescript": "npm:@typescript/typescript6"` + TS 7 con otro nombre | Declarativo | `typescript` dejaría de ser TS 7 (confunde a editores y personas) | Apache-2.0 |
| **D. Hook `.pnpmfile.cjs`**: los paquetes de typescript-eslint usan `@typescript/typescript6` como dependencia propia; el proyecto sigue con `typescript@7.0.2` | `tsc` y `typescript` siguen siendo TS 7; un fichero de 20 líneas; se borra cuando typescript-eslint admita TS 7 | Un hook de instalación que hay que conocer | MIT (ESLint, typescript-eslint), Apache-2.0 (TS 6) |

## Decisión
Opción **D**, con lint **sin información de tipos** (más rápido y sin depender de que TS 6 entienda el `tsconfig.json`).
- devDependencies exactas en la raíz: `eslint@10.13.0`, `@eslint/js@10.0.1`, `typescript-eslint@8.71.2`. `@typescript/typescript6@6.0.2` llega solo a través del hook (no es dependencia directa).
- `.pnpmfile.cjs` con `readPackage`: para `typescript-eslint`, `ts-api-utils` y `@typescript-eslint/*`, quita el *peer* `typescript` y añade `dependencies.typescript = "npm:@typescript/typescript6@6.0.2"`.
- `eslint.config.js` (flat config, `defineConfig`): `js.configs.recommended` + `tseslint.configs.strict` + reglas `no-console`, `@typescript-eslint/no-explicit-any`, `@typescript-eslint/no-unused-vars`, `@typescript-eslint/consistent-type-imports`, `@typescript-eslint/ban-ts-comment` (`@ts-expect-error` solo con descripción), todas en `error`. Ignora `node_modules`, `coverage`, `dist`, `boveda/` y `ejemplos/`. Bloque `**/*.cjs` en CommonJS.
- Script `"lint": "eslint --max-warnings 0 ."`. Node `>=22.13` (lo exige ESLint 10; antes `>=22.12`).
- Texto exacto de los ficheros: [[COM-001-esqueleto-monorepo]].

Probado en borrador (2026-10-17, Node 22.22.0, pnpm 10.28.0): `pnpm install` sin avisos de *peer*, `pnpm install --frozen-lockfile` OK, `lint` + `typecheck` + `test` + `coverage` en verde. Un fichero con import sin usar, `any`, `console.log` y `@ts-ignore` da 4 errores (`no-unused-vars`, `no-explicit-any`, `no-console`, `ban-ts-comment`) y código de salida 1.

## Consecuencias
- `pnpm lint` entra en la comprobación completa de todas las fichas.
- `tseslint.configs.strict` incluye `no-non-null-assertion`: con `noUncheckedIndexedAccess` hay que estrechar (`if (x === undefined) ...`) en vez de usar `!`.
- Pendiente: reglas de React (`eslint-plugin-react-hooks`) cuando llegue la primera app; lint con tipos (`strictTypeChecked`) cuando typescript-eslint admita TS 7.
- **Vigilar** la issue typescript-eslint #10940: cuando una versión admita TS 7, borrar `.pnpmfile.cjs`, subir typescript-eslint y anotarlo en un ADR que sustituya a este.
