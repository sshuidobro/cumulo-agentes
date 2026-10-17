// Oficina 2D en pixel art: dibuja al equipo en un canvas de 320×200 píxeles.
// Cada agente que trabaja recorre su rutina (mesa, pizarra, estantería, café...);
// el que está parado se queda quieto en su mesa.
/* global requestAnimationFrame, cancelAnimationFrame */

export const ANCHO = 320;
export const ALTO = 200;

const PALETA = {
  pared: '#34405e',
  paredClara: '#3e4b6d',
  zocalo: '#20283d',
  suelo: '#7c5a43',
  sueloVeta: '#6e4e3a',
  sueloLuz: '#87634a',
  sombra: 'rgba(10, 12, 24, 0.28)',
  mesa: '#d39b62',
  mesaFrente: '#a8723f',
  mesaOscura: '#6d4627',
  monitor: '#262838',
  pantallaOff: '#15161f',
  pantalla: '#2fb4e8',
  codigo: '#b9f1ff',
  codigoVerde: '#7dffa1',
  texto: '#1d1f2b',
  blanco: '#f4f1ea',
  bocadillo: '#fbfaf5',
  bocadilloBorde: '#1d1f2b',
  dormido: '#8d93ab',
  zapato: '#2a1e1e',
  ojo: '#16161c',
  cristal: '#a8dcff',
};

// Ropa, pelo y piel de cada personaje.
const ASPECTO = {
  lider: { camisa: '#2f3d8f', pantalon: '#1f2647', pelo: '#3a2a1a', piel: '#f0c39a', corbata: '#d8434b' },
  investigador: { camisa: '#3f9a5e', pantalon: '#4a3a2a', pelo: '#c4692b', piel: '#f2cfae', gafas: true },
  'programador-1': { camisa: '#e07b39', pantalon: '#2d3550', pelo: '#1e1e1e', piel: '#c68c5a', cascos: true },
  'programador-2': { camisa: '#8e4fb0', pantalon: '#2d3550', pelo: '#ecc85e', piel: '#f0c39a', cascos: true },
  'programador-3': { camisa: '#2a9d8f', pantalon: '#2d3550', pelo: '#6b3e1e', piel: '#8d5a3b', cascos: true },
  revisor: { camisa: '#d3b53a', pantalon: '#3b3b46', pelo: '#a3a3ad', piel: '#e8b892', gafas: true },
  tester: { camisa: '#c43c32', pantalon: '#26303f', pelo: '#2b1d14', piel: '#b07a50', gorra: '#24344d' },
};

// Mesas (esquina superior izquierda) y etiqueta de la placa.
const MESAS = {
  lider: { x: 16, y: 60, placa: 'LIDER' },
  investigador: { x: 264, y: 60, placa: 'INVEST' },
  'programador-1': { x: 76, y: 104, placa: 'PROG 1' },
  'programador-2': { x: 140, y: 104, placa: 'PROG 2' },
  'programador-3': { x: 204, y: 104, placa: 'PROG 3' },
  revisor: { x: 16, y: 152, placa: 'REVISOR' },
  tester: { x: 264, y: 152, placa: 'TESTER' },
};
const MESA_ANCHO = 40;
const PASILLO_ARRIBA = 84;
const PASILLO_ABAJO = 134;
const HUECO_PROGRAMADOR = { 'programador-1': 128, 'programador-2': 192, 'programador-3': 254 };
const VELOCIDAD = 30; // píxeles por segundo

function sitioEnMesa(id) {
  const m = MESAS[id];
  return { x: m.x + 14, y: m.y + 2 };
}

// --- Fuente de 3×5 píxeles -------------------------------------------------
const FUENTE = {
  A: '010101111101101', B: '110101110101110', C: '011100100100011', D: '110101101101110',
  E: '111100110100111', F: '111100110100100', G: '011100101101011', H: '101101111101101',
  I: '111010010010111', J: '001001001101010', K: '101101110101101', L: '100100100100111',
  M: '101111111101101', N: '110101101101101', O: '010101101101010', P: '110101110100100',
  Q: '010101101110011', R: '110101110101101', S: '011100010001110', T: '111010010010010',
  U: '101101101101111', V: '101101101101010', W: '101101111111101', X: '101101010101101',
  Y: '101101010010010', Z: '111001010100111', 0: '111101101101111', 1: '010110010010111',
  2: '110001010100111', 3: '110001010001110', 4: '101101111001001', 5: '111100110001110',
  6: '011100111101111', 7: '111001010010010', 8: '111101111101111', 9: '111101111001110',
  '-': '000000111000000', '.': '000000000000010', '+': '000010111010000', '?': '110001010000010',
  ' ': '000000000000000',
};

