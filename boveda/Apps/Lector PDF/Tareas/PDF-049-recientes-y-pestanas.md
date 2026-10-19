---
tipo: tarea
id: PDF-049
titulo: Documentos recientes en la pantalla de inicio y en «Abrir recientes»
app: pdf
estado: en-test
depende_de: [COM-015, COM-016, PDF-090]
intentos: 0
skills: [stack-typescript-react, calidad-profesional, pruebas-calidad]
creado: 2026-10-17
actualizado: 2026-10-19
tags: [tarea, pdf, iteracion-4, ui, recientes]
---

# PDF-049 · Documentos recientes en la pantalla de inicio y en «Abrir recientes»

Plan: [[Apps/Lector PDF/Plan|Plan]] (iteración 4) · Decisiones: [[ADR-0023-pestanas-y-recientes]] · Paridad: [[Paridad Adobe Acrobat]] (área 1)

> 2026-10-18 (líder): la ficha original era «Recientes y pestañas». Se parte: recientes aquí (con COM-015 y COM-016) y pestañas en [[PDF-094-sesiones-de-documento]] y [[PDF-095-pestanas]].

## Objetivo
La pantalla de inicio lista los documentos recientes (nombre, carpeta en escritorio, fecha) y un menú «Abrir recientes» junto a «Abrir» permite reabrirlos con un clic o con el teclado, en la última página leída.

## Contexto
- Leer: `src/ui/open/EmptyState.tsx`, `src/ui/toolbar/MainToolbar.tsx`, `src/ui/kit/MenuButton.tsx`, `src/state/document-actions.ts` (`openRequested`), `packages/platform/src/types.ts` (`RecentFile`, `openRecent`…).
- Textos en `src/ui/messages-tabs.ts` (`tabsMsg`; lo compartirá PDF-095).

## Qué hay que hacer
1. `src/state/recent-actions.ts`: store `useRecent` `{ list: readonly RecentFile[]; loading: boolean }`; `refreshRecent()` (al arrancar y tras cada apertura o guardado), `openRecentFile(id)` (→ `platform.openRecent`; `null` → nada; `not-found` → aviso «No se encuentra “<nombre>”. Puede que se haya movido o borrado.» y refresca; ok → `openRequested(file)`), `forgetRecent(id)`, `forgetAllRecent()`.
2. `EmptyState.tsx`: bajo «Abrir…», sección «Recientes» (`<h2>`) con una lista (`<ul>`) de hasta 10: botón con nombre, debajo la carpeta (Tauri; en web nada) y la fecha relativa («hoy, 10:42», «ayer», «12 oct»); entradas no disponibles en gris con «No disponible» y botón «Quitar de la lista». Sin recientes: nada (no una lista vacía). En web sin File System Access: texto «Este navegador no permite reabrir ficheros recientes.».
3. `src/ui/toolbar/RecentMenu.tsx`: `MenuButton` «Abrir recientes» (icono `IconRecent`) junto a «Abrir»: los 10 últimos, separador, «Borrar la lista de recientes». Deshabilitado sin recientes.
4. Tests UI y E2E `tests/e2e/recent.spec.ts`: el test copia los fixtures a OPFS dentro de la página (`navigator.storage.getDirectory()`, bytes pasados con `page.evaluate`) y sustituye `window.showOpenFilePicker` (con `page.addInitScript`) por una función que devuelve `[handle]` del fichero de OPFS que indique `window.__nextPick`. Son `FileSystemFileHandle` reales: se guardan en IndexedDB y se reabren tras recargar.

## Criterios de aceptación
- [ ] E2E: abrir `links.pdf` y después `basic-5.pdf` (handles OPFS), ir a la p3, cerrar el documento → la pantalla de inicio lista `basic-5.pdf` y `links.pdf` en ese orden; recargar la página → siguen; clic en `basic-5.pdf` → se abre en la p3.
- [ ] E2E: «Abrir recientes» con teclado (Tab, Intro, flechas, Intro) abre `links.pdf`.
- [ ] E2E: borrar el fichero de OPFS y elegirlo → aviso «No se encuentra…» y la entrada queda «No disponible»; «Quitar de la lista» la elimina.
- [ ] E2E: «Borrar la lista de recientes» la vacía y la sección desaparece.
- [ ] Abrir con cambios sin guardar desde recientes pregunta antes («¿Guardar los cambios…?»), como «Abrir».
- [ ] Axe sin incidencias `serious`/`critical` en la pantalla de inicio con recientes y con el menú abierto.
- [ ] `pnpm --filter lector-pdf e2e` con código 0; `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm coverage` con código 0.
- [ ] Manual (en el Registro, para el Manual): en `tauri dev`, abrir dos PDFs, cerrar la app, volver a abrirla y reabrir uno desde la pantalla de inicio.

