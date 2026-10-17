---
tipo: decision
id: ADR-0004
app: comun
estado: aceptada
fecha: 2026-10-17
creado: 2026-10-17
actualizado: 2026-10-17
tags: [decision, stack, comun]
---

# ADR-0004 · Herramientas y versiones del monorepo

## Contexto
Primer código del repositorio: monorepo mínimo para `packages/shared`. El usuario limita las dependencias a pnpm, TypeScript y Vitest en esta prueba. Base: [[ADR-0001-tecnologia]] y skill `stack-typescript-react`. Versiones comprobadas con `npm view` el 2026-10-17. Configuración probada por el líder en un borrador fuera del repositorio (install + typecheck + test + coverage en verde).

## Opciones consideradas
| Opción | Ventajas | Inconvenientes | Licencia |
|---|---|---|---|
| pnpm workspaces + un `tsconfig.json` raíz + `vitest.config.ts` raíz, paquetes solo fuente (sin build) | Mínimo; un comando para todo; las apps Vite importarán el `.ts` directamente | Cuando haya apps habrá que añadir `tsconfig` por app | MIT / Apache-2.0 |
| Project references (`tsc -b`) con build de cada paquete a `dist/` | Escala mejor en monorepos grandes | Más configuración y ficheros generados; innecesario con 1 paquete | — |
| Turborepo/Nx | Caché de tareas | Dependencia no autorizada | — |

## Decisión
- Node `>=22.12`, pnpm `10.28.0` (`packageManager`), módulos ES (`"type": "module"`).
- Dependencias de desarrollo **exactas** en la raíz: `typescript@7.0.2`, `vitest@5.0.5`, `@vitest/coverage-v8@5.0.5` (proveedor oficial de cobertura de Vitest; necesario para el 80 % de `pruebas-calidad`).
- Un `tsconfig.json` raíz: `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `noImplicitOverride`, `verbatimModuleSyntax`, `module: preserve`, `moduleResolution: bundler`, `noEmit`, `types: []`. Imports relativos **sin extensión** (`'../src/index'`).
- Paquetes internos se llaman `@suite/<nombre>` y exportan su fuente: `"exports": { ".": "./src/index.ts" }`.
- **Sin ESLint en esta iteración** (no autorizado). `pnpm lint` no existe todavía; el control de calidad mínimo es `pnpm typecheck` + `pnpm test` + `pnpm coverage`.

## Consecuencias
- Cero ficheros generados; arranque rápido.
- Falta lint: `console.log`, imports sin usar, etc. los vigila el revisor a mano hasta que un ADR añada ESLint 10 (pendiente de autorización del usuario).
- `@types/node` no se instala: el código de `packages/shared` no puede usar APIs de Node (correcto: también corre en el navegador).

## Actualización 2026-10-17 · ESLint
- ESLint queda cubierto por [[ADR-0006-eslint]]: se añaden `eslint@10.13.0`, `@eslint/js@10.0.1`, `typescript-eslint@8.71.2`, `.pnpmfile.cjs` y `eslint.config.js`, y existe `pnpm lint`.
- Node pasa a `>=22.13` (lo exige ESLint 10).
- El resto de esta decisión sigue vigente (TypeScript 7.0.2, Vitest, `tsconfig.json`, paquetes solo fuente).