function normalizarTexto(t) {
  return String(t).normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase();
}

function anchoTexto(t) {
  return Math.max(0, normalizarTexto(t).length * 4 - 1);
}

function texto(ctx, t, x, y, color) {
  ctx.fillStyle = color;
  let cx = x;
  for (const c of normalizarTexto(t)) {
    const bits = FUENTE[c] ?? FUENTE['?'];
    for (let i = 0; i < 15; i++) if (bits[i] === '1') ctx.fillRect(cx + (i % 3), y + Math.floor(i / 3), 1, 1);
    cx += 4;
  }
}

// --- Rutinas: lo que hace cada rol mientras trabaja ------------------------
// Cada paso es un punto al que andar; si lleva `ms`, el agente se para allí a
// trabajar con la `accion` indicada mirando hacia `dir`.

function rutina(id, rol, mundo) {
  const casa = sitioEnMesa(id);
  const enMesa = (ms) => ({ ...casa, ms, dir: 'abajo', accion: 'teclear' });
  const azar = (min, max) => min + Math.random() * (max - min);
  const programadorOcupado = () => {
    const ocupados = mundo.agentes.filter((a) => a.rol === 'programador' && a.estado === 'trabajando');
    const elegido = ocupados[Math.floor(Math.random() * ocupados.length)];
    return elegido ? sitioEnMesa(elegido.id).x : null;
  };

  switch (rol) {
    case 'lider': {
      const pasos = [enMesa(azar(3500, 5000)), { x: 62, y: 62 }, { x: 62, y: 50 }, { x: 94, y: 50, ms: azar(3000, 4500), dir: 'arriba', accion: 'escribir' }];
      const px = programadorOcupado();
      if (px !== null) {
        pasos.push({ x: 128, y: 50 }, { x: 128, y: PASILLO_ARRIBA }, { x: px, y: PASILLO_ARRIBA }, { x: px, y: 92, ms: 2600, dir: 'abajo', accion: 'mirar' }, { x: px, y: PASILLO_ARRIBA }, { x: 62, y: PASILLO_ARRIBA });
      } else {
        pasos.push({ x: 62, y: 50 });
      }
      pasos.push({ x: 62, y: 62 });
      return pasos;
    }
    case 'investigador':
      return [enMesa(azar(3500, 5000)), { x: 258, y: 62 }, { x: 258, y: 50 }, { x: 222, y: 50, ms: azar(4000, 5500), dir: 'arriba', accion: 'leer' }, { x: 258, y: 50 }, { x: 258, y: 62 }];
    case 'programador': {
      const gx = HUECO_PROGRAMADOR[id];
      const cafeX = 154 + Math.round(azar(-6, 6));
      return [enMesa(azar(6000, 9000)), { x: gx, y: casa.y }, { x: gx, y: PASILLO_ARRIBA }, { x: cafeX, y: PASILLO_ARRIBA }, { x: cafeX, y: 50, ms: azar(2000, 3000), dir: 'arriba', accion: 'cafe' }, { x: cafeX, y: PASILLO_ARRIBA }, { x: gx, y: PASILLO_ARRIBA }, { x: gx, y: casa.y }];
    }
    case 'revisor': {
      const px = programadorOcupado() ?? 154;
      return [enMesa(azar(2500, 4000)), { x: 62, y: casa.y }, { x: 62, y: PASILLO_ABAJO }, { x: px, y: PASILLO_ABAJO }, { x: px, y: 126, ms: azar(3000, 4000), dir: 'arriba', accion: 'mirar' }, { x: px, y: PASILLO_ABAJO }, { x: 62, y: PASILLO_ABAJO }, { x: 62, y: casa.y }];
    }
    case 'tester':
      return [enMesa(azar(2500, 4000)), { x: 258, y: casa.y }, { x: 258, y: 140 }, { x: 292, y: 140, ms: azar(3000, 4500), dir: 'derecha', accion: 'probar' }, { x: 258, y: 140 }, { x: 258, y: casa.y }];
    default:
      return [enMesa(4000)];
  }
}

class Agente {
  constructor(base) {
    Object.assign(this, base);
    const casa = sitioEnMesa(base.id);
    this.x = casa.x;
    this.y = casa.y;
    this.dir = 'abajo';
    this.estado = 'parado';
    this.tarea = null;
    this.pasos = [];
    this.indice = 0;
    this.espera = 0;
    this.accion = null;
    this.andado = 0;
    this.tiempo = 0;
  }

