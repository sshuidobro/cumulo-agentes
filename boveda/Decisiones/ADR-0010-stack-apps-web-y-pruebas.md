---
tipo: decision
id: ADR-0010
app: comun
estado: aceptada
fecha: 2026-10-17
creado: 2026-10-17
actualizado: 2026-10-17
tags: [decision, stack, comun, pruebas]
---

# ADR-0010 · Dependencias de las apps web y de sus pruebas

## Contexto
Primera app con interfaz (lector PDF). [[ADR-0001-tecnologia]] fija React + Vite + Tauri; la skill `stack-typescript-react` recomienda zustand, Testing Library y Playwright. Versiones comprobadas con `npm view` el 2026-10-17. Chromium preinstalado en `/opt/pw-browsers` es la revisión **1194**, que corresponde a **Playwright 1.56.1** (1.64.1 pide la 1248; no se puede ejecutar `playwright install`).

## Opciones consideradas
| Tema | Opción elegida | Alternativa descartada | Motivo |
|---|---|---|---|
| Virtualización | Propia (`core/layout.ts`) | `@tanstack/react-virtual` | Necesitamos escalado de scroll > 8 M px y anclaje con tamaños que llegan tarde ([[ADR-0007-motor-y-visor-pdf]]) |
| Estado | `zustand` | Context + reducer | Selectores finos (skill) |
| Componentes | Propios en `src/ui/kit/` | Librería de componentes | Sin dependencias pesadas; se extraerán a `packages/ui-kit` con la 2.ª app |
| Iconos | SVG propios (`src/ui/icons.tsx`) | Paquete de iconos | Pocos iconos, sin dependencia |
| E2E | Playwright 1.56.1 | 1.64.1 | Navegador instalado |
| DOM de tests | jsdom | happy-dom | Más completo; recomendado por Testing Library |

## Decisión
Dependencias exactas (licencia MIT salvo indicación):
- Ejecución (`apps/lector-pdf`): `react@19.3.1`, `react-dom@19.3.1`, `zustand@5.0.15`, `pdfjs-dist@6.4.299` (Apache-2.0), `fflate@0.8.3` (desde la iteración 2).
- Desarrollo de la app: `vite@8.3.4`, `@vitejs/plugin-react@6.1.2`, `@types/react@19.3.0`, `@types/react-dom@19.3.0`, `@types/node@22.20.5`, `jsdom@30.1.3`, `@testing-library/react@16.3.3`, `@testing-library/dom@10.4.2`, `@testing-library/user-event@14.6.8`, `@testing-library/jest-dom@7.0.1`, `@playwright/test@1.56.1` (Apache-2.0), `@tauri-apps/cli@2.12.3` (MIT/Apache).
- Raíz (lint): `eslint-plugin-react-hooks@7.1.1`, `globals@17.13.0`.
- `@suite/platform`: `@tauri-apps/api@2.12.4`, `@tauri-apps/plugin-opener@2.7.2` (MIT/Apache); desarrollo `jsdom@30.1.3`, `fake-indexeddb@6.2.6` (Apache-2.0).
- Vitest con **proyectos** (`test.projects`): cada paquete/app tiene su `vitest.config.ts`; `core/` en entorno `node`, `ui/` en `jsdom`. Cobertura global (umbral 80 % de líneas) sobre `packages/*/src` y `apps/*/src/core`.
- Typecheck: `tsconfig.base.json` común; cada paquete con DOM tiene su `tsconfig.json` y su script `typecheck`; la raíz los encadena.
- Herramientas del sistema para pruebas (no son dependencias npm): `qpdf` (apt, validar PDFs escritos), `soffice` y `pdftotext` (ya instalados).

## Consecuencias
- `pnpm test` ejecuta todos los proyectos; `pnpm e2e` ejecuta Playwright de cada app sobre la build web (`vite preview`).
- Subir Playwright exige actualizar el Chromium de `/opt/pw-browsers` a la vez.
- Prettier sigue fuera (no aporta a la verificación); se puede añadir con un ADR.
