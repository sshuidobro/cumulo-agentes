---
tipo: tarea
id: PDF-070
titulo: Hacer accesible el panel de comentarios (nombre visible y Borrar fuera de la fila)
app: pdf
estado: en-test
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

### [programador] ronda 1 — 2026-10-18
- Ficheros cambiados: `apps/lector-pdf/src/ui/messages.ts`, `apps/lector-pdf/src/ui/sidebar/CommentsPanel.tsx`, `apps/lector-pdf/src/ui/sidebar/CommentsPanel.module.css`, `apps/lector-pdf/tests/ui/comments-panel.test.tsx`, `apps/lector-pdf/tests/e2e/comments-panel.spec.ts`, `apps/lector-pdf/tests/e2e/annotations-kit.ts` (exporta `optionName`), `apps/lector-pdf/tests/e2e/annotations-flow.spec.ts`, `apps/lector-pdf/tests/e2e/annotations-keyboard.spec.ts`. No se ha tocado nada de PDF-071 (`CommentToolbar.tsx` y sus tests). No hay commit.
- Qué he hecho: fila `option` sin `aria-label` con nombre desde su contenido (`.name` + `.srOnly` «, página N»); icono de papelera decorativo (`aria-hidden`, `title`, `data-testid="comment-row-delete"`) que borra sin navegar; `deleteRow` (fila activa a la siguiente o anterior, `null` si no queda ninguna); Supr/Retroceso sobre la lista; botón «Borrar comentario» en la barra del panel. Tests de componente adaptados y 6 casos nuevos (18/18 en `comments-panel.test.tsx`). E2E adaptados a `optionName` y al icono por testid.
- Comandos ejecutados y resultado:
  - `pnpm lint`: sin errores ni avisos.
  - `pnpm --filter lector-pdf typecheck`: sin errores.
  - `pnpm test`: 143 ficheros, 1693 tests en verde.
  - `pnpm exec playwright test annotations-a11y comments-panel annotations-flow annotations-keyboard annotations-foreign notes`: 14 de 15 en verde. **Falla `annotations-flow.spec.ts` («subrayar y hacer notas…»)**: en Chromium el nombre accesible es «Resaltado de Usuario , página 1 …» (con espacio antes de la coma), no «Resaltado de Usuario, página 1». Lo mismo ocurre en las seis filas.
  - `pnpm --filter lector-pdf e2e` completo y `annotations-a11y` con el criterio de 0 violaciones: no ejecutado completo; a11y sí pasa en las 3 pruebas.
- Dudas o cosas que no he podido hacer (**bloqueo**):
  1. **Conflicto de nombre accesible.** Con la estructura prescrita (`.name` con `.srOnly` absoluto dentro), Chromium añade un espacio entre «Usuario» y la coma, porque el `.srOnly` con `position: absolute` se trata como bloque. jsdom no lo hace, por eso los tests de componente pasan y el E2E no. El criterio exige «Nota de Ana, página 1» exacto y no puedo cumplirlo con esa estructura sin decidir diseño. Opciones para el líder: (a) que `optionName` admita `\s*` antes de la coma (el nombre se lee igual, con una pausa); (b) mostrar la coma visible y ocultar solo «página N»; (c) otra técnica de texto oculto (no recomendable).
  2. **Espacio añadido en el JSX.** He puesto `{' '}` entre `.name` y la fecha para que, en jsdom, el nombre tenga separación antes de la fecha (sin él, el nombre era «Nota de Ana, página 117/10/26…» y no cumplía `optionName`). No tiene efecto visual en flex. Es una desviación menor de la estructura de la ficha; avisar si no se quiere.
  3. **Icono de papelera.** La ficha dice que «aparece al pasar el ratón o con la fila seleccionada, como hoy», pero hoy es siempre visible (no hay regla de hover en `.rowActions`). He mantenido el comportamiento actual y solo he añadido `cursor: pointer`.
  4. **E2E adaptados** (solo localizadores, sin quitar aserciones): `annotations-kit.ts` (`optionName`), `annotations-flow.spec.ts` (nombres por `optionName`, sin `exact`), `annotations-keyboard.spec.ts` (la fila activa se lee de su `textContent`, ya no tiene `aria-label`), `comments-panel.spec.ts` (Borrar por testid). `notes.spec.ts` y `annotation-popup.test.tsx` no se tocan: su «Borrar» es el de la ventana de comentario, no el de la fila.

