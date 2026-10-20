---
tipo: tarea
id: PDF-112
titulo: Comparar - elegir el segundo PDF, progreso y lista de cambios
app: pdf
estado: hecha
depende_de: [PDF-063, PDF-113, PDF-046]
intentos: 0
skills: [stack-typescript-react, calidad-profesional, pruebas-calidad]
creado: 2026-10-19
actualizado: 2026-10-20
tags: [tarea, pdf, iteracion-6, comparar, ui]
---

# PDF-112 · Comparar: elegir el segundo PDF, progreso y lista de cambios

Plan: [[Apps/Lector PDF/Plan|Plan]] (iteración 6) · Decisiones: [[ADR-0031-comparar-pdfs]], [[ADR-0027-dialogos-diferidos]] · Antes: [[PDF-063-comparar]] · Sigue: [[PDF-117-comparar-paginas]]

## Objetivo
«Más acciones → Comparar con otro PDF…» pide un segundo PDF, compara en segundo plano con progreso y cancelar, y muestra una vista de comparación con la lista de cambios por página.

## Contexto
- [[ADR-0031-comparar-pdfs]] («Vista»).
- `src/core/compare/compare.ts` (PDF-063): `CompareSession`, `PageComparison`, `describeChange`; `src/engine/search-source.ts` → `createPageTextSource`.
- `src/engine` → `loadPdf`, `LoadedPdf`; `src/state/password-prompt.ts` → `askPassword` (contraseña del segundo PDF; nunca se guarda); `src/state/document-actions.ts` → `PDF_FILTERS`; `src/state/services.ts` (`platform`, `assetBaseUrl`); `src/state/viewer-store.ts` (`pdf`, `file`, `status`).
- Patrón de trabajo largo con progreso y cancelar: `src/state/print-actions.ts` (`usePrintJob`, `startPrint`, `cancelPrint`) y `src/ui/print/PrintProgress.tsx`.
- Montaje diferido de diálogos en `src/ui/App.tsx` (`lazy(...)`) y menú `src/ui/toolbar/DocumentMenu.tsx`.
- Lista virtualizada de referencia: `src/ui/sidebar/CommentsPanel.tsx` (`rowLayout`, `visibleRowRange`).

## Qué hay que hacer
1. `src/state/compare-actions.ts`:
```ts
export type CompareStatus = 'idle' | 'loading' | 'running' | 'done';
export interface CompareState {
  readonly status: CompareStatus;
  readonly otherName: string | null;
  readonly results: readonly PageComparison[]; // solo páginas no 'same', en orden
  readonly progress: CompareProgress | null;
  readonly selected: number | null;            // índice en `results`
  readonly cancelled: boolean;
}
export const useCompare: UseBoundStore<StoreApi<CompareState>>;
/** Elige el segundo PDF (platform.openFile(PDF_FILTERS)), lo abre (pide contraseña con askPassword si hace falta) y lanza la comparación. */
export async function startCompare(): Promise<'started' | 'cancelled' | 'failed'>;
export function cancelCompare(): void;        // para la sesión; deja los resultados parciales y `cancelled: true`
export function selectChange(index: number): void;
export function closeCompare(): Promise<void>; // cancela, destruye el segundo documento, closeFile y vuelve a 'idle'
/** Documento B cargado (lo usa PDF-117 para pintar sus páginas). */
export function comparedDocument(): LoadedPdf | null;
```
   - El documento A es el abierto (`useViewer.pdf`). Si cambia el documento abierto (suscripción a `useViewer` por `file`), se llama a `closeCompare()`.
   - Errores al abrir B → aviso con el mensaje de `AppError` («Este fichero no es un PDF.», «La contraseña no es correcta.»…); contraseña cancelada → `'cancelled'` sin aviso.
   - Los resultados se añaden en lotes (como máximo un `setState` cada 100 ms) para no re-renderizar por página.
2. `src/ui/messages-compare.ts` (`compareMsg`): `menuItem` «Comparar con otro PDF…», `title(a, b)` «Comparar «a» con «b»», `progress(done, total)` «Comparando página X de Y…», `cancel` «Cancelar», `close` «Cerrar comparación», `noChanges` «No hay diferencias de texto entre los dos documentos.», `summary(n, pages)` «N cambios en P páginas», `cancelledNote` «Comparación cancelada: se muestran los cambios hasta la página X.», `pageHeader(n)` «Página N», `onlyInA(n)` «La página N solo está en el documento abierto.», `onlyInB(n)` «La página N solo está en el otro documento.», `tooDifferent(n)` «La página N es muy distinta: compárala con la superposición.».
3. `src/ui/compare/CompareView.tsx` (+ `CompareView.module.css`), cargado con `lazy` desde `App.tsx` y montado solo con `status !== 'idle'`: capa a pantalla completa (`role="dialog"`, `aria-modal="true"`, `aria-labelledby` al título), barra superior con título, progreso (`<progress>` + texto) y botones «Cancelar»/«Cerrar comparación»; a la izquierda la lista virtualizada de cambios (filas de 56 px: «Página N» + `describeChange` o el texto de `only-in-*`/`too-different`); a la derecha un hueco `data-testid="compare-pages"` que rellenará PDF-117 (de momento el texto «Selecciona un cambio»). Flechas arriba/abajo mueven la selección, Intro selecciona, Escape cierra (también durante el progreso: cancela y cierra). Foco inicial en la lista; al cerrar vuelve al visor.
4. `DocumentMenu.tsx`: entrada «Comparar con otro PDF…» → `startCompare()`.
5. Tests: `tests/unit/compare-actions.test.ts` (FakePlatform + fixtures reales), `tests/ui/compare-view.test.tsx`, `tests/e2e/compare.spec.ts`.

