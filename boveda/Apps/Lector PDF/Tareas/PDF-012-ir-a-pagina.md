---
tipo: tarea
id: PDF-012
titulo: Ir a página y navegación entre páginas (campo, etiquetas, atajos)
app: pdf
estado: en-test
depende_de: [PDF-011, PDF-003]
intentos: 0
skills: [stack-typescript-react, calidad-profesional, pruebas-calidad]
creado: 2026-10-17
actualizado: 2026-10-18
tags: [tarea, pdf, ui, navegacion]
---

# PDF-012 · Ir a página y navegación

Plan: [[Apps/Lector PDF/Plan|Plan]] · Decisiones: [[ADR-0007-motor-y-visor-pdf]]

## Objetivo
La barra muestra la página actual («4 de 300», o «iv (4 de 300)» si el PDF tiene etiquetas de página) en un campo editable; el usuario escribe un número o una etiqueta y va a esa página. Botones y atajos para anterior, siguiente, primera y última, y Ctrl+Mayús+N para saltar al campo.

## Contexto
- Leer: `src/state/navigation.ts`, `src/ui/toolbar/MainToolbar.tsx`, `src/ui/shortcuts.ts`, `src/ui/use-shortcuts.ts`, `src/ui/viewer/Viewer.tsx`, `src/state/document-actions.ts`.
- pdf.js: `doc.getPageLabels()` → `string[] | null`. Fixture `page-labels.pdf` (PDF-003): `i, ii, iii, iv, 1 … 7, A-1`.
- Atajos de Adobe: anterior ← / Ctrl+Re Pág; siguiente → / Ctrl+Av Pág; primera Inicio / Ctrl+Mayús+Re Pág; última Fin / Ctrl+Mayús+Av Pág; ir a página Ctrl+Mayús+N.

## Qué hay que hacer
1. `src/core/page-input.ts`:
   ```ts
   export function parsePageInput(text: string, numPages: number, labels: readonly string[] | null): number | null; // índice 0-based o null
   export function formatPageIndicator(index: number, numPages: number, labels: readonly string[] | null): { readonly inputValue: string; readonly suffix: string };
   ```
   `parsePageInput`: recorta espacios; si hay `labels` y el texto coincide (sin distinguir mayúsculas) con una etiqueta → primer índice con esa etiqueta; si no, si es un entero `1..numPages` → `n - 1`; si no → `null`.
   `formatPageIndicator`: sin etiquetas o con etiqueta igual a `String(index + 1)` → `{ inputValue: '4', suffix: 'de 300' }`; con etiqueta distinta → `{ inputValue: 'iv', suffix: '(4 de 300)' }`. Números con `toLocaleString('es-ES')` en el sufijo.
2. Store: `pageLabels: readonly string[] | null` (null por defecto) y `hasHorizontalOverflow: boolean`. `openDocument` pide `doc.getPageLabels()` tras abrir (sin bloquear el estado `ready`; si falla → `null`). `Viewer` actualiza `hasHorizontalOverflow` (ancho del espaciador > ancho visible).
3. `src/state/navigation.ts` añade `nextPage()`, `prevPage()`, `firstPage()`, `lastPage()` (sobre `currentPage`).
4. `src/ui/toolbar/PageNavigator.tsx`: `IconButton` «Página anterior» y «Página siguiente» (deshabilitados en los extremos); `<input aria-label={msg.pageNumber}>` con `inputValue`, que muestra el valor actual cuando no tiene foco; Intro → `parsePageInput` → `goToPage` o, si `null`, `aria-invalid="true"` + mensaje `msg.pageInvalid(numPages)` en un `title`/texto asociado (`aria-describedby`) y se mantiene lo escrito; Esc y salir del campo restauran el valor actual. Al recibir el foco selecciona todo el texto. Texto `suffix` a la derecha.
5. Atajos en `shortcuts.ts`: `next-page` `['ArrowRight', 'Mod+PageDown']`, `prev-page` `['ArrowLeft', 'Mod+PageUp']`, `first-page` `['Home', 'Mod+Shift+PageUp']`, `last-page` `['End', 'Mod+Shift+PageDown']`, `go-to-page` `['Mod+Shift+N']` (enfoca y selecciona el campo; añádelo a `ALLOW_IN_EDITABLE`). `ArrowLeft/ArrowRight` solo cambian de página si `hasHorizontalOverflow` es `false` (si hay desbordamiento, se deja el scroll horizontal nativo). Quita del `Viewer` el manejo propio de `Home`/`End` (ahora son atajos globales); mantén el de flechas verticales y Av/Re Pág en modo de scroll escalado.
6. Mensajes: `pageNumber` «Número de página», `prevPage` «Página anterior», `nextPage` «Página siguiente», `pageInvalid(n)` «Escribe un número de página entre 1 y n».
7. Tests `tests/unit/page-input.test.ts`, `tests/ui/page-navigator.test.tsx`, `tests/e2e/navigation.spec.ts`.