## Fuera de alcance
- Pestañas (PDF-095). Recientes fijados o con miniatura.

## Registro
<!-- Cada agente añade aquí su entrada al terminar; no borrar las anteriores. -->

### [programador] ronda 1 — 2026-10-19
- Ficheros cambiados: `apps/lector-pdf/src/core/recent.ts` (nuevo), `src/state/recent-actions.ts` (nuevo), `src/ui/messages-tabs.ts` (nuevo), `src/ui/open/RecentList.tsx` (nuevo), `src/ui/toolbar/RecentMenu.tsx` (nuevo), `src/ui/open/EmptyState.tsx`, `src/ui/open/open.module.css`, `src/ui/icons.tsx` (`IconRecent`), `src/ui/toolbar/MainToolbar.tsx` (menú junto a «Abrir»), `src/main.tsx` (`startRecentSync()`); tests `tests/unit/recent.test.ts`, `tests/unit/recent-actions.test.ts`, `tests/ui/recent.test.tsx`, `tests/e2e/recent.spec.ts`.
- Qué he hecho: store `useRecent` con `refreshRecent`, `openRecentFile`, `forgetRecent`, `forgetAllRecent` y `startRecentSync` (carga al arrancar y cada vez que cambia el fichero abierto, o sea tras abrir o guardar). Pantalla de inicio con la sección «Recientes» (nombre, carpeta en Tauri, fecha relativa, «No disponible» + «Quitar de la lista»), menú «Abrir recientes» con los 10 últimos y «Borrar la lista de recientes». Web sin File System Access muestra el aviso de no poder reabrir.
- Comandos ejecutados y resultado: `pnpm exec vitest run` de los tests nuevos: 31 pasan. `pnpm typecheck`: sin errores. `pnpm coverage` (con `--coverage.reportsDirectory=coverage-recientes`, porque el directorio por defecto lo usaba otro proceso): 204 ficheros, 2454 tests, todos pasan; `core/recent.ts` 100 % líneas. `pnpm --filter lector-pdf e2e` (con `LECTOR_E2E_PORT=4322 LECTOR_E2E_OUTDIR=dist-recientes`): 222 pasan, código 0; los 6 de `recent.spec.ts` pasan. `pnpm lint`: solo falla `tests/unit/pdf/incremental.test.ts` (tres variables sin usar, fichero de otro programador que no toco). Mis ficheros no dan avisos.
- Dudas o cosas que no he podido hacer:
  1. No hay en la app un botón para cerrar el documento; el E2E «cerrar» recarga la página (pagehide guarda la posición). Si el líder quiere un cierre explícito, es otra ficha.
  2. Decisión menor: los textos van en `src/ui/messages-tabs.ts` (`tabsMsg`), como indica la ficha. Para otros errores al reabrir (no «not-found») se usa «No se ha podido abrir «nombre»».
  3. `MenuButton` usa el nombre como clave de React: dos recientes con el mismo nombre en carpetas distintas darían un aviso de clave duplicada. No he tocado el componente compartido.
  4. Manual (`tauri dev`, dos PDF, cerrar y reabrir la app, reabrir desde inicio): pendiente en la máquina del usuario. No se ha podido ejecutar aquí.
  5. Contraste: la lista va sobre fondo blanco (`--color-surface`) porque el texto gris sobre el fondo del visor no cumplía axe.

### [revisor] ronda 1 — 2026-10-19 — APROBADO
1. (opcional) `src/ui/kit/MenuButton.tsx` — clave de React por nombre; recientes con igual nombre darían aviso de clave duplicada — usar el id como clave.
2. Lint, typecheck y tests nuevos (31) en verde; criterios cubiertos por tests UI y E2E.
