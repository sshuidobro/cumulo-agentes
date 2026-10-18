---
tipo: tarea
id: PDF-070
titulo: Hacer accesible el panel de comentarios (nombre visible y Borrar fuera de la fila)
app: pdf
estado: pendiente
depende_de: [PDF-036]
intentos: 0
skills: [calidad-profesional]
creado: 2026-10-18
actualizado: 2026-10-18
tags: [tarea, pdf, anotaciones, accesibilidad]
---

# PDF-070 · Panel de comentarios accesible

Plan: [[Apps/Lector PDF/Plan|Plan]] · Origen: [[PDF-039-e2e-anotaciones]] (Registro, ronda 1, punto 1) · Panel: [[PDF-036-panel-de-comentarios]]

## Objetivo
Que axe no dé violaciones `serious`/`critical` en el panel de comentarios: (a) `label-content-name-mismatch` (el `aria-label` de la fila no contiene su texto visible) y (b) `nested-interactive` (botón «Borrar» dentro de `role="option"`). Se mantiene el patrón `listbox` + `aria-activedescendant`.

## Decisiones del líder (no cambiar)
- **Nombre de la fila = su contenido visible.** Se quita `aria-label` de las filas. El nombre accesible se calcula del contenido, que empieza por «Nota de Ana, página 1» (la parte «, página N» va oculta visualmente).
- **Ningún control enfocable dentro de una fila.** El borrado se hace con:
  1. **Supr** o **Retroceso** con el foco en la lista: borra la fila activa si es editable.
  2. Un botón **«Borrar comentario»** (icono papelera) en la barra del panel, junto a «Filtro»: actúa sobre la fila activa; deshabilitado si no hay fila activa o es de solo lectura.
  3. Para el ratón, cada fila editable conserva un icono de papelera **decorativo**: `<span>` con `aria-hidden="true"`, sin `tabIndex`, sin `role`, con `title` «Borrar». Su clic borra la fila y no navega.
- Tras borrar (por cualquiera de las tres vías), la fila activa pasa a la siguiente fila de tipo `item` o, si no hay, a la anterior; si no queda ninguna, `null`. El foco no se mueve.
- El borrado usa `deleteAnnotation(id)` (ya pasa por deshacer/rehacer).

## Contexto
- Leer: `apps/lector-pdf/src/ui/sidebar/CommentsPanel.tsx`, `CommentsPanel.module.css`, `src/ui/messages.ts` (claves `comment*`), `src/core/annotations/comment-list.ts` (`nextItemRow`), `src/ui/toolbar/PageNavigator.module.css` (clase `.srOnly` de referencia).
- Tests que hoy buscan la fila por su nombre exacto o el botón «Borrar» dentro de la fila (hay que adaptarlos, no borrarlos): `tests/ui/comments-panel.test.tsx`, `tests/ui/annotation-popup.test.tsx`, `tests/e2e/comments-panel.spec.ts`, `tests/e2e/notes.spec.ts`, `tests/e2e/annotations-kit.ts`, `tests/e2e/annotations-flow.spec.ts`, `tests/e2e/annotations-foreign.spec.ts`, `tests/e2e/annotations-keyboard.spec.ts`. Localízalos todos con `grep -rn "página 1'\|, página\|name: 'Borrar'" apps/lector-pdf/tests`.

## Qué hay que hacer
1. `src/ui/messages.ts`:
   - `commentOption` se sustituye por `commentOptionPage: (page: number): string => \`, página ${page.toLocaleString('es-ES')}\``.
   - Nueva `commentDeleteActive: 'Borrar comentario'`. `commentDelete: 'Borrar'` se queda (es el `title` del icono decorativo).
