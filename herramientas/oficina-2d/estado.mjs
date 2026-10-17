// Lee la bóveda y calcula el estado del equipo para la oficina 2D.
//   node herramientas/oficina-2d/estado.mjs              imprime el estado en JSON
//   node herramientas/oficina-2d/estado.mjs --servir     abre la oficina en http://localhost:4173
// Opciones: --puerto N, --repo RUTA (por defecto, la raíz de este repositorio).
/* global process, URL */
import { readFile, readdir } from 'node:fs/promises';
import { createServer } from 'node:http';
import { basename, dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { derivarEquipo, leerFrontmatter } from './derivar.mjs';

const AQUI = dirname(fileURLToPath(import.meta.url));

async function listar(dir) {
  try {
    return await readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }
}

async function notas(dir) {
  const salida = [];
  for (const e of await listar(dir)) {
    if (!e.isFile() || extname(e.name) !== '.md') continue;
    const texto = await readFile(join(dir, e.name), 'utf8');
    salida.push({ titulo: basename(e.name, '.md'), ...leerFrontmatter(texto) });
  }
  return salida;
}

export async function leerEstado(repo) {
  const boveda = join(repo, 'boveda');
  const fichas = [];
  const planes = [];
  for (const app of await listar(join(boveda, 'Apps'))) {
    if (!app.isDirectory()) continue;
    const carpeta = join(boveda, 'Apps', app.name);
    for (const n of await notas(join(carpeta, 'Tareas'))) if (n.tipo === 'tarea') fichas.push(n);
    for (const n of await notas(carpeta)) if (n.tipo === 'plan') planes.push(n);
  }
  const investigaciones = (await notas(join(boveda, 'Investigacion'))).filter((n) => n.tipo === 'investigacion');
  let vivo;
  try {
    vivo = JSON.parse(await readFile(join(repo, 'registros', 'estado-equipo.json'), 'utf8'));
  } catch {
    vivo = null; // No hay estado en vivo: se usa solo lo deducido de las fichas.
  }
  return {
    generado: new Date().toISOString(),
    fuente: 'boveda',
    ...derivarEquipo({ fichas, planes, investigaciones, vivo }),
  };
}

const TIPOS = { '.html': 'text/html; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.json': 'application/json' };
const SERVIBLES = new Set(['index.html', 'derivar.mjs', 'oficina.mjs', 'simulacion.mjs']);

function servir(repo, puerto) {
  const servidor = createServer(async (req, res) => {
    const ruta = new URL(req.url ?? '/', 'http://localhost').pathname.slice(1) || 'index.html';
    try {
      if (ruta === 'estado.json') {
        res.writeHead(200, { 'content-type': TIPOS['.json'], 'cache-control': 'no-store' });
        res.end(JSON.stringify(await leerEstado(repo)));
        return;
      }
      if (!SERVIBLES.has(ruta)) {
        res.writeHead(404).end('No encontrado');
        return;
      }
      res.writeHead(200, { 'content-type': TIPOS[extname(ruta)] });
      res.end(await readFile(join(AQUI, ruta)));
    } catch (err) {
      res.writeHead(500).end(String(err));
    }
  });
  // Solo escucha en este ordenador: nada sale de la máquina.
  servidor.listen(puerto, '127.0.0.1', () => {
    process.stdout.write(`Oficina 2D en http://localhost:${puerto} (Ctrl+C para salir)\n`);
  });
}

async function main(args) {
  const valor = (nombre, defecto) => {
    const i = args.indexOf(nombre);
    return i >= 0 && args[i + 1] ? args[i + 1] : defecto;
  };
  const repo = resolve(valor('--repo', join(AQUI, '..', '..')));
  if (args.includes('--servir')) {
    servir(repo, Number(valor('--puerto', '4173')));
  } else {
    process.stdout.write(`${JSON.stringify(await leerEstado(repo), null, 2)}\n`);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main(process.argv.slice(2));
}
