// Deriva qué hace cada agente del equipo a partir de las notas de la bóveda.
// Lógica pura: la usan el servidor (estado.mjs), la página y los tests.

export const NUM_PROGRAMADORES = 3;

/** Una entrada de estado en vivo se ignora si es más vieja que esto. */
export const VIVO_CADUCA_MS = 10 * 60 * 1000;

export const ROLES = [
  { id: 'lider', rol: 'lider', nombre: 'Líder' },
  { id: 'investigador', rol: 'investigador', nombre: 'Investigador' },
  ...Array.from({ length: NUM_PROGRAMADORES }, (_, i) => ({
    id: `programador-${i + 1}`,
    rol: 'programador',
    nombre: `Programador ${i + 1}`,
  })),
  { id: 'revisor', rol: 'revisor', nombre: 'Revisor' },
  { id: 'tester', rol: 'tester', nombre: 'Tester' },
];

const CERRADAS = new Set(['hecha', 'sustituida']);

/**
 * Lee el frontmatter YAML sencillo de una nota de Obsidian (clave: valor,
 * listas entre corchetes y comentarios con #). No pretende ser YAML completo.
 */
export function leerFrontmatter(texto) {
  const m = /^---\r?\n([\s\S]*?)\r?\n---/.exec(texto);
  if (!m) return {};
  const datos = {};
  for (const linea of m[1].split(/\r?\n/)) {
    const kv = /^([A-Za-z_][\w-]*):\s*(.*)$/.exec(linea);
    if (!kv) continue;
    let valor = kv[2].replace(/\s+#.*$/, '').trim();
    if (valor.startsWith('[') && valor.endsWith(']')) {
      valor = valor
        .slice(1, -1)
        .split(',')
        .map((v) => v.trim())
        .filter(Boolean);
    } else if (/^-?\d+$/.test(valor)) {
      valor = Number(valor);
    } else {
      valor = valor.replace(/^["']|["']$/g, '');
    }
    datos[kv[1]] = valor;
  }
  return datos;
}

function resumenFicha(f) {
  return { id: f.id, titulo: f.titulo ?? '', app: f.app ?? '' };
}

function porId(a, b) {
  return String(a.id).localeCompare(String(b.id), 'es', { numeric: true });
}

function parado(base, detalle = '') {
  return { ...base, estado: 'parado', tarea: null, detalle, origen: 'boveda' };
}

function trabajando(base, tarea, detalle = '') {
  return { ...base, estado: 'trabajando', tarea, detalle, origen: 'boveda' };
}

/**
 * @param {object} entrada
 * @param {Array<object>} entrada.fichas  frontmatter de cada ficha de tarea
 * @param {Array<object>} [entrada.planes] frontmatter de cada Plan.md
 * @param {Array<object>} [entrada.investigaciones] frontmatter de las notas de investigación
 * @param {object|null} [entrada.vivo] estado escrito por el coordinador (opcional)
 * @param {number} [entrada.ahora] marca de tiempo actual en ms
 */
export function derivarEquipo({ fichas, planes = [], investigaciones = [], vivo = null, ahora = Date.now() }) {
  const abiertas = fichas.filter((f) => !CERRADAS.has(f.estado)).sort(porId);
  const enEstado = (e) => abiertas.filter((f) => f.estado === e);
  const agentes = {};
  const base = Object.fromEntries(ROLES.map((r) => [r.id, r]));

  // Programadores: una ficha en curso por programador.
  const enCurso = enEstado('en-curso');
  ROLES.filter((r) => r.rol === 'programador').forEach((r, i) => {
    const f = enCurso[i];
    if (!f) {
      agentes[r.id] = parado(r);
      return;
    }
    const extra = i === NUM_PROGRAMADORES - 1 ? enCurso.length - NUM_PROGRAMADORES : 0;
    agentes[r.id] = trabajando(r, resumenFicha(f), extra > 0 ? `y ${extra} más en curso` : 'Programando');
  });

  for (const [rolId, estadoFicha, verbo] of [
    ['revisor', 'en-revision', 'Revisando'],
    ['tester', 'en-test', 'Probando'],
  ]) {
    const cola = enEstado(estadoFicha);
    agentes[rolId] = cola.length
      ? trabajando(base[rolId], resumenFicha(cola[0]), cola.length > 1 ? `${verbo} · ${cola.length - 1} más en cola` : verbo)
      : parado(base[rolId]);
  }

  // Líder: planifica (plan en borrador) o replanifica (ficha bloqueada o con 3 rechazos).
  const atascada = abiertas.find((f) => f.estado === 'bloqueada' || Number(f.intentos) >= 3);
  const borrador = planes.find((p) => p.estado === 'borrador');
  if (atascada) {
    agentes.lider = trabajando(
      base.lider,
      resumenFicha(atascada),
      atascada.estado === 'bloqueada' ? 'Ficha bloqueada' : 'Replanificando tras 3 rechazos',
    );
  } else if (borrador) {
    agentes.lider = trabajando(base.lider, { id: `Plan ${borrador.app ?? ''}`.trim(), titulo: 'Plan en borrador', app: borrador.app ?? '' }, 'Planificando');
  } else {
    agentes.lider = parado(base.lider);
  }

  // Investigador: alguna nota de investigación en curso.
  const investigando = investigaciones.find((n) => n.estado === 'en-curso');
  agentes.investigador = investigando
    ? trabajando(base.investigador, { id: 'Investigación', titulo: investigando.titulo ?? '', app: investigando.app ?? '' }, 'Investigando')
    : parado(base.investigador);

  aplicarVivo(agentes, vivo, ahora);

  const recuento = {};
  for (const f of fichas) recuento[f.estado] = (recuento[f.estado] ?? 0) + 1;

  return {
    agentes: ROLES.map((r) => agentes[r.id]),
    fichas: recuento,
    total: fichas.length,
  };
}

/**
 * El estado en vivo (registros/estado-equipo.json) manda sobre lo deducido de las
 * fichas, porque sabe qué subagente está lanzado en este momento.
 * Formato: { actualizado: ISO, agentes: { lider: { estado, tarea?, detalle? }, ... } }
 */
function aplicarVivo(agentes, vivo, ahora) {
  if (!vivo || typeof vivo !== 'object' || !vivo.agentes) return;
  const t = Date.parse(vivo.actualizado);
  if (!Number.isFinite(t) || ahora - t > VIVO_CADUCA_MS) return;
  for (const [id, v] of Object.entries(vivo.agentes)) {
    const actual = agentes[id];
    if (!actual || !v || (v.estado !== 'trabajando' && v.estado !== 'parado')) continue;
    const tarea = v.estado === 'trabajando'
      ? typeof v.tarea === 'string'
        ? { id: v.tarea, titulo: '', app: '' }
        : v.tarea ?? actual.tarea
      : null;
    agentes[id] = { ...actual, estado: v.estado, tarea, detalle: v.detalle ?? actual.detalle, origen: 'vivo' };
  }
}
