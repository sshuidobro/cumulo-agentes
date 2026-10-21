---
tipo: tarea
id: PDF-114
titulo: Leer en voz alta - menú, barra de lectura, atajos y resaltado de la frase
app: pdf
estado: hecha
depende_de: [PDF-067, PDF-050, PDF-051, PDF-112]
intentos: 0
skills: [stack-typescript-react, calidad-profesional, pruebas-calidad]
creado: 2026-10-19
actualizado: 2026-10-20
tags: [tarea, pdf, iteracion-6, accesibilidad, ui]
---

# PDF-114 · Leer en voz alta: menú, barra de lectura, atajos y resaltado de la frase

Plan: [[Apps/Lector PDF/Plan|Plan]] (iteración 6) · Decisiones: [[ADR-0033-leer-en-voz-alta]] · Antes: [[PDF-067-leer-en-voz-alta]]

## Objetivo
El usuario lanza «Leer esta página» o «Leer hasta el final» desde el menú «Ver» o con los atajos de Acrobat; una barra flotante permite pausar, reanudar, parar, cambiar velocidad y voz; la frase que se lee se resalta en la página y la página se sigue sola.

## Contexto
- [[ADR-0033-leer-en-voz-alta]] (atajos y nota sobre los reservados por el navegador).
- `src/state/read-aloud-actions.ts`, `src/state/speech-port.ts`, `src/core/read-aloud/voices.ts` (PDF-067); `src/ui/messages-read-aloud.ts`.
- `src/ui/toolbar/ViewMenu.tsx` (de PDF-050) y `src/ui/kit/MenuButton.tsx`.
- `src/ui/shortcuts.ts` (`ShortcutId`, registro), `src/ui/use-shortcuts.ts`, manejadores en `src/ui/App.tsx` (`useShortcuts({...})`).
- `src/ui/viewer/SearchHighlights.tsx` (**patrón a copiar**: registro de capas de texto, `rangeForMatch`, cálculo de cajas) y su montaje en `src/ui/viewer/PageView.tsx` (línea ~178), `search-highlights.css`.

## Qué hay que hacer
1. Atajos en `shortcuts.ts`: `read-page` `Mod+Shift+V`, `read-to-end` `Mod+Shift+B`, `read-pause` `Mod+Shift+C`, `read-stop` `Mod+Shift+E`, con descripciones de `readAloudMsg`. Manejadores en `App.tsx`: `startReading('page')`, `startReading('document')`, `togglePause()` (solo si hay lectura), `stopReading()`.
2. `ViewMenu.tsx`: separador y entradas «Leer esta página en voz alta» y «Leer hasta el final» (con su atajo); deshabilitadas con `title` `readAloudMsg.noVoices` si `useReadAloud.unavailable` (las voces se cargan con `loadVoices()` la primera vez que se abre el menú).
3. `src/ui/read-aloud/ReadAloudBar.tsx` (+ CSS): visible si `status !== 'idle'`, abajo al centro del visor, `role="toolbar"` con `aria-label` «Lectura en voz alta»: botón Pausa/Reanudar (`aria-pressed`, Espacio cuando la barra tiene el foco), Parar, selector de velocidad (`READ_ALOUD_RATES`, «1×», «1,25×»…), selector de voz (voces locales, nombre e idioma) y el texto «Leyendo la página N». Escape con foco en la barra → parar. Montada en `App.tsx` (no hace falta `lazy`: es pequeña; comprobar `bundle:check`).
4. `src/ui/viewer/ReadAloudHighlight.tsx` (+ `read-aloud-highlight.css`): como `SearchHighlights` pero con un solo rango (`useReadAloud.current` si su `pageIndex` es esta página): cajas con clase `read-aloud-current` (subrayado grueso de color `--color-accent` y fondo al 20 %), `aria-hidden`. Si la caja queda fuera de la vista, `goToPage(index, { yFraction })` como la revelación de la búsqueda, como mucho una vez por fragmento. Montado en `PageView.tsx` junto a `SearchHighlights`.
5. Mensajes nuevos en `readAloudMsg`: `readPage`, `readToEnd`, `pause`, `resume`, `stop`, `speed`, `voice`, `toolbar`, `readingPage(n)`.
6. Tests: `tests/ui/read-aloud-bar.test.tsx`, `tests/ui/read-aloud-highlight.test.tsx` y `tests/e2e/read-aloud.spec.ts` con un `speechSynthesis` falso inyectado con `page.addInitScript` (voz local `es-ES`; cada `speak` termina a los 50 ms y registra el texto en `window.__spoken`).

