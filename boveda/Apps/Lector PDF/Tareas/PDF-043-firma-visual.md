---
tipo: tarea
id: PDF-043
titulo: Firmar - colocar, mover y redimensionar la firma en la página
app: pdf
estado: en-revision
depende_de: [PDF-086]
intentos: 0
skills: [stack-typescript-react, calidad-profesional, pruebas-calidad]
creado: 2026-10-17
actualizado: 2026-10-18
tags: [tarea, pdf, iteracion-3, firma, anotaciones, ui]
---

# PDF-043 · Firmar: colocar, mover y redimensionar la firma en la página

Plan: [[Apps/Lector PDF/Plan|Plan]] (iteración 3) · Decisiones: [[ADR-0020-firma-visual]] · Paridad: [[Paridad Adobe Acrobat]] (área 6)

## Objetivo
Botón «Firmar» en la barra: se elige una firma guardada o se crea una, se coloca con un clic (o con Intro desde el teclado) en cualquier página, se mueve, se redimensiona manteniendo la proporción, se borra con Supr, con deshacer/rehacer, y se guarda dentro del PDF con Ctrl+S.

## Contexto
- Leer: `src/ui/viewer/AnnotationLayer.tsx` (herramientas, `MOVABLE`, arrastre, flechas, tirador de tamaño del texto libre, Supr), `src/state/annotation-actions.ts` (`setTool`, `addAnnotation`, `updateAnnotation`, `addNoteFromKeyboard` como modelo para el teclado), `src/state/annotation-store.ts` (`AnnotationTool`), `src/ui/signature/SignatureMenu.tsx` y `SignatureDialog.tsx` (PDF-086), `src/core/annotations/model.ts` (`resizeSignature`), `src/ui/toolbar/MainToolbar.tsx`.

## Qué hay que hacer
1. Estado: `AnnotationTool` gana `'signature'`; `AnnotationState` gana `pendingSignature: SignatureArt | null`. `chooseSignature(art)` en `annotation-actions.ts` → `pendingSignature = art`, `tool = 'signature'`. `setTool('none')` limpia `pendingSignature`.
2. `src/core/annotations/signature.ts` (puro): `DEFAULT_SIGNATURE_WIDTH_PT = 150`; `signatureRectAt(art, center: [x, y], pageBox: RectPt): RectPt` (ancho 150 pt, alto según proporción `box` o `pixelWidth/pixelHeight`, centrado en el punto y desplazado para quedar dentro de la página); `resizeKeepingAspect(rect, corner: 'se', dx, dy, minWidth = 20): RectPt` (ancla la esquina superior izquierda; proporción constante); `newSignatureAnnotation(...)` con `color` negro, `opacity 1`, `contents 'Firma'`, autor de las preferencias.
3. Capa (`AnnotationLayer.tsx`): con `tool === 'signature'`, cursor `copy` y clic en la página → `addAnnotation(newSignatureAnnotation(...signatureRectAt...))`, selecciona la nueva y vuelve `tool` a `'none'`. `MOVABLE` incluye `'signature'` (arrastre y flechas como las notas). Firma seleccionada: tirador en la esquina inferior derecha (como el del texto libre) que llama a `resizeKeepingAspect` y confirma con `updateAnnotation(..., 'cambiar tamaño de la firma', mergeKey)`. Supr borra.
4. Teclado: con `tool === 'signature'`, Intro sobre el visor (o activar el elemento del menú con teclado) coloca la firma en la página actual, centrada horizontalmente y a un tercio desde arriba de lo visible; Esc cancela la herramienta.
5. Barra: en `MainToolbar.tsx`, tras «Comentar», `SignatureMenu` con etiqueta «Firmar» (icono nuevo `IconSign`): elegir una guardada → `chooseSignature`; «Crear firma…» abre `SignatureDialog` y, al aceptar, `chooseSignature`.
6. Tests: unit de `signature.ts`; UI de colocar/mover/redimensionar; E2E `tests/e2e/signature.spec.ts`.