  /** Cambia el estado; al pararse, termina la vuelta hasta su mesa. */
  fijar(datos, mundo) {
    const antes = this.estado;
    this.estado = datos.estado;
    this.tarea = datos.tarea;
    this.detalle = datos.detalle;
    this.origen = datos.origen;
    if (antes !== 'trabajando' && this.estado === 'trabajando') {
      this.pasos = rutina(this.id, this.rol, mundo);
      this.indice = 0;
      this.espera = 0;
    }
  }

  actualizar(dt, mundo) {
    this.tiempo += dt;
    if (this.estado !== 'trabajando') {
      this.accion = null;
      this.espera = 0;
      // Vuelve a su mesa por la rutina (sin pararse a trabajar) y se queda quieto.
      if (this.indice !== 0 || !this.enCasa()) {
        const objetivo = this.pasos[this.indice] ?? sitioEnMesa(this.id);
        if (this.andarHacia(objetivo, dt)) this.indice = this.indice + 1 >= this.pasos.length ? 0 : this.indice + 1;
      } else {
        this.dir = 'abajo';
      }
      return;
    }

    if (this.espera > 0) {
      this.espera -= dt * 1000;
      if (this.espera <= 0) this.avanzar(mundo);
      return;
    }
    const paso = this.pasos[this.indice];
    if (!paso) {
      this.avanzar(mundo);
      return;
    }
    if (this.andarHacia(paso, dt)) {
      if (paso.ms) {
        this.espera = paso.ms;
        this.dir = paso.dir;
        this.accion = paso.accion;
      } else {
        this.avanzar(mundo);
      }
    }
  }

  avanzar(mundo) {
    this.accion = null;
    this.indice += 1;
    if (this.indice >= this.pasos.length) {
      this.pasos = rutina(this.id, this.rol, mundo);
      this.indice = 0;
    }
  }

  enCasa() {
    const c = sitioEnMesa(this.id);
    return Math.abs(this.x - c.x) < 0.5 && Math.abs(this.y - c.y) < 0.5;
  }

  /** Anda en línea recta; devuelve true al llegar. */
  andarHacia(p, dt) {
    const dx = p.x - this.x;
    const dy = p.y - this.y;
    const dist = Math.hypot(dx, dy);
    if (dist < 0.5) {
      this.x = p.x;
      this.y = p.y;
      return true;
    }
    const avance = Math.min(dist, VELOCIDAD * dt);
    this.x += (dx / dist) * avance;
    this.y += (dy / dist) * avance;
    this.andado += avance;
    this.accion = null;
    this.dir = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'derecha' : 'izquierda') : dy > 0 ? 'abajo' : 'arriba';
    return false;
  }

  andando() {
    return this.estado === 'trabajando' ? this.espera <= 0 : this.indice !== 0 || !this.enCasa();
  }
}

// --- Dibujo de personajes ---------------------------------------------------