## Criterios de aceptación
- [ ] E2E (`basic-5.pdf`, voz falsa): Ctrl+Mayús+V lee la página 1: `__spoken` contiene sus fragmentos en orden; durante la lectura hay exactamente un `.read-aloud-current` sobre el texto del fragmento en curso; al terminar la barra desaparece.
- [ ] E2E: «Leer hasta el final» desde la página 4 llega a la página 5 y el visor la muestra (`currentPage` 5 en el navegador de páginas).
- [ ] E2E: pausa con el botón → no se dice nada más durante 300 ms; reanudar repite el fragmento pausado y sigue; Parar → barra oculta y ningún resaltado.
- [ ] E2E: sin voces locales (falso con solo `localService: false`) → entradas del menú deshabilitadas con «Tu sistema no tiene voces instaladas para leer en voz alta.» y ninguna llamada a `speak` (privacidad).
- [ ] E2E: velocidad 1,5× → el siguiente `speak` lleva `rate` 1.5 y al recargar la app se recuerda.
- [ ] Teclado y accesibilidad: barra accesible con Tab, nombres en español, foco visible; axe sin violaciones; tema oscuro.
- [ ] Lista de comprobación manual en el [[Apps/Lector PDF/Manual|Manual]]: leer `basic-5.pdf` con una voz española real en Windows o macOS sin conexión a internet (la comprueba el usuario; no bloquea la ficha).
- [ ] `pnpm --filter lector-pdf bundle:check` dentro del presupuesto.
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm coverage`, `pnpm --filter lector-pdf e2e` con código 0.

## Fuera de alcance
- Voces nativas de Linux vía Rust. Leer desde el punto donde se hace clic. Leer comentarios.

## Registro
<!-- Cada agente añade aquí su entrada al terminar; no borrar las anteriores. -->

### [programador] ronda 1 — 2026-10-20
- Ficheros cambiados: `src/ui/messages-read-aloud.ts`, `src/ui/shortcuts.ts`, `src/ui/App.tsx`, `src/ui/kit/MenuButton.tsx` (prop `onOpen`), `src/ui/toolbar/ViewMenu.tsx`, `src/ui/read-aloud/ReadAloudBar.tsx` + `.module.css` (nuevos), `src/ui/viewer/ReadAloudHighlight.tsx` + `read-aloud-highlight.css` (nuevos), `src/ui/viewer/PageView.tsx`; tests nuevos `tests/ui/read-aloud-bar.test.tsx`, `tests/ui/read-aloud-highlight.test.tsx`, `tests/ui/read-aloud-menu.test.tsx`, `tests/e2e/read-aloud.spec.ts`; `boveda/Apps/Lector PDF/Manual.md` (atajos, sección y lista de comprobación manual).
- Qué he hecho: atajos `read-page`, `read-to-end`, `read-pause` (solo con lectura, si no no consume la tecla) y `read-stop`; entradas «Leer esta página en voz alta» y «Leer hasta el final» en «Vista», deshabilitadas con la explicación si no hay voces locales (las voces se cargan al abrir el menú); barra de lectura con pausa, parar, velocidad, voz y «Leyendo la página N»; resaltado de la frase por página (`ReadAloudHighlight`, copia del patrón de `SearchHighlights`), con revelación de la página una sola vez por fragmento.
- Comandos ejecutados y resultado: `pnpm lint` OK; `pnpm typecheck` OK; `pnpm coverage` exit 0 (líneas 98,31 % del total de la app y paquetes; núcleo sin cambios); `pnpm --filter lector-pdf build` OK, arranque 530 209 bytes de 600 000; tests nuevos: `read-aloud-bar` (9), `read-aloud-highlight` (5), `read-aloud-menu` (2) en verde, 16 en total; `playwright test tests/e2e/read-aloud.spec.ts --project=chromium` 8/8 OK; `pnpm --filter lector-pdf e2e` completo, dos tandas: 304/307 (3 fallos `@perf`: `performance.spec` ×2 y en su tanda la máquina estaba con CPU ocupada 80-83 %, el gate de reposo lo avisa) y 305/307 (2 fallos `@perf`: `detail.spec:212` y `export.spec:178`, CPU 86 %). **Código de salida no 0 en ninguna tanda completa** por esos fallos de medida bajo carga. Suelto, `performance.spec.ts` 9/9 OK y `detail.spec:212` + `export.spec:178` 2/2 OK. Ninguna prueba de voz falla. Lo dejo para el tester: no toqué umbrales.
- Dudas o cosas que no he podido hacer:
  1. **Base de la rama**: mi rama estaba en `647dc35` y no tenía PDF-112 (dependencia), que solo existe en `equipo-en-vivo` (`8aae867`). Hice `git merge --ff-only equipo-en-vivo` (la rama no tenía commits propios, así que no se perdió nada). Por eso el commit de esta ficha va sobre esa base.
  2. **Botón de pausa**: el nombre accesible es fijo, «Pausar», con `aria-pressed` (el estado de pausa); el texto emergente pasa a «Reanudar» cuando está pausada. Así la etiqueta no cambia con el estado (regla de los botones de conmutación).
  3. **Resaltado**: un solo `.read-aloud-current` por fragmento (criterio «exactamente un»), con un `.read-aloud-line` por renglón dentro. La ficha decía «cajas»: lo he leído como una caja por fragmento con sus líneas dentro. Con dos renglones de pdf.js por nodo habría salido un `.read-aloud-current` por renglón.
  4. **Carga de voces**: `MenuButton` acepta una prop nueva opcional `onOpen`, que llama `loadVoices()` al abrir «Vista». Es cambio en `ui/kit`, compatible con el resto.
  5. **E2E con voz falsa**: cada `speak` termina a los 50 ms como pide la ficha. Las pruebas que miran la lectura «en curso» (un solo resaltado, pausa, velocidad) suben el tiempo de la voz falsa a 5 s para no depender de la carrera; el resto va a 50 ms. Al pausar, la prueba de 300 ms observa el reloj del navegador, no hay `waitForTimeout`.
  6. **Fragmentos**: la página 1 de `basic-5.pdf` sale como un solo fragmento («Página 1 de 5 marcador-1 El veloz…»), porque el segmentador no corta entre renglones sin signo de fin de frase. Eso viene de PDF-067, no lo he cambiado.
  7. **Pantalla completa**: la barra se muestra también en pantalla completa (la ficha no lo pide, y la lectura sigue siendo controlable con teclado).
  8. El criterio «velocidad 1,5× ... al recargar» se verifica con el E2E; «axe» y «tema oscuro» también (la barra). El punto manual con voz española real queda en el Manual para el usuario; no bloquea.

### [revisor] ronda 1 — 2026-10-20 — APROBADO
0 bloqueantes. Tester: repetir e2e completo con la máquina en reposo (@perf falló por CPU ocupada).

### [tester] ronda 1 — 2026-10-20 — PASA
| Criterio | Resultado | Evidencia |
|---|---|---|
| E2E Ctrl+Mayús+V, un `.read-aloud-current`, barra desaparece | OK | `read-aloud.spec.ts:83,93` en `pnpm --filter lector-pdf e2e` |
| E2E leer hasta el final desde p.4 → p.5 | OK | `read-aloud.spec.ts:109` |
| E2E pausa 300 ms / reanudar / parar | OK | `read-aloud.spec.ts:124` |
| E2E sin voces locales: deshabilitado y sin `speak` | OK | `read-aloud.spec.ts:150` |
| E2E velocidad 1,5× y persistencia al recargar | OK | `read-aloud.spec.ts:166` |
| Teclado, axe, tema oscuro | OK | `read-aloud.spec.ts:186,207` |
| Manual con voz real | Pendiente del usuario (no bloquea) | Manual.md |
| `bundle:check` | OK | Arranque 530 959 de 600 000 bytes |
| lint / typecheck / coverage / e2e con código 0 | OK | lint 0, typecheck OK, coverage 0 (líneas 98,32 %), e2e 310/310 passed (9,6 min, máquina en reposo, incluidos los `@perf`), código 0 |

Sin `test.skip` ni `.only` en los tests de la ficha. Tests añadidos: ninguno (la cobertura de la ficha era suficiente).
Rendimiento: los `@perf` pasan con la máquina en reposo (abrir basic-5 742 ms, <1 s).
