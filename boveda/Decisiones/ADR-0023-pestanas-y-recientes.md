---
tipo: decision
id: ADR-0023
app: pdf
estado: aceptada
fecha: 2026-10-18
creado: 2026-10-18
actualizado: 2026-10-18
tags: [decision, pdf, ui, plataforma]
---

# ADR-0023 · Pestañas por sesiones intercambiables y recientes guardados por la plataforma

## Contexto
Adobe Reader abre varios documentos en pestañas y recuerda los recientes ([[Paridad Adobe Acrobat]], área 1, importante). La app está hecha para **un** documento: stores zustand únicos (`useViewer`, `useAnnotations`, `useSearch`, `useForms`) y estado de módulo en `src/state/*.ts` (sesión del documento, pila de deshacer, historial atrás/adelante, búsqueda, borradores, posición). Plataforma: [[ADR-0008-plataforma-ficheros]].

## Opciones consideradas
| Opción | Ventajas | Inconvenientes |
|---|---|---|
| A. Stores por documento (refactor de todo `state/` y de los selectores de `ui/`) | Varios documentos «vivos» a la vez | Toca casi todos los ficheros; alto riesgo de regresión |
| **B. Sesiones intercambiables: un documento activo; al cambiar de pestaña se suspende su estado (instantánea) y se reanuda el de la otra** | Los componentes no cambian; un solo sitio por módulo (`suspend`/`resume`) | Las tareas en segundo plano de la pestaña inactiva se pausan y se reanudan |
| C. Una ventana por documento (Tauri) / pestaña del navegador (web) | Aislamiento total | No es como Adobe; en web no se puede pasar el fichero a otra pestaña sin volver a pedirlo |

Recientes: el navegador no puede reabrir un fichero sin permiso del usuario; con File System Access (Chromium) se puede guardar el `FileSystemFileHandle` en IndexedDB y pedir permiso al reabrir. En Tauri, reabrir una ruta debe ser seguro: solo rutas que el propio usuario eligió.

## Decisión
**Pestañas con la opción B** (`src/state/tabs.ts`):
- Cada pestaña guarda la instantánea de los cuatro stores y de cada módulo de `state/` con estado de documento, mediante un par `suspendX(): XSnapshot` / `resumeX(s)` por módulo. Al cambiar: suspender la activa → reanudar la otra. Durante el cambio, `isSwitchingTab()` es `true` y los suscriptores que hoy reaccionan a «documento nuevo» (historial, búsqueda, borradores, posición) no se reinician.
- Las tareas en segundo plano de la pestaña que se suspende se **cancelan** y al reanudar se relanzan desde donde iban (importación de anotaciones: solo páginas no importadas; dimensiones: desde la 1, pdf.js tiene las páginas en caché; búsqueda: se repite la consulta).
- El documento pdf.js de una pestaña inactiva sigue abierto (su worker) con `doc.cleanup()` al suspender. Máximo 10 pestañas; al abrir la 11.ª se avisa.
- Ctrl+Tab / Ctrl+Mayús+Tab cambian de pestaña; Ctrl+W y Ctrl+F4 cierran la activa (con el aviso de cambios sin guardar); abrir un documento ya abierto activa su pestaña.

**Recientes en `@suite/platform`** (`recentFiles`, `openRecent`, `removeRecent`, `clearRecents`; se añaden solos al abrir):
- **Web:** IndexedDB `suite-recent-<app>` con `{ id, name, size, openedAt, handle }`; `handle` solo con File System Access (si no, la entrada no se guarda: no se podría reabrir). Reabrir pide permiso (`requestPermission({ mode: 'readwrite' })`, si se niega `'read'`).
- **Tauri:** lista persistida **por Rust** en `app_data_dir()/recent.json` (no la escribe la web): solo entran rutas abiertas por diálogo o por el SO; `suite_recent_open(id)` registra la ruta como si se hubiera elegido. Máximo 20 entradas; las que ya no existen se marcan y se pueden quitar.

## Consecuencias
- Cada ficha futura que añada estado de módulo en `state/` debe añadir su `suspend`/`resume` (regla en el Plan).
- Memoria: los presupuestos se miden con 3 pestañas de PDF grandes (PDF-094).
- La web en Firefox/Safari no tiene recientes reabribles (se explica en el Manual).
