---
name: stack-typescript-react
description: Normas de experto para escribir el frontend de las apps en TypeScript + React + Vite (estructura, tipos, estado, rendimiento, accesibilidad). Úsala siempre que escribas, revises o planifiques código TypeScript o componentes React de la suite.
---

# TypeScript + React en la suite ofimática

Versiones de referencia (octubre 2026, comprobar con `npm view <paquete> version` antes de fijar): React 19.3, TypeScript 7.0, Vite 8, Vitest 5, ESLint 10. Gestor de paquetes: **pnpm** con workspaces. Herramientas estándar ya aprobadas para todo el monorepo: ESLint (flat config + typescript-eslint + eslint-plugin-react-hooks), Prettier, `@vitest/coverage-v8`, `@testing-library/*`, Playwright.

## Estructura del monorepo
```
apps/<app>/            una app por carpeta (lector-pdf, procesador-texto, hoja-calculo, presentaciones)
  src/
    core/              lógica pura sin React ni Tauri: modelo de documento, parsers, comandos. 100% testeable en Node.
    ui/                componentes React (solo presentación + llamadas a core)
    platform/          acceso a ficheros/ventanas a través de packages/platform
  tests/               unitarios (Vitest) y e2e (Playwright)
packages/
  platform/            interfaz única de E/S: implementación Tauri y implementación navegador
  ui-kit/              componentes comunes: barra de herramientas, menús, diálogos, iconos, tema
  shared/              utilidades comunes (undo/redo, atajos, i18n)
```
Regla de oro: **el núcleo no importa React ni Tauri**. Así el tester prueba la lógica sin interfaz y la misma app funciona en navegador y escritorio.

## TypeScript
- `strict: true`, `noUncheckedIndexedAccess: true`, `exactOptionalPropertyTypes: true`. Prohibido `any` (usa `unknown` y estrecha). Prohibido `// @ts-ignore`; si hace falta, `// @ts-expect-error <motivo>`.
- Modela el documento con tipos inmutables (`readonly`) y uniones discriminadas (`type Node = Paragraph | Table | Image`). Nada de clases con estado escondido en el modelo.
- Errores esperables (fichero corrupto, formato no soportado) como valores: `type Result<T> = { ok: true; value: T } | { ok: false; error: AppError }`. `throw` solo para bugs.
- Exporta tipos públicos desde un `index.ts` por módulo; no importes rutas internas de otro paquete.

## React
- Solo componentes de función y hooks. Sin `useEffect` para derivar datos (calcúlalo en el render o con `useMemo`); `useEffect` solo para sincronizar con algo externo (eventos, timers, Tauri).
- Estado del documento en un store (**zustand**) con selectores finos (`useDoc(s => s.selection)`) para no re-renderizar todo el documento al teclear.
- **Toda modificación del documento es un comando** (`apply(doc, cmd) -> doc`) que pasa por la pila de deshacer/rehacer de `packages/shared`. Nunca mutar el documento desde un componente.
- Listas largas (páginas de PDF, filas de hoja de cálculo, diapositivas): **virtualización** siempre; nunca renderizar 10 000 nodos.
- Trabajo pesado (parsear un PDF de 500 páginas, recalcular una hoja) en **Web Workers**, nunca en el hilo principal. La UI no se puede congelar más de 100 ms.
- Estilos: CSS Modules + variables CSS para el tema (claro/oscuro). Sin librerías de componentes pesadas salvo decisión en un ADR.

## Accesibilidad e idioma
- Todo control usable con teclado; foco visible; `aria-label` en botones solo-icono; roles ARIA correctos en menús y diálogos.
- Textos de la interfaz en español, centralizados en un fichero de mensajes (nada de cadenas sueltas en JSX), preparado para añadir idiomas.
- Atajos de teclado estándar de ofimática (Ctrl+S, Ctrl+Z, Ctrl+Y, Ctrl+F, Ctrl+P, Ctrl+B/I/U...) definidos en un único registro de atajos.

## Calidad mínima de cada cambio
- `pnpm lint`, `pnpm typecheck` y `pnpm test` sin errores ni avisos nuevos.
- Funciones de `core/` con tests unitarios; componentes con al menos un test de interacción (Testing Library) si tienen lógica.
- Nada de `console.log` olvidados; logs a través del logger común.