### [líder] replanificación — 2026-10-18
Decisión: **opción (a)**. El espacio que Chromium mete antes de la coma no cambia la lectura (el lector de pantalla hace una pausa) ni afecta a axe (`label-content-name-mismatch` solo exige que el nombre contenga el texto visible, y ya pasa). Ni (b) ni (c): no se toca la estructura ni el CSS de la fila. Se conserva todo el código sin commitear de la ronda 1.

Instrucciones exactas (única corrección pendiente):
1. En **las dos** funciones `optionName` (`tests/e2e/annotations-kit.ts` y `tests/ui/comments-panel.test.tsx`), tras escapar el nombre, permitir espacios opcionales antes de cada coma:
   ```ts
   export function optionName(name: string): RegExp {
     const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/,/g, '\\s*,');
     return new RegExp('^' + escaped + '(?:\\s|$)');
   }
   ```
   (En el test de componente puede seguir usando `escapeRegExp(name)` y luego el `.replace(/,/g, '\\s*,')`.) No se añade ningún otro comodín.
2. El criterio «nombre que cumple `optionName('Nota de Ana, página 1')`» se entiende con esta `optionName`. No cambia ningún otro criterio.
3. Desviaciones de la ronda 1, **aceptadas** tal como están: `{' '}` entre `.name` y la fecha (punto 2); papelera siempre visible con `cursor: pointer`, porque la ficha se equivocaba al decir que hoy aparece solo al pasar el ratón (punto 3); localizadores de E2E del punto 4.
4. Ejecutar y anotar en el Registro: `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm --filter lector-pdf exec playwright test annotations-a11y` (3 en verde) y **`pnpm --filter lector-pdf e2e` completo** con código 0.

### [programador] ronda 2 — 2026-10-18
- Ficheros cambiados: `apps/lector-pdf/tests/e2e/annotations-kit.ts`, `apps/lector-pdf/tests/ui/comments-panel.test.tsx` (solo `optionName`); más los de la ronda 1 que quedaban sin commitear: `apps/lector-pdf/src/ui/messages.ts`, `apps/lector-pdf/src/ui/sidebar/CommentsPanel.tsx`, `apps/lector-pdf/src/ui/sidebar/CommentsPanel.module.css`, `apps/lector-pdf/tests/e2e/annotations-flow.spec.ts`, `apps/lector-pdf/tests/e2e/annotations-keyboard.spec.ts`, `apps/lector-pdf/tests/e2e/comments-panel.spec.ts`.
- Qué he hecho: aplicada la corrección (a) del líder en las dos funciones `optionName`: tras escapar, cada coma admite espacios opcionales antes (`\s*,`). Sin más cambios de estructura, CSS ni localizadores.
- Comandos ejecutados y resultado:
  - `pnpm lint`: código 0, sin avisos.
  - `pnpm --filter lector-pdf typecheck`: código 0.
  - `pnpm test`: 143 ficheros, 1693 tests en verde, código 0.
  - `pnpm --filter lector-pdf exec playwright test annotations-a11y`: 3 de 3 en verde (0 violaciones serious/critical).
  - `pnpm --filter lector-pdf e2e`: 155 pruebas en verde, código 0 (incluye `annotations-flow` y `annotations-keyboard`, que en la ronda 1 fallaban).
- Dudas o cosas que no he podido hacer: ninguna. Commit solo de los ficheros de esta ficha; `Plan.md`, PDF-039, PDF-071, PDF-072 y la bitácora quedan sin commitear porque pertenecen a otras fichas.

### [revisor] ronda 1 — 2026-10-18 — APROBADO
Commit `cd45199`. `pnpm lint`, `typecheck` y `test` (1693) con código 0; a11y, comments-panel, annotations-flow y annotations-keyboard en verde (7/7). Estructura de fila, `deleteRow`, Supr/Retroceso, botón «Borrar comentario» e icono decorativo conformes con la ficha; tests con las mismas aserciones y solo localizadores cambiados.
1. (opcional) `tests/ui/comments-panel.test.tsx` — el título del test «ninguna fila contiene botones… ( ni con comentario de solo lectura)» tiene un paréntesis mal redactado.
2. (opcional) Tras borrar con el botón «Borrar comentario», este queda deshabilitado si no hay fila activa y el foco se pierde; decisión del líder («el foco no se mueve»), valorar en una ficha futura.