## Criterios de aceptación
- [ ] E2E: abrir `basic-5.pdf`, «Comparar con otro PDF…», elegir `basic-5-changed.pdf` (con `setInputFiles` en el selector de la plataforma web) → la vista muestra «1 cambio en 1 página» y una única fila «Página 2 · Se ha cambiado “página” por “hoja”.».
- [ ] E2E: comparar `basic-5.pdf` consigo mismo → «No hay diferencias de texto entre los dos documentos.».
- [ ] E2E `@perf`: comparar `pages-5000.pdf` consigo mismo muestra progreso, «Cancelar» lo detiene en < 500 ms y durante la comparación no hay *long tasks* > 100 ms.
- [ ] Unit: segundo PDF cifrado (`encrypted-aes-128.pdf`) pide contraseña con `askPassword`; «usuario» → compara; cancelar → `'cancelled'` y estado `idle`. Un fichero no PDF → aviso «Este fichero no es un PDF.».
- [ ] Unit: cerrar la comparación destruye el documento B (`destroy` espiado) y llama a `closeFile`; abrir otro documento en el visor la cierra.
- [ ] Teclado completo (menú → Intro, lista con flechas, Escape); axe sin violaciones en la vista; textos en `compareMsg`; tema claro y oscuro.
- [ ] `pnpm --filter lector-pdf bundle:check` dentro del presupuesto (la vista va en un *chunk* diferido).
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm coverage`, `pnpm --filter lector-pdf e2e` con código 0.

## Fuera de alcance
- Pintar las páginas, resaltar los cambios y la superposición (PDF-117). Exportar un informe de diferencias.

## Registro
<!-- Cada agente añade aquí su entrada al terminar; no borrar las anteriores. -->

### [programador] ronda 1 — 2026-10-20
- Ficheros cambiados: ninguno en esta ronda. La implementación ya estaba en el commit `754027e` (trabajo de una ronda interrumpida): `src/state/compare-actions.ts`, `src/ui/compare/CompareView.tsx` + `.module.css`, `src/ui/messages-compare.ts`, montaje `lazy` en `src/ui/App.tsx`, entrada en `src/ui/toolbar/DocumentMenu.tsx`, tests `tests/unit/compare-actions.test.ts`, `tests/ui/compare-view.test.tsx`, `tests/e2e/compare.spec.ts`.
- Qué he hecho: he revisado la implementación contra los criterios de aceptación y cada uno tiene su test. He verificado lint, typecheck, cobertura, E2E y presupuesto del bundle.
- Comandos ejecutados y resultado: `pnpm lint` OK; `pnpm typecheck` OK; `pnpm coverage` OK (exit 0; líneas 98,13 %); `pnpm --filter lector-pdf e2e` con 298 pasadas y 1 fallo en `tests/e2e/annotations-layer.spec.ts:151` (`@perf`, long tasks, fuera de esta ficha). Al relanzarlo solo con `--project=chromium-perf --no-deps` pasa (exit 0), así que es inestable por carga. `pnpm --filter lector-pdf build` y `bundle:check` OK (arranque 519 069 bytes de 600 000).
- Dudas o cosas que no he podido hacer: el E2E completo tiene un test `@perf` ajeno (`annotations-layer`) que falló una vez por carga; conviene que lo mire el tester o el líder. No he comprobado visualmente el tema claro/oscuro en navegador; solo en CSS.

- Revisor (coordinador anota): APROBADO, 0 problemas; lint, typecheck y 19 tests OK. Pasa a en-test.

### [tester] ronda 1 — 2026-10-20 — PASA
| Criterio | Resultado | Evidencia |
|---|---|---|
| E2E basic-5 vs changed, consigo mismo, teclado | OK | `playwright --project=chromium compare.spec.ts`: 3 passed |
| E2E @perf pages-5000 | OK | pasa en la tanda completa y suelto (1.3 s) |
| Unit/UI (cifrado, no PDF, destroy/closeFile) | OK | `pnpm coverage` exit 0, líneas 98,31 % |
| lint, typecheck, build, bundle:check | OK | arranque 519 069 de 600 000 bytes |
| e2e completo | 297 pasadas, 2 fallos @perf ajenos | detail.spec:212 y shapes.spec:236; sueltos pasan |

Inestabilidad @perf: en esta tanda falló detail:212 y shapes:236 (no annotations-layer:151, que pasó); sueltos con `--project=chromium-perf --no-deps` pasan los cuatro. Es inestabilidad por carga de la máquina (cambia de test entre ejecuciones), no por PDF-112. Recomendación: seguir en PDF-078/ADR-0016 (reposo de CPU más estricto).
Tests añadidos: ninguno nuevo.