2. `CommentsPanel.module.css`: añade `.srOnly` (copia exacta de la de `PageNavigator.module.css`) y `.name` (peso de la actual `.type`). El icono decorativo reutiliza el estilo de `.rowActions` (aparece al pasar el ratón o con la fila seleccionada, como hoy) y `cursor: pointer`.
3. `CommentsPanel.tsx`, fila `item` (estructura exacta, el orden importa para el nombre):
   ```tsx
   <div role="option" id=… aria-selected=… className=… style=… onClick=…>   {/* sin aria-label */}
     <span className={styles.typeIcon} aria-hidden="true">…</span>
     <div className={styles.body}>
       <div className={styles.meta}>
         <span className={styles.name}>
           {msg.annotationName(row.typeLabel, row.author)}
           <span className={styles.srOnly}>{msg.commentOptionPage(row.pageIndex + 1)}</span>
         </span>
         {date !== null && <span className={styles.date}>{date}</span>}
         {row.readOnly && <span className={styles.readOnly}>{msg.commentReadOnly}</span>}
       </div>
       <p className={styles.excerpt}>{row.excerpt}</p>
     </div>
     {!row.readOnly && (
       <span className={styles.rowActions} aria-hidden="true" title={msg.commentDelete} data-testid="comment-row-delete"
             onClick={(e) => { e.stopPropagation(); deleteRow(row.id); }}>
         <IconTrash />
       </span>
     )}
   </div>
   ```
   El `<span>` de `.name` va **entero dentro de un solo elemento** (texto y `.srOnly` juntos) para que el nombre sea «Nota de Ana, página 1» sin espacio extra antes de la coma. Se eliminan los `<span>` separados de tipo y autor.
4. `CommentsPanel.tsx`, lógica:
   - `function deleteRow(id: string): void`: calcula la nueva fila activa (siguiente `item` tras la fila de `id` con `nextItemRow(rows, index, 'next')`, si es `null` con `'prev'`; si tampoco, `null`), llama a `deleteAnnotation(id)` y `setActiveId(nueva)`.
   - `onKeyDown`: `Delete` y `Backspace` (sin Ctrl/Alt/Meta) → `preventDefault()` + `stopPropagation()`; si la fila activa existe, es `item` y no `readOnly`, `deleteRow(row.id)`.
   - Botón en `styles.toolbar`, después del `MenuButton` de filtro: `<IconButton label={msg.commentDeleteActive} disabled={activeRow === undefined || activeRow.readOnly} onClick={() => { if (activeRow) deleteRow(activeRow.id); }}><IconTrash /></IconButton>`, donde `activeRow` es `rows[activeIndex]` si es `item`.
5. Tests: en los tests de Testing Library, buscar filas por nombre con una función auxiliar local `optionName(name: string): RegExp` que devuelva `new RegExp('^' + escapeRegExp(name) + '(?:\\s|$)')` (p. ej. `optionName('Nota de Ana, página 1')`). En Playwright, igual (`getByRole('option', { name: optionName(…) })`); en `annotations-kit.ts` exporta `optionName` para reutilizarla. Sustituye `getByRole('button', { name: 'Borrar' })` dentro de una fila por `getByTestId('comment-row-delete')`.

## Criterios de aceptación
- [ ] `tests/ui/comments-panel.test.tsx` añade y pasa:
  - la fila de una nota de «Ana» en la página 1 tiene nombre que cumple `optionName('Nota de Ana, página 1')` y contiene el extracto;
  - ninguna `option` contiene elementos con rol `button` ni elementos con `tabindex` (`within(option).queryAllByRole('button')` vacío y `option.querySelectorAll('[tabindex]')` vacío);
  - con el foco en la lista, ↓ hasta una fila editable y **Supr** → desaparece de la lista y de `getEffective()`; la fila activa (`aria-activedescendant`) pasa a la siguiente; **Ctrl+Z** la recupera;
  - **Supr** sobre una fila de solo lectura no borra nada;
  - «Borrar comentario» está deshabilitado sin fila activa y con fila de solo lectura activa; con una editable activa la borra;
  - clic en el icono decorativo borra la fila y **no** cambia `useViewer.getState().currentPage`.
- [ ] `pnpm --filter lector-pdf exec playwright test annotations-a11y` → 3 pruebas en verde (0 violaciones `serious`/`critical`, sin tocar el filtro de impacto).
- [ ] `pnpm --filter lector-pdf e2e` con código 0 (todas, incluidas las de PDF-036 y PDF-039 adaptadas).
- [ ] Ningún test borrado ni con `skip`/`only`; ninguno pierde aserciones (solo cambian localizadores).
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` con código 0.

## Fuera de alcance
- Cambiar el patrón a `grid` o el diseño visual del panel más allá de lo indicado.
- La barra «Comentar» ([[PDF-071-barra-comentar-flechas]]) y la nota con teclado ([[PDF-072-nota-con-teclado]]).
- El resto de criterios de PDF-039 (los cierra esa ficha).

## Registro
<!-- Cada agente añade aquí su entrada al terminar; no borrar las anteriores. -->
