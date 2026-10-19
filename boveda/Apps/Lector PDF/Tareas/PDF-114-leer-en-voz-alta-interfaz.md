---
tipo: tarea
id: PDF-114
titulo: Leer en voz alta - menú, barra de lectura, atajos y resaltado de la frase
app: pdf
estado: pendiente
depende_de: [PDF-067, PDF-050, PDF-051, PDF-112]
intentos: 0
skills: [stack-typescript-react, calidad-profesional, pruebas-calidad]
creado: 2026-10-19
actualizado: 2026-10-19
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
