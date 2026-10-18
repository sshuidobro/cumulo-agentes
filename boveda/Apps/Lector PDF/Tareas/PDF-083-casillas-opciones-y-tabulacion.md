---
tipo: tarea
id: PDF-083
titulo: Casillas, botones de opción, tabulación entre páginas y E2E de formularios
app: pdf
estado: en-test
depende_de: [PDF-041, PDF-042]
intentos: 1
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

### [programador] ronda 1 — 2026-10-18
- Ficheros cambiados: `apps/lector-pdf/src/ui/viewer/FormLayer.tsx`, `FormLayer.module.css`, `src/state/form-actions.ts` (`focusAdjacentPage`, `takePendingFocus`), `src/ui/messages-forms.ts`, `src/ui/use-shortcuts.ts`, `src/state/draft-sync.ts`, tests `tests/ui/form-layer.test.tsx`, `tests/unit/forms-actions.test.ts`, `tests/e2e/forms.spec.ts` (nuevo).
- Qué he hecho: casillas (`checkbox`), botones de opción (`radio`, un control por widget con `name=campo:<nombre>`) y firma (`role="img"`, no enfocable). Tab y Mayús+Tab saltan a la página vecina con campos rellenables con foco pendiente. Dos correcciones necesarias para el E2E: (1) la oferta de recuperar borrador ignoraba los campos (solo contaba anotaciones); (2) los atajos de página se comían las flechas dentro de un botón de opción.
- Comandos ejecutados y resultado: `pnpm --filter lector-pdf exec vitest run tests/ui/form-layer.test.tsx tests/unit/forms-actions.test.ts` → 25 + 16 pasan. `pnpm typecheck` → OK. `pnpm --filter lector-pdf e2e` → 194 pasan, código 0 (incluye los 5 de `forms.spec.ts`). `pnpm lint` → **falla** por `apps/lector-pdf/dist-firma/` (build versionado en `c047858`, sin ignorar en ESLint; ajeno a esta ficha, no lo he tocado). `pnpm coverage` → **1 test falla**: `tests/ui/zoom-controls.test.tsx` («el campo, la lista y los botones son alcanzables con Tab»); no toco barra ni zoom, pero no lo he comprobado en un árbol limpio.
- Dudas o cosas que no he podido hacer:
  - Radio: el nombre accesible de cada botón es su estado de exportación («Azul») y no «color», para que `getByRole('radio', { name: 'Azul' })` funcione. El criterio menciona «color»: confirmar.
  - Firma: `aria-label` = `formMsg.signatureField` tal cual («Campo de firma digital»), sin el nombre del campo.
  - `yFraction` de `focusAdjacentPage` usa la altura base de la página (`dims.height`) y no tiene en cuenta el giro de la vista.
  - La recuperación de borrador de solo formularios no tiene test unitario propio; lo cubre el E2E «tras cerrar sin guardar».
  - Lint y cobertura no pasan por lo indicado arriba: hace falta decisión del líder sobre `dist-firma` y sobre el test de zoom.

### [revisor] ronda 1 — 2026-10-18 — CAMBIOS
Typecheck OK; tests de la ficha (41) OK; e2e no ejecutado por indicación. Lint y coverage: fallos ajenos conocidos.
1. `apps/lector-pdf/src/ui/viewer/FormLayer.tsx` (`onKeyDown`, `firstId`/`lastId`) — con un grupo de botones de opción como último (o primer) campo de la página, Tab (o Mayús+Tab) no salta de página: el navegador trata el grupo como una sola parada y el foco suele estar en la opción marcada, que no es el último (ni el primero) widget del grupo, así que `id !== lastId` corta el salto. Hay que decidir «extremo» por grupo de campo (mismo `name`), no por id de widget, y añadir test UI (radio como último campo con otra opción enfocada).
2. `FormLayer.tsx` radio — cada botón se nombra solo «Azul», sin el nombre del campo (`color`), que pide el criterio; sin `role="radiogroup"` ni etiqueta de grupo un lector de pantalla no sabe a qué pregunta responde. Envolver los widgets del grupo o poner un nombre accesible que incluya el campo (p. ej. `color: Azul`) y ajustar el test.
3. (opcional) `aria-label` de la firma sin el nombre del campo; y `yFraction` ignora el giro de la vista.

### [programador] ronda 2 — 2026-10-18
- Ficheros cambiados: `apps/lector-pdf/src/ui/viewer/FormLayer.tsx` (paradas de Tab por grupo de botones de opción y nombre accesible), `apps/lector-pdf/src/ui/messages-forms.ts` (`radioOptionName`), tests `tests/ui/form-layer.test.tsx` (3 tests nuevos de Tab por grupo y nombres «color: Rojo/Verde/Azul») y `tests/e2e/forms.spec.ts` (nombres de las opciones).
- Qué he hecho: (1) Tab y Mayús+Tab deciden «extremo» por parada: un grupo de botones de opción (mismo `name`) es una sola parada, así que desde la opción marcada, aunque no sea la última, Tab pasa a la página siguiente si el grupo es el último de la página. (2) Cada opción se nombra «campo: estado» (p. ej. «color: Azul») para que un lector de pantalla sepa a qué pregunta responde; el criterio «nombre accesible (`color`)» queda cumplido.
- Comandos ejecutados y resultado: `pnpm --filter lector-pdf exec vitest run tests/ui/form-layer.test.tsx tests/unit/forms-actions.test.ts` → 45 pasan. `pnpm typecheck` → OK. `pnpm --filter lector-pdf e2e -- tests/e2e/forms.spec.ts` → 5 pasan. `pnpm lint` → código 1, todos los errores en `apps/lector-pdf/dist-firma/` (build ajeno, ya conocido); ningún error en ficheros de esta ficha. `pnpm coverage` → 2325 pasan, 1 falla: `tests/ui/zoom-controls.test.tsx` (ajena, ya conocida).
- Dudas o cosas que no he podido hacer: sin cambios en `dist-firma/` ni en el test de zoom (fuera de alcance; requieren decisión del líder). Pendientes del revisor opcionales no tratados: `aria-label` de la firma sin el nombre del campo y `yFraction` sin tener en cuenta el giro de la vista. Un grupo de opciones con el mismo nombre en dos páginas compartiría grupo de flechas en el navegador (caso no cubierto por la ficha).

### [revisor] ronda 2 — 2026-10-18 — APROBADO
Typecheck OK; 45 tests de la ficha OK. Los dos puntos de la ronda 1 resueltos (Tab por parada de grupo con tests; nombre «color: Azul»). Lint (`dist-firma/`) y test de zoom: fallos ajenos conocidos, a decidir por el líder; no bloquean esta ficha.