function dibujarPersona(ctx, a, ap) {
  const andando = a.andando();
  const paso = andando ? Math.floor(a.andado / 4) % 4 : 0;
  const trabajando = a.estado === 'trabajando' && !andando && a.accion;
  const golpe = trabajando ? Math.floor(a.tiempo * (a.accion === 'teclear' ? 8 : 3)) % 2 : 0;
  const bote = andando && paso % 2 === 1 ? 1 : 0;
  const ox = Math.round(a.x) - 5;
  const oy = Math.round(a.y) - 16;
  const espejo = a.dir === 'izquierda';
  const lado = a.dir === 'izquierda' || a.dir === 'derecha';
  const p = (cx, cy, w, h, color) => {
    ctx.fillStyle = color;
    const x = espejo ? ox + 10 - cx - w : ox + cx;
    ctx.fillRect(x, oy + cy, w, h);
  };
  const u = (cx, cy, w, h, color) => p(cx, cy + bote, w, h, color);

  // Sombra en el suelo.
  ctx.fillStyle = PALETA.sombra;
  ctx.fillRect(ox + 1, oy + 15, 8, 2);

  // Piernas y zapatos.
  if (lado) {
    const delante = paso === 1 ? 6 : paso === 3 ? 2 : 4;
    const detras = paso === 1 ? 2 : paso === 3 ? 6 : 4;
    p(detras, 12, 2, 3, ap.pantalon);
    p(detras, 15, 2, 1, PALETA.zapato);
    p(delante, 12, 2, 3, ap.pantalon);
    p(delante, 15, 3, 1, PALETA.zapato);
  } else {
    const alzaI = paso === 1 ? 1 : 0;
    const alzaD = paso === 3 ? 1 : 0;
    p(2, 12, 2, 3 - alzaI, ap.pantalon);
    p(2, 15 - alzaI, 2, 1, PALETA.zapato);
    p(6, 12, 2, 3 - alzaD, ap.pantalon);
    p(6, 15 - alzaD, 2, 1, PALETA.zapato);
  }

  if (lado) {
    // Cuerpo de perfil.
    u(3, 7, 4, 5, ap.camisa);
    const brazo = andando ? (paso === 1 ? 2 : paso === 3 ? -1 : 0) : a.accion === 'probar' ? 3 + golpe : 0;
    u(4 + brazo, 8, 2, 3, oscurecer(ap.camisa));
    u(4 + brazo, 11, 2, 1, ap.piel);
    // Cabeza.
    u(2, 1, 6, 6, ap.piel);
    u(8, 4, 1, 1, ap.piel);
    u(2, 0, 6, 1, ap.pelo);
    u(1, 1, 7, 1, ap.pelo);
    u(1, 2, 3, 3, ap.pelo);
    u(6, 3, 1, 2, PALETA.ojo);
    if (ap.gafas) u(5, 3, 3, 1, PALETA.ojo);
    if (ap.gorra) {
      u(1, 0, 7, 2, ap.gorra);
      u(7, 2, 3, 1, ap.gorra);
    }
    if (ap.cascos) {
      u(2, 0, 4, 1, '#30323f');
      u(3, 2, 2, 3, '#30323f');
    }
    return;
  }

  const deEspaldas = a.dir === 'arriba';
  // Cuerpo y brazos.
  u(1, 7, 8, 5, ap.camisa);
  u(1, 11, 8, 1, oscurecer(ap.camisa));
  if (ap.corbata && !deEspaldas) u(4, 7, 2, 4, ap.corbata);

  let manoI = 11;
  let manoD = 11;
  let brazoD = 'normal';
  if (trabajando && a.accion === 'teclear') {
    manoI = 10 + golpe;
    manoD = 11 - golpe;
  } else if (trabajando && (a.accion === 'escribir' || a.accion === 'probar')) {
    brazoD = golpe ? 'alto' : 'medio';
  } else if (trabajando && (a.accion === 'leer' || a.accion === 'cafe')) {
    brazoD = 'sujeta';
  }
  u(0, 7, 1, Math.max(1, manoI - 7), ap.camisa);
  u(0, manoI, 1, 1, ap.piel);
  if (brazoD === 'normal') {
    u(9, 7, 1, Math.max(1, manoD - 7), ap.camisa);
    u(9, manoD, 1, 1, ap.piel);
  } else if (brazoD === 'alto' || brazoD === 'medio') {
    const alto = brazoD === 'alto' ? 3 : 5;
    u(9, alto, 1, 7 - alto + 1, ap.camisa);
    u(9, alto - 1, 1, 1, ap.piel);
  } else {
    u(9, 7, 1, 2, ap.camisa);
    u(8, 8, 1, 1, ap.piel);
  }

  // Cabeza.
  u(2, 1, 6, 6, ap.piel);
  u(2, 0, 6, 1, ap.pelo);
  u(1, 1, 8, 1, ap.pelo);
  if (deEspaldas) {
    u(1, 1, 8, 5, ap.pelo);
    u(2, 6, 6, 1, oscurecer(ap.piel));
  } else {
    u(1, 2, 1, 3, ap.pelo);
    u(8, 2, 1, 3, ap.pelo);
    u(2, 2, 3, 1, ap.pelo);
    if (ap.gafas) {
      u(2, 4, 6, 1, PALETA.ojo);
      u(3, 4, 1, 1, PALETA.cristal);
      u(6, 4, 1, 1, PALETA.cristal);
    } else {
      u(3, 4, 1, 1, PALETA.ojo);
      u(6, 4, 1, 1, PALETA.ojo);
    }
    u(4, 6, 2, 1, oscurecer(ap.piel));
  }
  if (ap.gorra) {
    u(1, 0, 8, 2, ap.gorra);
    if (!deEspaldas) u(2, 2, 6, 1, oscurecer(ap.gorra));
  }
  if (ap.cascos) {
    u(1, 0, 8, 1, '#30323f');
    u(0, 3, 1, 3, '#30323f');
    u(9, 3, 1, 3, '#30323f');
  }

  // Objetos en la mano.
  if (trabajando && a.accion === 'leer' && deEspaldas) u(6, 7 + golpe, 4, 3, '#c0392b');
  if (trabajando && a.accion === 'cafe') u(8, 7, 2, 2, PALETA.blanco);
}

