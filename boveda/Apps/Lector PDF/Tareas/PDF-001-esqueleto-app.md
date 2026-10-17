---
tipo: tarea
id: PDF-001
titulo: Crear el esqueleto de la app lector-pdf
app: pdf
estado: pendiente
depende_de: [COM-004]
intentos: 0
skills: [stack-typescript-react, pruebas-calidad, formatos-ofimatica, calidad-profesional]
creado: 2026-10-17
actualizado: 2026-10-17
tags: [tarea, pdf, esqueleto]
---

# PDF-001 · Esqueleto de la app lector-pdf

Plan: [[Apps/Lector PDF/Plan|Plan]] · Decisiones: [[ADR-0007-motor-y-visor-pdf]] · [[ADR-0010-stack-apps-web-y-pruebas]]

## Objetivo
`apps/lector-pdf` arranca con Vite + React, muestra la pantalla vacía ("Abre un PDF para empezar") con tema claro/oscuro según el sistema, y tiene funcionando: lint, typecheck, tests unitarios (node), tests de componentes (jsdom), e2e con Playwright y la copia de recursos de pdf.js.

## Contexto
- Leer: [[ADR-0010-stack-apps-web-y-pruebas]] (versiones exactas), `vitest.config.ts` y `eslint.config.js` de la raíz (COM-004), `packages/shared/src/index.ts`.
- Playwright **1.56.1** usa el Chromium de `/opt/pw-browsers` (variable `PLAYWRIGHT_BROWSERS_PATH` ya definida). **No** ejecutes `playwright install`.
- Los tests de `tests/ui/` llevan en la primera línea `// @vitest-environment jsdom`.

## Qué hay que hacer
1. `apps/lector-pdf/package.json`:
   ```json
   {
     "name": "lector-pdf", "version": "0.1.0", "private": true, "type": "module",
     "scripts": {
       "assets": "node scripts/copy-pdfjs-assets.mjs",
       "dev": "pnpm assets && vite",
       "build": "pnpm assets && vite build",
       "preview": "vite preview --port 4173 --strictPort",
       "typecheck": "tsc -p tsconfig.json",
       "e2e": "playwright test"
     },
     "dependencies": { "@suite/platform": "workspace:*", "@suite/shared": "workspace:*", "pdfjs-dist": "6.4.299",
       "react": "19.3.1", "react-dom": "19.3.1", "zustand": "5.0.15" },
     "devDependencies": { "@playwright/test": "1.56.1", "@testing-library/dom": "10.4.2", "@testing-library/jest-dom": "7.0.1",
       "@testing-library/react": "16.3.3", "@testing-library/user-event": "14.6.8", "@types/node": "22.20.5",
       "@types/react": "19.3.0", "@types/react-dom": "19.3.0", "@vitejs/plugin-react": "6.1.2", "jsdom": "30.1.3", "vite": "8.3.4" }
   }
   ```
   Si COM-005 aún no existe cuando hagas esta ficha, quita `@suite/platform` y anótalo (lo añade PDF-008).
2. `tsconfig.json`: extiende `../../tsconfig.base.json`; `lib: ["es2023","dom","dom.iterable"]`, `jsx: "react-jsx"`, `types: ["vite/client","node"]`; `include: ["src","tests","vite.config.ts","vitest.config.ts","playwright.config.ts"]`.
3. `vite.config.ts`: `plugins: [react(), cspPlugin()]`, `base: './'`, `build: { target: 'es2023', sourcemap: true }`, `worker: { format: 'es' }`, `server: { port: 5173, strictPort: true }`. `cspPlugin()` (en el mismo fichero) con `apply: 'build'` y `transformIndexHtml` que inserta en `<head>`:
   `<meta http-equiv="Content-Security-Policy" content="default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; worker-src 'self' blob:; style-src 'self' 'unsafe-inline'; img-src 'self' blob: data:; font-src 'self' blob: data:; connect-src 'self' blob: data:; object-src 'none'; base-uri 'none'; form-action 'none'">`
4. `vitest.config.ts`: `defineProject({ plugins: [react()], test: { name: 'lector-pdf', include: ['tests/unit/**/*.test.ts', 'tests/ui/**/*.test.tsx'], environment: 'node', setupFiles: ['tests/setup/setup.ts'], alias: [{ find: /^pdfjs-dist$/, replacement: 'pdfjs-dist/legacy/build/pdf.mjs' }] } })`. `tests/setup/setup.ts`: `import '@testing-library/jest-dom/vitest';` y `afterEach(cleanup)` de Testing Library.
   Si en COM-004 se quitó `apps/*/vitest.config.ts` de los proyectos de la raíz, vuelve a añadirlo.