## Criterios de aceptación
- [ ] (T) `parsePageInput('iv', 12, labels)` → 3; `'1'` con etiquetas → 4 (etiqueta «1»); `'A-1'`/`'a-1'` → 11; `'12'` con etiquetas → 11 (no hay etiqueta «12», se usa el número); `'0'`, `'13'`, `'x'` → `null`; sin etiquetas `'5'` → 4.
- [ ] (T) `formatPageIndicator(3, 12, labels)` → `{ inputValue: 'iv', suffix: '(4 de 12)' }`; `(4, 5000, null)` → `{ '5', 'de 5000' }`; `(0, 100000, null)` → sufijo `'de 100.000'`.
- [ ] (T) UI: escribir `250` + Intro con 300 páginas → `goToPage(249)`; `400` → `aria-invalid="true"` y el mensaje; Esc restaura el valor. Botón «Página anterior» deshabilitado en la página 1.
- [ ] (T) Atajos: `ArrowRight` → `nextPage`; con `hasHorizontalOverflow` → no hace nada; dentro del campo de página, `ArrowRight` mueve el cursor del texto (no cambia de página); `Ctrl+Mayús+N` enfoca el campo con el texto seleccionado.
- [ ] E2E: `page-labels.pdf` → el campo muestra `i` y «(1 de 12)»; escribir `A-1` + Intro → página 12 visible y campo `A-1`.
- [ ] E2E: `pages-5000.pdf` → `End` → «5000 de 5000» (sufijo «de 5000») en < 1,5 s; `Home` → página 1; `Ctrl+Mayús+N`, `4321`, Intro → el marco «Página 4321 de 5000» es visible.
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm coverage`, `pnpm --filter lector-pdf e2e` con código 0.

## Fuera de alcance
- Historial atrás/adelante (PDF-014). Miniaturas (PDF-015).

## Registro
<!-- Cada agente añade aquí su entrada al terminar; no borrar las anteriores. -->

### [programador] ronda 1 — 2026-10-18
- Ficheros cambiados: `apps/lector-pdf/src/core/page-input.ts` (nuevo); `src/state/viewer-store.ts`, `src/state/navigation.ts`, `src/state/document-actions.ts`; `src/ui/viewer/Viewer.tsx`; `src/ui/toolbar/PageNavigator.tsx` + `.module.css` (nuevos); `src/ui/toolbar/MainToolbar.tsx`; `src/ui/App.tsx`, `src/ui/shortcuts.ts`, `src/ui/use-shortcuts.ts`, `src/ui/messages.ts`, `src/ui/icons.tsx`; tests: `tests/unit/page-input.test.ts` (nuevo), `tests/unit/navigation.test.ts`, `tests/unit/document-actions.test.ts`, `tests/ui/page-navigator.test.tsx` (nuevo), `tests/ui/viewer.test.tsx`, `tests/ui/zoom-controls.test.tsx`, `tests/e2e/navigation.spec.ts` (nuevo).
- Qué he hecho: núcleo `parsePageInput`/`formatPageIndicator` (etiquetas y números) y store con `pageLabels` (leídas en segundo plano, si fallan quedan en null) y `hasHorizontalOverflow` (lo fija el visor). Navegador `PageNavigator` en la barra (anterior, campo con sufijo, siguiente; Intro, Esc, foco con selección, aria-invalid y mensaje). Atajos de página en `shortcuts.ts` y acciones `nextPage/prevPage/firstPage/lastPage`; el visor deja de atender Inicio/Fin.
- Comandos ejecutados y resultado: `pnpm lint` (0), `pnpm typecheck` (0), `pnpm test` (93 ficheros, 1235 tests, 0 fallos), `pnpm coverage` (0; 98,82 % líneas), `pnpm --filter lector-pdf e2e`: 38 pasan, 2 fallan, ambos en `tests/e2e/text.spec.ts` (capa de texto, PDF-013): «con zoom 200 % y la vista girada 90°…» y «Ctrl+A en la página 3…» (esta última pasó en una pasada posterior). `navigation.spec.ts` (2/2), `zoom.spec.ts` y `viewer*.spec.ts` pasan. Medido: la barra cabe en una línea (49 px a 1280×720), así que mi cambio no desplaza el visor del E2E de texto.
- Dudas o cosas que no he podido hacer:
  - **No he hecho commit** (orden explícita: no commit/stash/checkout mientras PDF-013 trabaja en paralelo). `src/ui/toolbar/MainToolbar.tsx` lo estamos editando los dos: mis cambios son el `PageNavigator` y su separador; los botones de herramienta (selección/mano) son de PDF-013 y no los he tocado.
  - Contrato nuevo en `use-shortcuts.ts`: un manejador puede devolver `false` para que el atajo no se consuma (necesario para que ←/→ sigan haciendo scroll horizontal con desbordamiento). `ShortcutHandler` recibe el `KeyboardEvent`.
  - Foco desde Ctrl+Mayús+N: un módulo expone `focusPageField()` que guarda la referencia al campo montado (no añadí campo al store).
  - Al escribir en el campo se quita el aviso de inválido (decisión mía; la ficha no lo dice).
  - `tests/ui/viewer.test.tsx`: el test de «Fin» en 100 000 páginas ahora llama a `lastPage()` (la ficha quita el manejo de Fin del visor); el test sin escalado mantiene la comprobación y solo cambia su nombre.
  - `tests/ui/zoom-controls.test.tsx`: el test de orden de Tab contaba 2 pulsaciones hasta «Reducir»; ahora pulsa Tab hasta encontrar «Reducir» (la barra tiene controles nuevos). Sigue comprobando el orden de los controles de zoom.
  - La ficha dice «Fin» para ir a la última página en escala: ahora va al inicio de la última página (no al final del documento, como hacía el visor antes). Es lo que pide la ficha; lo anoto por si el usuario lo espera distinto.
  - `pnpm --filter lector-pdf e2e` no da código 0 por los 2 tests de `text.spec.ts` de PDF-013; no los he tocado. Pendiente de esa ficha.

### [revisor] ronda 1 — 2026-10-18 — APROBADO
- Comprobado: `pnpm lint`, `pnpm typecheck`, `pnpm test` (1235 pasan) y `pnpm coverage` con código 0; `tests/e2e/navigation.spec.ts` 2/2. Los fallos de `text.spec.ts` son de PDF-013 y no se cuentan.
- Cada criterio tiene test; el núcleo no importa React; mensajes centralizados; `aria-invalid`, `aria-describedby` y `role="alert"` correctos; las etiquetas se leen sin bloquear la apertura y se reinician al abrir otro documento.
1. (opcional) `apps/lector-pdf/tests/ui/page-navigator.test.tsx` — el test de ArrowRight dentro del campo solo comprueba que no hay `navRequest`; podría comprobar también la posición del cursor.
2. (opcional) Los cambios de esta ficha y de PDF-013 comparten ficheros sin commit (`MainToolbar.tsx`, `shortcuts.ts`, `App.tsx`, `Viewer.tsx`); al hacer commit, separar o commitear juntos con cuidado.