function oscurecer(hex) {
  const n = parseInt(hex.slice(1), 16);
  const f = (v) => Math.max(0, Math.round(v * 0.78));
  return `rgb(${f(n >> 16)}, ${f((n >> 8) & 255)}, ${f(n & 255)})`;
}

// --- Escenario --------------------------------------------------------------

function dibujarSalaFija(ctx) {
  // Suelo de tablas.
  ctx.fillStyle = PALETA.suelo;
  ctx.fillRect(0, 44, ANCHO, ALTO - 44);
  for (let y = 44; y < ALTO; y += 8) {
    ctx.fillStyle = PALETA.sueloVeta;
    ctx.fillRect(0, y + 7, ANCHO, 1);
    const desfase = ((y - 44) / 8) % 2 ? 0 : 24;
    for (let x = desfase; x < ANCHO; x += 48) ctx.fillRect(x, y, 1, 7);
    ctx.fillStyle = PALETA.sueloLuz;
    ctx.fillRect(0, y, ANCHO, 1);
  }
  // Alfombra central.
  ctx.fillStyle = '#5d3a5a';
  ctx.fillRect(112, 160, 96, 30);
  ctx.fillStyle = '#7a4d73';
  ctx.fillRect(115, 163, 90, 24);
  ctx.fillStyle = '#5d3a5a';
  for (let x = 120; x < 200; x += 8) ctx.fillRect(x, 174, 4, 2);

  // Pared.
  ctx.fillStyle = PALETA.pared;
  ctx.fillRect(0, 0, ANCHO, 44);
  ctx.fillStyle = PALETA.paredClara;
  for (let x = 0; x < ANCHO; x += 16) ctx.fillRect(x, 0, 8, 40);
  ctx.fillStyle = PALETA.zocalo;
  ctx.fillRect(0, 40, ANCHO, 4);

  // Ventanas.
  for (const vx of [124, 172]) {
    ctx.fillStyle = '#d9dce6';
    ctx.fillRect(vx, 8, 24, 24);
    ctx.fillStyle = '#ffb36b';
    ctx.fillRect(vx + 2, 10, 20, 10);
    ctx.fillStyle = '#c4688a';
    ctx.fillRect(vx + 2, 20, 20, 10);
    ctx.fillStyle = '#d9dce6';
    ctx.fillRect(vx + 11, 10, 2, 20);
    ctx.fillRect(vx + 2, 19, 20, 1);
    ctx.fillStyle = '#4b3550';
    ctx.fillRect(vx + 2, 26, 20, 4);
    ctx.fillRect(vx + 5, 23, 4, 3);
    ctx.fillRect(vx + 15, 22, 5, 4);
  }

  // Pizarra del líder.
  ctx.fillStyle = '#9aa0ae';
  ctx.fillRect(70, 8, 48, 28);
  ctx.fillStyle = PALETA.blanco;
  ctx.fillRect(72, 10, 44, 24);
  texto(ctx, 'PLAN', 74, 12, '#2f3d8f');
  ctx.fillStyle = '#d8434b';
  ctx.fillRect(74, 19, 14, 1);
  ctx.fillStyle = '#3f9a5e';
  for (let i = 0; i < 3; i++) {
    ctx.fillRect(74, 22 + i * 4, 2, 2);
    ctx.fillRect(78, 23 + i * 4, 12 + i * 4, 1);
  }
  ctx.fillStyle = '#2f3d8f';
  ctx.fillRect(98, 14, 14, 10);
  ctx.fillStyle = PALETA.blanco;
  ctx.fillRect(99, 15, 12, 8);
  ctx.fillStyle = '#e07b39';
  ctx.fillRect(101, 19, 2, 3);
  ctx.fillRect(104, 17, 2, 5);
  ctx.fillRect(107, 16, 2, 6);
  ctx.fillStyle = '#6d6f7c';
  ctx.fillRect(84, 36, 20, 2);

  // Estantería del investigador.
  ctx.fillStyle = PALETA.mesaOscura;
  ctx.fillRect(200, 4, 44, 40);
  ctx.fillStyle = '#4c2f1a';
  ctx.fillRect(202, 6, 40, 36);
  const colores = ['#c0392b', '#2f6db0', '#e0b13a', '#3f9a5e', '#8e4fb0', '#e07b39', '#d9dce6'];
  for (let fila = 0; fila < 3; fila++) {
    const y = 7 + fila * 12;
    let x = 203;
    let i = fila * 2;
    while (x < 239) {
      const w = 2 + ((i * 7) % 3);
      const h = 8 + ((i * 5) % 3);
      ctx.fillStyle = colores[i % colores.length];
      ctx.fillRect(x, y + 11 - h, w, h);
      x += w + 1;
      i += 1;
    }
    ctx.fillStyle = PALETA.mesaOscura;
    ctx.fillRect(202, y + 11, 40, 1);
  }

  // Reloj.
  ctx.fillStyle = PALETA.blanco;
  ctx.fillRect(284, 10, 12, 12);
  ctx.fillStyle = PALETA.zocalo;
  ctx.fillRect(284, 10, 12, 1);
  ctx.fillRect(284, 21, 12, 1);
  ctx.fillRect(284, 10, 1, 12);
  ctx.fillRect(295, 10, 1, 12);

  // Cuadro.
  ctx.fillStyle = '#e0b13a';
  ctx.fillRect(28, 12, 24, 18);
  ctx.fillStyle = '#2a9d8f';
  ctx.fillRect(30, 14, 20, 14);
  ctx.fillStyle = '#ecc85e';
  ctx.fillRect(42, 16, 4, 4);
  ctx.fillStyle = '#226b62';
  ctx.fillRect(30, 22, 20, 6);
}