5. `playwright.config.ts`: `testDir: 'tests/e2e'`, `timeout: 60_000`, `expect.timeout: 10_000`, `workers: 2`, `retries: 0`, `reporter: 'list'`, `use: { baseURL: 'http://localhost:4173', trace: 'retain-on-failure', screenshot: 'only-on-failure' }`, un proyecto `chromium` con `devices['Desktop Chrome']`, `webServer: { command: 'pnpm build && pnpm preview', url: 'http://localhost:4173', reuseExistingServer: false, timeout: 180_000 }`.
6. `scripts/copy-pdfjs-assets.mjs`: resuelve la carpeta de `pdfjs-dist` con `createRequire(import.meta.url).resolve('pdfjs-dist/package.json')` y copia (`fs.cpSync(..., { recursive: true })`) `cmaps`, `standard_fonts`, `wasm` e `iccs` a `public/pdfjs/<carpeta>/`. Idempotente. Escribe una sola línea en `process.stdout` con lo copiado.
7. `index.html` (`lang="es"`, `<title>Lector PDF</title>`, `<div id="root">`, script `/src/main.tsx`).
8. `src/engine/styles.ts`: una sola línea `import 'pdfjs-dist/web/pdf_viewer.css';` (la regla de lint impide importar `pdfjs-dist` fuera de `engine/`). `src/main.tsx`: importa `./ui/theme.css`, `./engine/styles` y `./engine/worker`, y monta `<App />` con `createRoot` dentro de `<StrictMode>`.
9. `src/engine/worker.ts`: `import { GlobalWorkerOptions } from 'pdfjs-dist'; import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'; GlobalWorkerOptions.workerSrc = workerUrl;` — importado solo desde `main.tsx` (nunca desde tests).
10. `src/core/title.ts`: `export function windowTitle(fileName: string | null, dirty: boolean): string` → `null` → `"Lector PDF"`; `"a.pdf", false` → `"a.pdf — Lector PDF"`; `"a.pdf", true` → `"• a.pdf — Lector PDF"`.
11. `src/ui/messages.ts`: `export const msg = { appName: 'Lector PDF', emptyTitle: 'Abre un PDF para empezar', emptyHint: 'Arrastra un fichero a esta ventana o pulsa «Abrir».', open: 'Abrir…', toolbarLabel: 'Barra de herramientas' } as const;`. Toda cadena visible sale de aquí.
12. `src/ui/theme.css`: variables en `:root` (claro) y en `@media (prefers-color-scheme: dark)` + `:root[data-theme='dark']` (oscuro), con `:root[data-theme='light']` forzando claro: `--color-bg`, `--color-surface`, `--color-surface-2`, `--color-text`, `--color-text-muted`, `--color-border`, `--color-accent`, `--color-accent-text`, `--color-focus`, `--color-viewer-bg`, `--color-danger`, `--shadow-page`, `--font-ui` (system-ui), `--radius`. Contraste de texto ≥ 4,5:1 en ambos. Foco visible (`:focus-visible { outline: 2px solid var(--color-focus) }`). Tamaños en `rem` para respetar el escalado.
13. `src/ui/kit/IconButton.tsx`: `{ label: string; shortcut?: string; onClick?: () => void; disabled?: boolean; pressed?: boolean; children: ReactNode }` → `<button type="button" aria-label={label} title={shortcut ? `${label} (${shortcut})` : label} aria-pressed={pressed}>`. CSS Module `IconButton.module.css`.
14. `src/ui/icons.tsx`: componentes SVG 20×20 `currentColor` con `aria-hidden`: `IconOpen`. (Las fichas siguientes añaden iconos aquí.)
15. `src/ui/App.tsx`: `<header role="toolbar" aria-label={msg.toolbarLabel}>` con un `IconButton` "Abrir…" (sin acción aún) y `<main>` con el estado vacío (`<h1>`{msg.emptyTitle}`</h1>` y la pista). CSS Module `App.module.css`.
16. Tests: `tests/unit/title.test.ts`, `tests/ui/app.test.tsx` (renderiza `<App/>` y encuentra el título y el botón por rol), `tests/e2e/smoke.spec.ts` (carga `/`, ve el `h1`, el botón `Abrir…` y ningún error en `console` (`page.on('console')` de tipo `error`)).

## Criterios de aceptación
- [ ] `pnpm install`, `pnpm lint`, `pnpm typecheck`, `pnpm test` (aparece `|lector-pdf|`), `pnpm coverage` con código 0.
- [ ] `pnpm --filter lector-pdf build` termina con código 0; `dist/index.html` contiene la meta CSP; `public/pdfjs/cmaps/` y `public/pdfjs/wasm/` existen tras `pnpm --filter lector-pdf assets` y **no** aparecen en `git status`.
- [ ] `pnpm --filter lector-pdf e2e` → 1 test en verde.
- [ ] (T) `windowTitle` cumple los 3 casos del paso 10.
- [ ] (T) `getByRole('button', { name: 'Abrir…' })` existe y tiene `title`.
- [ ] Sin cadenas de interfaz en JSX fuera de `messages.ts` (revisión manual del revisor).

## Fuera de alcance
- Abrir ficheros (PDF-008), visor, Tauri (PDF-021), selector de tema (PDF-020).

## Registro
<!-- Cada agente añade aquí su entrada al terminar; no borrar las anteriores. -->
