// Genera largo.html (40 capítulos × 15 párrafos de 80 palabras). Determinista: misma salida siempre.
// Uso: node make-largo.mjs  (escribe largo.html junto a este script)
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const CHAPTERS = 40;
const PARAGRAPHS = 15;
const WORDS_PER_PARAGRAPH = 80;

const WORDS = [
  'casa', 'camino', 'río', 'montaña', 'ventana', 'ciudad', 'libro', 'árbol', 'puerta', 'mañana',
  'silencio', 'memoria', 'cuaderno', 'jardín', 'puente', 'estrella', 'mercado', 'invierno', 'señal', 'camión',
  'tiempo', 'sendero', 'lámpara', 'orilla', 'verano', 'palabra', 'sombra', 'plaza', 'niño', 'canción',
  'mesa', 'historia', 'frontera', 'cielo', 'madera', 'lluvia', 'costa', 'vecino', 'pregunta', 'respuesta',
];

function word(chapter, paragraph, index) {
  return WORDS[(chapter * 31 + paragraph * 17 + index * 7) % WORDS.length] ?? 'casa';
}

function paragraph(chapter, paragraphIndex) {
  const words = [];
  for (let index = 0; index < WORDS_PER_PARAGRAPH; index += 1) {
    words.push(word(chapter, paragraphIndex, index));
  }
  const [first = '', ...rest] = words;
  return `${first.charAt(0).toUpperCase()}${first.slice(1)} ${rest.join(' ')}.`;
}

const parts = ['<!DOCTYPE html>', '<html lang="es">', '<head>', '<meta charset="utf-8">', '<title>Documento largo</title>', '</head>', '<body>', '<h1>Documento largo</h1>'];
for (let chapter = 1; chapter <= CHAPTERS; chapter += 1) {
  parts.push(`<h2>Capítulo ${String(chapter)}</h2>`);
  for (let paragraphIndex = 0; paragraphIndex < PARAGRAPHS; paragraphIndex += 1) {
    parts.push(`<p>${paragraph(chapter, paragraphIndex)}</p>`);
  }
}
parts.push('</body>', '</html>', '');

const target = join(dirname(fileURLToPath(import.meta.url)), 'largo.html');
writeFileSync(target, parts.join('\n'), 'utf8');
process.stdout.write(`largo.html escrito (${String(CHAPTERS)} capítulos)\n`);