function dibujarReloj(ctx, ahora) {
  const cx = 290;
  const cy = 16;
  ctx.fillStyle = PALETA.texto;
  const h = ((ahora.getHours() % 12) + ahora.getMinutes() / 60) / 12;
  const m = ahora.getMinutes() / 60;
  for (const [frac, largo] of [[h, 3], [m, 4]]) {
    const ang = frac * Math.PI * 2 - Math.PI / 2;
    for (let i = 0; i <= largo; i++) ctx.fillRect(Math.round(cx + Math.cos(ang) * i), Math.round(cy + Math.sin(ang) * i), 1, 1);
  }
}

function dibujarCafetera(ctx, t, ocupada) {
  ctx.fillStyle = '#5c5f6e';
  ctx.fillRect(146, 32, 24, 12);
  ctx.fillStyle = '#3a3c48';
  ctx.fillRect(150, 18, 16, 16);
  ctx.fillStyle = '#20222b';
  ctx.fillRect(154, 26, 8, 6);
  ctx.fillStyle = ocupada ? '#7dffa1' : '#d8434b';
  ctx.fillRect(152, 20, 2, 2);
  ctx.fillStyle = PALETA.blanco;
  ctx.fillRect(156, 30, 4, 3);
  if (ocupada) {
    ctx.fillStyle = 'rgba(244, 241, 234, 0.7)';
    const f = Math.floor(t * 3) % 3;
    ctx.fillRect(157 + (f === 1 ? 1 : 0), 26 - f, 1, 2);
  }
}

function dibujarMesa(ctx, id, encendida, t) {
  const m = MESAS[id];
  const x = m.x;
  const y = m.y;
  ctx.fillStyle = PALETA.sombra;
  ctx.fillRect(x + 2, y + 14, MESA_ANCHO - 2, 3);
  ctx.fillStyle = PALETA.mesa;
  ctx.fillRect(x, y, MESA_ANCHO, 5);
  ctx.fillStyle = PALETA.mesaFrente;
  ctx.fillRect(x, y + 5, MESA_ANCHO, 9);
  ctx.fillStyle = PALETA.mesaOscura;
  ctx.fillRect(x, y + 5, MESA_ANCHO, 1);
  ctx.fillRect(x + 1, y + 14, 2, 2);
  ctx.fillRect(x + MESA_ANCHO - 3, y + 14, 2, 2);
  // Placa con el nombre.
  const w = anchoTexto(m.placa) + 4;
  const px = x + Math.round((MESA_ANCHO - w) / 2);
  ctx.fillStyle = '#efe2c4';
  ctx.fillRect(px, y + 7, w, 7);
  texto(ctx, m.placa, px + 2, y + 8, PALETA.texto);

  // Monitor (de cara al espectador) y teclado.
  const mx = x + 24;
  ctx.fillStyle = PALETA.monitor;
  ctx.fillRect(mx, y - 10, 14, 10);
  ctx.fillRect(mx + 6, y, 2, 1);
  ctx.fillStyle = encendida ? PALETA.pantalla : PALETA.pantallaOff;
  ctx.fillRect(mx + 1, y - 9, 12, 8);
  if (encendida) {
    const desplaza = Math.floor(t * 4);
    for (let i = 0; i < 4; i++) {
      const largo = 3 + ((i + desplaza) * 5) % 8;
      ctx.fillStyle = (i + desplaza) % 3 ? PALETA.codigo : PALETA.codigoVerde;
      ctx.fillRect(mx + 2 + ((i + desplaza) % 2), y - 8 + i * 2, Math.min(largo, 10), 1);
    }
  }
  ctx.fillStyle = '#c9c4b5';
  ctx.fillRect(x + 8, y + 2, 12, 2);
  // Taza.
  ctx.fillStyle = PALETA.blanco;
  ctx.fillRect(x + 3, y - 2, 3, 3);
}

