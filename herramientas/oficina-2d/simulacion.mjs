// Datos de ejemplo: un equipo imaginario recorriendo el flujo de las fichas
// (pendiente → en-curso → en-revision → en-test → hecha) para ver la oficina viva
// sin necesidad de tener al equipo trabajando de verdad.
import { NUM_PROGRAMADORES, derivarEquipo } from './derivar.mjs';

const FICHAS_EJEMPLO = [
  ['PDF-001', 'Crear la app lector-pdf con Vite y React'],
  ['PDF-002', 'Abrir un PDF y mostrar la primera página'],
  ['PDF-003', 'Desplazamiento continuo con páginas virtualizadas'],
  ['PDF-004', 'Buscar texto en el documento'],
  ['PDF-005', 'Zoom, ajustar a ancho y a página'],
  ['PDF-006', 'Panel de miniaturas'],
  ['PDF-007', 'Índice (marcadores) del documento'],
  ['PDF-008', 'Imprimir el documento'],
  ['PDF-009', 'Abrir ficheros con Tauri y arrastrar y soltar'],
];

function aleatorio(semilla) {
  let s = semilla >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export class Simulacion {
  constructor(semilla = 7) {
    this.azar = aleatorio(semilla);
    this.reiniciar();
  }

  reiniciar() {
    this.fase = 'investigando';
    this.turnosFase = 2;
    this.planes = [];
    this.fichas = FICHAS_EJEMPLO.map(([id, titulo], i) => ({
      id,
      titulo,
      app: 'pdf',
      estado: 'pendiente',
      intentos: 0,
      depende_de: i < 3 ? [] : [FICHAS_EJEMPLO[i % 3]?.[0] ?? 'PDF-001'],
      turnos: 1,
    }));
  }

  /** Avanza un paso del equipo imaginario. */
  paso() {
    if (this.fase === 'investigando' || this.fase === 'planificando') {
      if (--this.turnosFase <= 0) {
        if (this.fase === 'investigando') {
          this.fase = 'planificando';
          this.turnosFase = 2;
          this.planes = [{ app: 'pdf', estado: 'borrador' }];
        } else {
          this.fase = 'programando';
          this.planes = [{ app: 'pdf', estado: 'en-curso' }];
          this.repartir();
        }
      }
      return;
    }
    if (this.fase === 'cerrado') {
      if (--this.turnosFase <= 0) this.reiniciar();
      return;
    }

    const azar = this.azar;
    for (const f of this.fichas) {
      f.turnos += 1;
      if (f.estado === 'en-curso' && f.turnos >= 2 + Math.floor(azar() * 3)) this.mover(f, 'en-revision');
      else if (f.estado === 'en-revision' && f.turnos >= 1 + Math.floor(azar() * 2)) {
        if (azar() < 0.2) {
          f.intentos += 1;
          this.mover(f, 'cambios-pedidos');
        } else this.mover(f, 'en-test');
      } else if (f.estado === 'en-test' && f.turnos >= 1 + Math.floor(azar() * 2)) {
        this.mover(f, azar() < 0.1 ? 'cambios-pedidos' : 'hecha');
      }
    }

    this.repartir();

    if (this.fichas.every((f) => f.estado === 'hecha')) {
      this.fase = 'cerrado';
      this.turnosFase = 3;
      this.planes = [{ app: 'pdf', estado: 'iteracion-cerrada' }];
    }
  }

  /** Los programadores libres cogen fichas listas (primero las devueltas). */
  repartir() {
    const hechas = new Set(this.fichas.filter((f) => f.estado === 'hecha').map((f) => f.id));
    let libres = NUM_PROGRAMADORES - this.fichas.filter((f) => f.estado === 'en-curso').length;
    const listas = [
      ...this.fichas.filter((f) => f.estado === 'cambios-pedidos'),
      ...this.fichas.filter((f) => f.estado === 'pendiente' && f.depende_de.every((d) => hechas.has(d))),
    ];
    for (const f of listas) {
      if (libres <= 0) break;
      if (f.turnos < 1) continue;
      this.mover(f, 'en-curso');
      libres -= 1;
    }
  }

  mover(f, estado) {
    f.estado = estado;
    f.turnos = 0;
  }

  estado() {
    return {
      generado: new Date().toISOString(),
      fuente: 'ejemplo',
      ...derivarEquipo({
        fichas: this.fichas,
        planes: this.planes,
        investigaciones: this.fase === 'investigando' ? [{ estado: 'en-curso', titulo: 'Paridad Adobe Acrobat', app: 'pdf' }] : [],
      }),
    };
  }
}
