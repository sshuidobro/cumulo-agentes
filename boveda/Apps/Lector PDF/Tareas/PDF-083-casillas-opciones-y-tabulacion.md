---
tipo: tarea
id: PDF-083
titulo: Casillas, botones de opción, tabulación entre páginas y E2E de formularios
app: pdf
estado: pendiente
depende_de: [PDF-041, PDF-042]
intentos: 0
skills: [stack-typescript-react, calidad-profesional, pruebas-calidad]
creado: 2026-10-18
actualizado: 2026-10-18
tags: [tarea, pdf, iteracion-3, formularios, ui, e2e]
---

# PDF-083 · Casillas, botones de opción, tabulación entre páginas y E2E de formularios

Plan: [[Apps/Lector PDF/Plan|Plan]] (iteración 3) · Decisiones: [[ADR-0019-formularios-acroform]]

## Objetivo
Completar el rellenado: casillas y botones de opción con ratón y teclado, Tab/Mayús+Tab que pasa al siguiente campo aunque esté en otra página, campos de firma visibles pero no rellenables, y la prueba de extremo a extremo: rellenar todo solo con teclado, guardar, reabrir y ver los valores.

## Contexto
- Leer: `src/ui/viewer/FormLayer.tsx` (PDF-041), `src/state/form-actions.ts`, `src/state/navigation.ts` (`goToPage`), `src/ui/messages-forms.ts`, `tests/e2e/annotations-kit.ts` (guardar/descargar en e2e) y `tests/support/qpdf.ts`.

## Qué hay que hacer
1. `FormLayer.tsx`, nuevos tipos de control:
   - `checkbox`: `<input type="checkbox">` del tamaño del widget con `appearance: none`, fondo transparente (o `--form-highlight`) y `outline` de foco visible; `checked` = valor efectivo; `change` → `setFieldValue(name, {kind:'checkbox', checked})`.
   - `radio`: `<input type="radio" name={`campo:${name}`}>` por widget, igual de estilo; `checked = selected === widget.onState`; `change` → `setFieldValue(name, {kind:'radio', selected: widget.onState})`. Las flechas del navegador recorren el grupo.
   - `signature`: `<div role="img" aria-label={formMsg.signatureField}>` sin foco, con `title` = «Campo de firma digital: aún no se puede firmar con certificado.».
   - `button`: sin control.
2. Tab entre páginas: en `form-actions.ts`,
```ts
/** Lleva el foco al primer (dir 1) o último (dir −1) campo rellenable de la siguiente/anterior página con campos. Devuelve false si no hay. */
export function focusAdjacentPage(pageIndex: number, dir: 1 | -1): boolean;
export function takePendingFocus(pageIndex: number): string | null; // id de widget a enfocar al montarse la página, o null
```
   `focusAdjacentPage` busca en `byPage` la página siguiente/anterior con algún campo rellenable, guarda `pendingFocus = { pageIndex, widgetId }` y llama a `goToPage(p, { yFraction })` con la fracción del borde superior del widget. En `FormLayer`, `onKeyDown` de Tab sin Mayús en el último control rellenable de la página (o Mayús+Tab en el primero): si `focusAdjacentPage` devuelve `true`, `preventDefault`. Al montarse, si `takePendingFocus(pageIndex)` devuelve un id, enfoca ese control (`useEffect` tras el primer render con controles).
3. Tests UI en `tests/ui/form-layer.test.tsx` y E2E en `tests/e2e/forms.spec.ts`.

## Criterios de aceptación
- [ ] UI: Espacio sobre `acepto` → `setFieldValue('acepto', {kind:'checkbox', checked:true})`; clic sobre el botón `Azul` → `selected 'Azul'`; la casilla y las opciones tienen nombre accesible (`acepto`, `color`) y foco visible.
- [ ] UI: `firma` no es enfocable y tiene `role="img"` con su nombre.
- [ ] E2E solo teclado en `form-full.pdf`: desde el visor, Tab hasta `nombre`, escribir «María José»; Tab y escribir dos líneas en `comentarios`; Tab, «ABC123» en `codigo`; Tab; Tab hasta `acepto` y Espacio; flechas hasta `Azul`; en `pais` elegir «Portugal»; en `idiomas` elegir «Francés»; el último Tab de la p1 lleva el foco a `nombre` de la p2 (página 2 visible). Ctrl+S → descarga; el fichero descargado leído con pdf.js en Node tiene esos valores y `qpdf --check` da 0.
- [ ] E2E: reabrir el fichero descargado → los controles muestran los valores guardados (`nombre` = «María José», `acepto` marcada, `Azul` marcada) y no hay «• » en el título.
- [ ] E2E: tras marcar `acepto`, Ctrl+Z con el foco en el visor la desmarca y el lienzo vuelve a la apariencia `Off` (comparación de píxeles de la zona del widget con la captura inicial: idéntica ±2 por canal).
- [ ] E2E: cerrar con campos cambiados muestra el aviso «¿Guardar los cambios…?» (mismo flujo que las anotaciones).
- [ ] E2E: recuperación tras cierre inesperado: rellenar `nombre`, esperar el borrador (≥ 2 s), recargar la página, abrir el mismo fichero → «Recuperar» devuelve «María José».
- [ ] Axe sin incidencias `serious`/`critical` en la p1 con el foco en un campo.
- [ ] `pnpm --filter lector-pdf e2e` completo con código 0; `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm coverage` con código 0.

## Fuera de alcance
- Firmar campos `/Sig` (PDF-066). Orden `/Tabs` del PDF (se usa el orden de `/Annots`). JavaScript de campos.

## Registro
<!-- Cada agente añade aquí su entrada al terminar; no borrar las anteriores. -->