function dibujarPlanta(ctx, x, y) {
  ctx.fillStyle = PALETA.sombra;
  ctx.fillRect(x - 1, y, 10, 2);
  ctx.fillStyle = '#b0563a';
  ctx.fillRect(x, y - 6, 8, 6);
  ctx.fillStyle = '#8f412b';
  ctx.fillRect(x, y - 6, 8, 1);
  ctx.fillStyle = '#3f9a5e';
  ctx.fillRect(x + 1, y - 12, 6, 6);
  ctx.fillRect(x - 1, y - 10, 3, 3);
  ctx.fillRect(x + 6, y - 11, 3, 3);
  ctx.fillStyle = '#2f7a49';
  ctx.fillRect(x + 3, y - 14, 2, 8);
}

function dibujarRack(ctx, t, ocupado) {
  const x = 300;
  const y = 100;
  ctx.fillStyle = PALETA.sombra;
  ctx.fillRect(x - 1, y + 40, 18, 3);
  ctx.fillStyle = '#272a36';
  ctx.fillRect(x, y, 16, 40);
  ctx.fillStyle = '#3a3e4f';
  for (let i = 0; i < 5; i++) ctx.fillRect(x + 2, y + 3 + i * 7, 12, 5);
  for (let i = 0; i < 5; i++) {
    const on = ocupado ? (Math.floor(t * 5) + i * 3) % 4 !== 0 : false;
    const falla = ocupado && (Math.floor(t * 2) + i) % 7 === 0;
    ctx.fillStyle = on ? (falla ? '#d8434b' : '#7dffa1') : '#4b5068';
    ctx.fillRect(x + 3, y + 5 + i * 7, 2, 1);
    ctx.fillStyle = on && !falla ? '#ecc85e' : '#4b5068';
    ctx.fillRect(x + 6, y + 5 + i * 7, 1, 1);
  }
  texto(ctx, 'QA', x + 4, y - 7, '#ecc85e');
}

function dibujarBocadillo(ctx, a, seleccionado) {
  const cx = Math.round(a.x);
  const top = Math.round(a.y) - 16;
  if (a.estado !== 'trabajando') {
    // Parado: dos zetas quietas, sin animación.
    texto(ctx, 'Z', cx + 4, top - 6, PALETA.dormido);
    texto(ctx, 'Z', cx + 8, top - 10, PALETA.dormido);
  } else {
    const etiqueta = String(a.tarea?.id ?? 'TRABAJO').slice(0, 10);
    const w = anchoTexto(etiqueta) + 6;
    const h = 9;
    let bx = cx - Math.round(w / 2);
    bx = Math.max(1, Math.min(ANCHO - w - 1, bx));
    const by = top - h - 4;
    ctx.fillStyle = PALETA.bocadilloBorde;
    ctx.fillRect(bx, by, w, h);
    ctx.fillStyle = PALETA.bocadillo;
    ctx.fillRect(bx + 1, by + 1, w - 2, h - 2);
    ctx.fillRect(cx - 1, by + h - 1, 3, 1);
    ctx.fillStyle = PALETA.bocadilloBorde;
    ctx.fillRect(cx - 1, by + h, 1, 1);
    ctx.fillRect(cx + 1, by + h, 1, 1);
    ctx.fillRect(cx, by + h + 1, 1, 1);
    texto(ctx, etiqueta, bx + 3, by + 2, PALETA.texto);
  }
  if (seleccionado) {
    const f = Math.floor(a.tiempo * 3) % 2;
    const ay = top - (a.estado === 'trabajando' ? 20 : 15) - f;
    ctx.fillStyle = '#ecc85e';
    ctx.fillRect(cx - 2, ay, 5, 1);
    ctx.fillRect(cx - 1, ay + 1, 3, 1);
    ctx.fillRect(cx, ay + 2, 1, 1);
  }
}