## Criterios de aceptación
- [ ] Unit: `signatureRectAt` con arte 300×100 en `(100, 100)` de A4 → `[25, 75, 175, 125]`; cerca del borde derecho se desplaza dentro de la página; `resizeKeepingAspect` con `dx = 30` sobre 150×50 → 180×60 con la esquina superior izquierda fija; nunca menos de 20 pt de ancho.
- [ ] E2E (`basic-5.pdf`): «Firmar» → «Crear firma…» → dibujar un trazo con `page.mouse` → Aceptar → clic en la p1 → hay píxeles oscuros en el lienzo de la capa en la zona de la firma; arrastrar 50 px a la derecha la mueve 50 px (±2); el tirador la agranda manteniendo proporción (ancho/alto ±1 %); Ctrl+Z deshace el tamaño, otro Ctrl+Z la posición, otro la firma.
- [ ] E2E: la firma creada aparece en «Firmar» como firma guardada tras recargar la página (preferencias locales) y se puede colocar en la p3 solo con teclado (Tab al botón, Intro, flechas, Intro; Intro en el visor coloca).
- [ ] E2E: Ctrl+S → el fichero guardado leído con pdf.js en Node tiene una anotación `Stamp` con `hasAppearance` en el rect esperado (±1 pt) y `qpdf --check` 0; al reabrir en la app la firma se ve (la pinta pdf.js) y en el panel de comentarios aparece como solo lectura.
- [ ] E2E: firma con imagen PNG con transparencia (fixture generado en el test con `canvas` de la página) → tras guardar y reabrir, el píxel de una zona transparente de la firma es el blanco del papel (±5).
- [ ] Sin red: ninguna petición fuera de `localhost` durante la prueba (`page.on('request')`).
- [ ] Axe sin incidencias `serious`/`critical` con el diálogo «Crear firma» abierto y con el menú «Firmar» abierto.
- [ ] `pnpm --filter lector-pdf e2e` completo con código 0; `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm coverage` con código 0.

## Fuera de alcance
- Firma digital con certificado (PDF-066). Firmar dentro de un campo `/Sig`. Editar la firma tras guardar.

## Registro
<!-- Cada agente añade aquí su entrada al terminar; no borrar las anteriores. -->

### [programador] ronda 1 — 2026-10-18
- Ficheros cambiados: `apps/lector-pdf/src/ui/viewer/Viewer.tsx` (Intro con «Firmar» antes de comprobar `scaled`), `apps/lector-pdf/tests/e2e/signature.spec.ts` (E2E completo: teclado con Tab/flechas/Intro, Stamp con pdf.js en Node y rectángulo, solo lectura en el panel, PNG con transparencia; sin `TestInfo` sin usar). La parte de estado, núcleo, capa, barra y tests unitarios/UI ya estaba en el commit c047858; no la he tocado.
- Qué he hecho: el E2E de la ficha no pasaba la colocación con teclado en documentos que caben enteros (`factor <= 1` salía antes del manejo de Intro). Corregido. Añadidos los criterios que faltaban en E2E (rectángulo del Stamp, `hasAppearance`, PNG transparente, solo lectura). Al reabrir, la firma se comprueba por píxeles oscuros en su sitio, no como zona editable (es anotación ajena).
- Comandos ejecutados y resultado: `pnpm --filter lector-pdf exec playwright test tests/e2e/signature.spec.ts --project=chromium` → 5/5 OK. `pnpm typecheck` → OK. `pnpm lint` → sin errores fuera de `apps/lector-pdf/dist-firma/` (artefacto de build ajeno, sin ignorar en ESLint; ya señalado en PDF-042). `pnpm coverage` → 2319/2320 tests; falla solo `tests/ui/zoom-controls.test.tsx` (Tab con tope, ajeno, ya señalado en PDF-042).
- Dudas o cosas que no he podido hacer: (a) la ficha pone `src/core/annotations/signature.ts`, pero el código está en `src/core/signature/signature.ts` (lo dejo como está). (b) El tirador llama a `updateAnnotation` sin `mergeKey` porque la ficha no define la clave; cada tamaño es una entrada de deshacer. (c) No he ejecutado todo `pnpm --filter lector-pdf e2e` (solo `signature.spec.ts`). (d) `dist-firma` y `zoom-controls` quedan fuera de mi ficha: lint y coverage no salen con 0 por ellos.
