// Junta la oficina en un único HTML autónomo (sin servidor), con una instantánea
// del estado real del equipo incrustada. Útil para abrirla con doble clic o publicarla.
//   node herramientas/oficina-2d/empaquetar.mjs [salida.html]
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { leerEstado } from './estado.mjs';

const AQUI = dirname(fileURLToPath(import.meta.url));
const MODULOS = ['derivar.mjs', 'simulacion.mjs', 'oficina.mjs'];

function sinModulos(codigo) {
  return codigo
    .replace(/^import [^;]+ from '\.\/[\w-]+\.mjs';\n/gm, '')
    .replace(/^export (?=const|function|class|async)/gm, '')
    .replace(/^\/\* global [^*]+\*\/\n/gm, '');
}

export async function empaquetar(repo) {
  const html = await readFile(join(AQUI, 'index.html'), 'utf8');
  const partes = await Promise.all(MODULOS.map(async (m) => `// --- ${m}\n${sinModulos(await readFile(join(AQUI, m), 'utf8'))}`));
  const estado = await leerEstado(repo);
  const instantanea = `globalThis.ESTADO_INSTANTANEA = ${JSON.stringify(estado).replace(/</g, '\\u003c')};`;
  return html.replace(/<script type="module">\n([\s\S]*?)<\/script>/, (_, pagina) =>
    `<script type="module">\n${instantanea}\n${partes.join('\n')}\n// --- página\n${sinModulos(pagina)}</script>`,
  );
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const salida = resolve(process.argv[2] ?? join(AQUI, 'oficina-autonoma.html'));
  await writeFile(salida, await empaquetar(join(AQUI, '..', '..')));
  process.stdout.write(`Escrito ${salida}\n`);
}