// --- Bucle principal ----------------------------------------------------------

/**
 * Crea la oficina en un canvas.
 * @param {HTMLCanvasElement} canvas
 * @param {{ alPulsar?: (id: string) => void, roles: Array<{id: string, rol: string, nombre: string}> }} opciones
 */
export function crearOficina(canvas, { alPulsar, roles }) {
  canvas.width = ANCHO;
  canvas.height = ALTO;
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = false;

  const fondo = canvas.ownerDocument.createElement('canvas');
  fondo.width = ANCHO;
  fondo.height = ALTO;
  dibujarSalaFija(fondo.getContext('2d'));

  const mundo = { agentes: roles.map((r) => new Agente(r)) };
  const porId = new Map(mundo.agentes.map((a) => [a.id, a]));
  let seleccionado = null;
  let anterior = 0;
  let marco = 0;
  let quieto = false;
  let t = 0;

  function cuadro(ms) {
    const dt = Math.min(0.1, anterior ? (ms - anterior) / 1000 : 0);
    anterior = ms;
    t += dt;
    if (!quieto) for (const a of mundo.agentes) a.actualizar(dt, mundo);
    pintar();
    marco = requestAnimationFrame(cuadro);
  }

  function pintar() {
    ctx.drawImage(fondo, 0, 0);
    dibujarReloj(ctx, new Date());
    const cafe = mundo.agentes.some((a) => a.accion === 'cafe' && a.estado === 'trabajando');
    dibujarCafetera(ctx, t, cafe);

    const tester = porId.get('tester');
    const capas = [
      { y: 140, pintar: () => dibujarRack(ctx, t, tester?.estado === 'trabajando') },
      { y: 128, pintar: () => dibujarPlanta(ctx, 4, 128) },
      { y: 196, pintar: () => dibujarPlanta(ctx, 300, 196) },
      { y: 66, pintar: () => dibujarPlanta(ctx, 102, 66) },
    ];
    for (const id of Object.keys(MESAS)) {
      const a = porId.get(id);
      capas.push({ y: MESAS[id].y + 14, pintar: () => dibujarMesa(ctx, id, a?.estado === 'trabajando', t) });
    }
    for (const a of mundo.agentes) capas.push({ y: a.y, pintar: () => dibujarPersona(ctx, a, ASPECTO[a.id]) });
    capas.sort((p, q) => p.y - q.y);
    for (const c of capas) c.pintar();
    for (const a of mundo.agentes) dibujarBocadillo(ctx, a, a.id === seleccionado);
  }

  function agenteEn(evento) {
    const r = canvas.getBoundingClientRect();
    const x = ((evento.clientX - r.left) / r.width) * ANCHO;
    const y = ((evento.clientY - r.top) / r.height) * ALTO;
    let mejor = null;
    let distancia = Infinity;
    for (const a of mundo.agentes) {
      if (x < a.x - 7 || x > a.x + 7 || y < a.y - 30 || y > a.y + 2) continue;
      const d = Math.hypot(x - a.x, y - (a.y - 8));
      if (d < distancia) {
        distancia = d;
        mejor = a;
      }
    }
    return mejor;
  }

  const alHacerClic = (e) => {
    const a = agenteEn(e);
    if (a && alPulsar) alPulsar(a.id);
  };
  const alMover = (e) => {
    canvas.style.cursor = agenteEn(e) ? 'pointer' : 'default';
  };
  canvas.addEventListener('click', alHacerClic);
  canvas.addEventListener('mousemove', alMover);
  marco = requestAnimationFrame(cuadro);

  return {
    /** Aplica un estado calculado por derivarEquipo(). */
    actualizar(estado) {
      for (const datos of estado.agentes) porId.get(datos.id)?.fijar(datos, mundo);
    },
    seleccionar(id) {
      seleccionado = id;
    },
    /** Congela el movimiento (por ejemplo, con «reducir movimiento»). */
    pausar(valor) {
      quieto = valor;
    },
    destruir() {
      cancelAnimationFrame(marco);
      canvas.removeEventListener('click', alHacerClic);
      canvas.removeEventListener('mousemove', alMover);
    },
  };
}

/** Dibuja el personaje de frente, quieto, en un canvas pequeño (10×17). */
export function dibujarRetrato(canvas, id) {
  canvas.width = 10;
  canvas.height = 17;
  const ctx = canvas.getContext('2d');
  const a = new Agente({ id, rol: '', nombre: '' });
  a.x = 5;
  a.y = 16;
  dibujarPersona(ctx, a, ASPECTO[id]);
}
