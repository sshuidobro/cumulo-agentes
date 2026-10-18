---
tipo: tarea
id: PDF-020
titulo: Tema claro/oscuro/sistema y modo noche de las páginas
app: pdf
estado: bloqueada
depende_de: [PDF-015]
intentos: 0
skills: [stack-typescript-react, calidad-profesional, pruebas-calidad]
creado: 2026-10-17
actualizado: 2026-10-18
tags: [tarea, pdf, ui, tema, accesibilidad]
---

# PDF-020 · Tema y modo noche

Plan: [[Apps/Lector PDF/Plan|Plan]] · Decisiones: [[ADR-0007-motor-y-visor-pdf]]

## Objetivo
Un menú «Apariencia» permite elegir el tema de la interfaz (Sistema, Claro, Oscuro) y activar el «Modo noche» de las páginas, que vuelve a dibujar el contenido del PDF con fondo oscuro y texto claro **sin invertir las imágenes**. Ambas opciones se recuerdan. La interfaz es legible en ambos temas y con escalado del sistema 125 % y 150 %.

## Contexto
- Leer: `src/ui/theme.css` (PDF-001), `src/engine/render.ts` (`pageColors`, PDF-010), `src/ui/viewer/PageView.tsx`, `src/ui/sidebar/Thumbnails.tsx`, `src/ui/toolbar/MainToolbar.tsx`.
- pdf.js `render({ pageColors: { background, foreground } })` sustituye los colores del documento (modo alto contraste) y no toca las imágenes.
- Patrón ARIA *menu button* (https://www.w3.org/WAI/ARIA/apg/patterns/menu-button/).

## Qué hay que hacer
1. Store: `theme: 'system' | 'light' | 'dark'`, `nightMode: boolean`, cargados de `prefs` (`theme`, `nightMode`, con *guards*) al arrancar y guardados al cambiar. `src/state/appearance-actions.ts`: `setTheme(t)`, `toggleNightMode()`.
2. `src/ui/use-theme.ts`: aplica `document.documentElement.dataset.theme = 'light' | 'dark'` o lo elimina con `'system'`; pone `color-scheme` coherente (`light dark` en sistema). Llamado una vez en `App`.
3. `src/core/night.ts`: `export const NIGHT_PAGE_COLORS = { background: '#1f1f23', foreground: '#e6e6e6' } as const;`.
4. `PageView` y miniaturas: si `nightMode`, pasan `pageColors: NIGHT_PAGE_COLORS` y redibujan al cambiar; el marco de la página usa ese fondo mientras no hay lienzo.
5. `src/ui/kit/MenuButton.tsx`: botón con `aria-haspopup="menu"` y `aria-expanded`; `role="menu"` con elementos `menuitemradio`/`menuitemcheckbox` (`aria-checked`); ↑/↓ entre elementos, Intro/Espacio activa, Esc cierra y devuelve el foco, clic fuera cierra. Reutilizable.
6. `MainToolbar`: menú «Apariencia» (`IconAppearance`) con «Tema: Sistema», «Tema: Claro», «Tema: Oscuro» (grupo de radio) y «Modo noche de las páginas» (casilla).
7. Revisión de `theme.css`: todos los colores de los componentes salen de variables; contraste ≥ 4,5:1 para texto y ≥ 3:1 para bordes de controles e iconos en ambos temas (anota los pares comprobados en el Registro); `rem` para tamaños de texto y controles.
8. Mensajes: `appearance` «Apariencia», `themeSystem` «Tema: Sistema», `themeLight` «Tema: Claro», `themeDark` «Tema: Oscuro», `nightMode` «Modo noche de las páginas».
9. Tests: `tests/ui/menu-button.test.tsx`, `tests/ui/appearance.test.tsx`, `tests/e2e/appearance.spec.ts`.

## Criterios de aceptación
- [ ] (T) `MenuButton`: abre con Intro y con clic, ↓ mueve el foco, Esc cierra y devuelve el foco al botón; `aria-checked` refleja el estado.
- [ ] (T) Elegir «Tema: Oscuro» → `<html data-theme="dark">` y `prefs.theme === 'dark'`; «Sistema» quita el atributo.
- [ ] (T) Activar modo noche hace que `PageView` pida un render nuevo con `pageColors` (motor simulado).
- [ ] E2E: con `colorScheme: 'dark'` del navegador y tema «Sistema», el fondo de la barra es oscuro (color calculado con luminancia < 0,2); con «Claro» es claro.
- [ ] E2E: `images-200.pdf` con modo noche → el fondo de la página 1 es oscuro (píxel de la esquina) y la imagen conserva sus colores (píxel dentro de la imagen igual que sin modo noche, tolerancia 10 por canal).
- [ ] E2E: tras recargar, tema y modo noche se mantienen.
- [ ] E2E: con `deviceScaleFactor: 1.5` y ventana 1280×800 la barra no se corta ni se solapa (todos los botones visibles) y el lienzo de la página 1 mide `≈ 1,5 ×` su tamaño CSS (nitidez).
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm coverage`, `pnpm --filter lector-pdf e2e` con código 0.

## Fuera de alcance
- Colores personalizados de página, alto contraste del sistema (`forced-colors`), más idiomas.

## Registro
<!-- Cada agente añade aquí su entrada al terminar; no borrar las anteriores. -->

### [programador] ronda 1 — 2026-10-18
- Ficheros cambiados: nuevos `apps/lector-pdf/src/core/appearance.ts`, `src/core/night.ts`, `src/state/appearance-store.ts`, `src/state/appearance-actions.ts`, `src/ui/use-theme.ts`, `src/ui/kit/MenuButton.tsx` y `MenuButton.module.css`, `tests/ui/menu-button.test.tsx`, `tests/ui/appearance.test.tsx`, `tests/e2e/appearance.spec.ts`. Modificados (cambios puntuales): `src/ui/icons.tsx` (`IconAppearance`), `src/ui/messages.ts`, `src/ui/toolbar/MainToolbar.tsx`, `src/ui/App.tsx`, `src/main.tsx`, `src/ui/viewer/PageView.tsx`, `PageFrame.tsx`, `Viewer.module.css`, `src/ui/sidebar/ThumbnailItem.tsx`, `Sidebar.module.css`, `src/ui/theme.css`, `src/ui/toolbar/ZoomControls.module.css`, `PageNavigator.module.css`, `src/ui/search/SearchBar.module.css`, `tests/ui/open.test.tsx` (ajuste del orden de Tab, ver abajo).
- Qué he hecho: menú «Apariencia» (`MenuButton` reutilizable, ARIA menu button) con Tema Sistema/Claro/Oscuro y «Modo noche de las páginas»; tema aplicado a `<html>` con `data-theme` y `color-scheme`; preferencias `theme` y `nightMode` con guards, cargadas al arrancar. Modo noche: `PageView` y miniaturas redibujan con `pageColors: NIGHT_PAGE_COLORS`; el marco usa el fondo oscuro. Revisión de `theme.css`: papel y texto de página en variables, nueva `--color-control-border` para bordes de controles.
- Comandos ejecutados y resultado: `pnpm lint` OK; `pnpm typecheck` OK; `pnpm test` 1470/1470 OK (el único fallo intermedio, `open.test.tsx` Tab, lo causó el botón nuevo y se ajustó); `pnpm coverage` OK (All files 96,76 % líneas). E2E con config temporal en puerto 4410 (`pw-all.config.ts` en el scratchpad): 79 pasan y 1 falla: `appearance.spec.ts` «modo noche… conservan sus colores». Tests de la ficha: T-menú (`MenuButton`), T-tema, T-modo noche con `pageColors` y E2E de tema según el sistema, tras recargar y escalado 1,5 × con barra completa: todos en verde.
- Contrastes comprobados (WCAG): claro: texto #1d1d1f sobre #f5f5f7 15,5 / #fff 16,8 / #e8e8ed 13,8; muted #55555c sobre #e8e8ed 6,1 y sobre #d1d1d6 4,9; acento #0a58ca sobre #fff 6,4; texto de acento #fff sobre acento 6,4; peligro #b3261e sobre #fff 6,5; borde de control #76767c sobre #f5f5f7 4,2; número de página #55555c sobre #fff 7,4. Oscuro: texto #f2f2f7 sobre #1c1c1e 15,3 / #2c2c2e 12,5 / #3a3a3c 10,2; muted #aeaeb2 sobre #2c2c2e 6,3 / #3a3a3c 5,1; acento #4da3ff sobre #2c2c2e 5,3; texto de acento #002b52 sobre acento 5,5; peligro #ff8a80 sobre #2c2c2e 6,1; borde de control #8e8e93 sobre #2c2c2e 4,3; número en noche #c7c7cc sobre #1f1f23 9,8. Todos ≥ 4,5 (texto) y ≥ 3 (controles).
- Dudas o cosas que no he podido hacer:
  1. **Bloqueo (decisión de producto/diseño):** la ficha dice que `pageColors` «no toca las imágenes». Falso en pdf.js 6.4.299: `#drawFilter` (pdf.mjs, ~línea 11066) vuelve a dibujar **todo el lienzo** con un filtro HCM que asigna brillo a un degradado entre el color de texto y el de fondo. Resultado medido: la imagen de `images-200.pdf` pasa de colores (p. ej. 215/48/37) a gris (diferencia de 225 en un canal). El criterio E2E «la imagen conserva sus colores (tolerancia 10)» no se puede cumplir con `pageColors` tal como está especificado. No lo he resuelto por mi cuenta porque cambiaría el diseño. Opciones a decidir por el líder: (a) aceptar que el modo noche convierte imágenes a gris y cambiar el criterio; (b) otro mecanismo que preserve imágenes (p. ej. filtro CSS sobre el lienzo más compensación de imágenes), que requiere diseño y un ADR. Capturas: `scratchpad/normal.png` (normal) y `pw-results` (noche).
  2. El test E2E de imagen **no está saltado ni modificado**: queda en rojo a propósito hasta que se decida 1.
  3. `tests/ui/open.test.tsx`: el segundo Tab de «se puede llegar a los botones con el teclado» ahora cae en «Apariencia» (siempre activo); he añadido ese paso y se mantiene la comprobación de «Abrir…» del visor. Lo señalo por si el revisor quiere otra solución.
  4. Sin commit: el árbol de trabajo tiene cambios de otros agentes sin confirmar; no he hecho git commit/stash/checkout, como se pidió.
  5. Pendiente de la ficha: `pnpm --filter lector-pdf e2e` con código 0 no se cumple mientras esté el bloqueo 1; el resto de criterios sí.
