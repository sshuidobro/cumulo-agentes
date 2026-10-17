---
tipo: decision
id: ADR-0001
app: comun
estado: aceptada
fecha: 2026-10-17
creado: 2026-10-17
actualizado: 2026-10-17
tags: [decision, stack]
---

# ADR-0001 · Tecnología de las aplicaciones

## Contexto
Hay que elegir con qué se programan las cuatro apps. Requisitos: calidad profesional, aprovechar librerías maduras de formatos (PDF, OOXML), poder probarlo automáticamente y tener app de escritorio.

## Opciones consideradas
| Opción | Ventajas | Inconvenientes |
|---|---|---|
| TypeScript + React + Tauri | Mejores librerías de formatos (pdf.js, editores ricos, motores de fórmulas); funciona en navegador y escritorio; E2E con Playwright | Dos lenguajes (TS + algo de Rust) |
| Solo web (TypeScript + React) | Lo más sencillo | Sin app instalable ni asociación de ficheros |
| Python + Qt | Un solo lenguaje | Menos librerías listas para PDF y hojas de cálculo |

## Decisión
**TypeScript + React empaquetado con Tauri 2.** Elegido por el usuario el 2026-10-17. Monorepo con pnpm; normas en las skills `stack-typescript-react` y `stack-tauri`.

## Consecuencias
- La lógica de documentos se escribe en TypeScript puro para que funcione en web y escritorio.
- Rust solo para integración con el sistema.
