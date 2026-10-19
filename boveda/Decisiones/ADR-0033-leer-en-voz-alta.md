---
tipo: decision
id: ADR-0033
app: pdf
estado: aceptada
fecha: 2026-10-19
creado: 2026-10-19
actualizado: 2026-10-19
tags: [decision, pdf, accesibilidad, privacidad]
---

# ADR-0033 · Leer en voz alta con la Web Speech API y solo voces locales

## Contexto
Acrobat Reader tiene «Leer en voz alta» ([[PDF-067-leer-en-voz-alta|PDF-067]], [[Paridad Adobe Acrobat]]). Norma del proyecto: ningún dato sale del ordenador. En Chromium y Edge, `speechSynthesis.getVoices()` incluye voces **en red** (`localService: false`, p. ej. «Google español»): leerían el texto del documento en un servidor externo. En Tauri, WebView2 (Windows) y WKWebView (macOS) tienen voces del sistema; WebKitGTK (Linux) puede no tener ninguna.

## Opciones consideradas
| Opción | Ventajas | Inconvenientes | Licencia |
|---|---|---|---|
| **A. `speechSynthesis` filtrando `localService === true`** | Sin dependencias; voces del SO; pausa, velocidad y eventos `boundary` | Linux/Tauri puede no tener voces; Chrome corta frases largas | — |
| B. Comando Rust con `tts` (crate) | Voces nativas también en Linux (speech-dispatcher) | Solo escritorio; otro camino de código; dependencias de sistema | MIT/Apache-2.0 |
| C. Motor TTS en WASM (p. ej. Piper) | Igual en todas partes | Decenas de MB de modelos; rendimiento | MIT (modelos variados) |

## Decisión
**Opción A** en esta iteración; B queda como mejora para Linux.
- Solo voces con `localService === true`. Preferencia: la elegida por el usuario (guardada por `voiceURI`), si no la primera `es-ES`, si no la primera `es-*`, si no la primera local. Sin ninguna voz local: «Tu sistema no tiene voces instaladas para leer en voz alta.» y la función queda deshabilitada (nunca se usa una voz en red).
- Texto por frases: `Intl.Segmenter('es', { granularity: 'sentence' })` sobre el texto de la página (`buildPageText`); frases de más de 200 caracteres se parten en el último espacio antes de 200 (Chrome detiene enunciados largos). Cada fragmento lleva su rango `TextPos` para resaltarlo con el mismo método que la búsqueda.
- Un `SpeechSynthesisUtterance` por fragmento; el siguiente se encola al terminar el anterior (`onend`), así pausa, parar y cambiar de velocidad son inmediatos. Velocidad 0,5 a 2 (pasos de 0,25), guardada en preferencias.
- Alcances: «Leer esta página» y «Leer hasta el final» (pasa de página y la lleva a la vista). Atajos de Acrobat: Ctrl+Mayús+V (página), Ctrl+Mayús+B (hasta el final), Ctrl+Mayús+C (pausa/reanudar), Ctrl+Mayús+E (parar).
- Se para al cambiar de documento o pestaña, al cerrar y al empezar otra lectura.

## Consecuencias
- En Linux con WebKitGTK sin voces la función aparece deshabilitada con su explicación.
- La lectura usa el orden de pdf.js: columnas o tablas pueden leerse en orden imperfecto (igual que copiar).
