---
tipo: tarea
id: PDF-020
titulo: Tema claro/oscuro/sistema y modo noche de las páginas
app: pdf
estado: pendiente
depende_de: [PDF-015]
intentos: 0
skills: [stack-typescript-react, calidad-profesional, pruebas-calidad]
creado: 2026-10-17
actualizado: 2026-10-17
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
