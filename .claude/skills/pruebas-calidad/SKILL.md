---
name: pruebas-calidad
description: Cómo probar las apps de la suite a nivel profesional (Vitest, Testing Library, Playwright, documentos de prueba reales, tests de ida y vuelta de formatos, rendimiento). Úsala al escribir tests, al revisar si un cambio está bien probado y siempre que actúes como tester.
---

# Pruebas en la suite ofimática

Herramientas: **Vitest** (unitarios e integración, entorno `node` para `core/`, `jsdom` para componentes), **@testing-library/react** + `user-event`, **Playwright** (E2E sobre la versión web; Chromium ya instalado en `/opt/pw-browsers`, no ejecutar `playwright install`).

## Pirámide
1. **Unitarios de `core/`** (la mayoría): parsers, modelo, comandos, fórmulas. Rápidos, sin DOM.
2. **Componentes**: interacción real con `user-event` (teclear, clic, atajos), consultas por rol/etiqueta accesible (`getByRole('button', { name: 'Negrita' })`), nunca por clases CSS.
3. **E2E con Playwright**: flujos completos de usuario: abrir fichero → editar → guardar → reabrir y comparar. Pocos pero imprescindibles. Capturas en fallo.

## Documentos de prueba (fixtures)
- Carpeta `fixtures/<formato>/` en la raíz con documentos **reales y variados**: generados por Microsoft Office, LibreOffice, Google Docs y Adobe; con tablas, imágenes, fuentes raras, tildes/ñ/emojis, RTL, documentos grandes (≥ 200 páginas / ≥ 100 000 celdas), protegidos con contraseña y corruptos/truncados.
- Cada fixture con su licencia o procedencia en `fixtures/FUENTES.md` (preferir los corpus de test públicos de pdf.js, LibreOffice, Apache POI, o documentos creados por nosotros).
- Nunca subir documentos personales del usuario.

## Tipos de test obligatorios por formato
- **Ida y vuelta (round-trip)**: abrir → guardar → abrir de nuevo produce el mismo modelo (comparar modelo, no bytes).
- **Compatibilidad**: el fichero que guardamos lo abre otra herramienta (p. ej. validar `.docx`/`.xlsx` re-leyéndolo con una librería independiente; con LibreOffice en modo headless si está instalado: `soffice --headless --convert-to pdf`).
- **Robustez**: fichero vacío, truncado, extensión equivocada, enorme → mensaje de error claro, nunca cuelgue ni pantalla en blanco.
- **Visual** (render de PDF/diapositivas): comparación de capturas con tolerancia (`toHaveScreenshot` con `maxDiffPixelRatio`), imágenes de referencia versionadas.

## Rendimiento (presupuestos)
- Abrir un documento normal (≤ 20 páginas) en < 1 s; uno grande en < 5 s mostrando ya la primera página.
- Teclear o mover la selección: < 16 ms por pulsación en documentos normales.
- Escribe tests de rendimiento como benchmarks de Vitest (`bench`) para las operaciones críticas y anota el resultado en la ficha.

## Reglas
- Cada criterio de aceptación de la ficha → al menos un test automático que falle si el criterio deja de cumplirse.
- Un bug encontrado → primero un test que lo reproduce (rojo), luego el arreglo.
- Prohibido `test.skip`, `.only` olvidados, `expect(true)`, o tests que no comprueban nada.
- Tests deterministas: sin dependencias de hora, red ni orden de ejecución.
- Cobertura mínima de `core/`: 80 % de líneas (`vitest --coverage`); no es un objetivo en sí, pero bajar de ahí es rechazo.
