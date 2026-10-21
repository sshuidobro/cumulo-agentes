/**
 * Textos de «Editar texto» (PDF-146, PDF-147): avisos, confirmación de guardado y etiquetas.
 */
import type { LineIssue } from '../core/edit-text';

/** Motivo por el que una línea no se puede editar (el de `LineIssue` del núcleo). */
const issue: Record<LineIssue, string> = {
  'no-text': 'No hay texto editable en ese punto.',
  unsupported:
    'Esta línea no se puede editar: usa un tipo de letra o una estructura que la aplicación no sabe modificar sin riesgo.',
  rotated: 'Solo se pueden editar líneas horizontales.',
  invisible: 'Esta línea es texto oculto (por ejemplo, de un reconocimiento de texto) y no se puede editar.',
};

export const editTextMsg = {
  /** Botón de la herramienta. */
  tool: 'Editar texto',
  /** Ayuda de la herramienta. */
  toolHint: 'Doble clic en una línea para corregirla',
  /** Aviso al pulsar donde no hay texto. */
  noText: 'No hay texto en ese punto.',
  /** Aviso si pdf.js no puede leer la página. */
  readFailed: 'No se pudo leer el texto de la página.',
  /** Motivo por el que una línea no es editable. */
  issue,
  /** Aviso si hay cambios de otra herramienta sin guardar. */
  otherPending: 'Guarda o descarta antes los cambios de Organizar páginas o Redactar.',
  /** Aviso si el texto nuevo tiene saltos de línea. */
  noLineBreaks: 'El texto editado debe ocupar una sola línea.',
  /** Aviso si el texto nuevo tiene un carácter que la fuente estándar no puede mostrar. */
  unsupportedChar: (ch: string): string => `El carácter «${ch}» no se puede escribir con los tipos de letra estándar.`,
  /** Título de la confirmación de guardado y del progreso. */
  confirmTitle: 'Guardar texto editado',
  /** Cuerpo de la confirmación de guardado. */
  confirmBody: (n: number): string =>
    `Se reescribirán ${n === 1 ? '1 línea' : `${n} líneas`} con un tipo de letra estándar (Helvetica, Times o Courier) parecido al original. El texto anterior se eliminará del fichero y no se podrá recuperar.`,
  /** Aviso adicional si el documento tiene firmas digitales. */
  signaturesWarning: 'Este documento tiene firmas digitales: dejarán de ser válidas.',
  /** Progreso al escribir el fichero. */
  progress: (done: number, total: number): string => `Escribiendo el texto editado: ${done} de ${total}…`,
  save: 'Guardar',
  cancel: 'Cancelar',
  /** Aviso tras guardar. */
  done: (n: number): string => (n === 1 ? 'Se ha guardado 1 línea editada.' : `Se han guardado ${n} líneas editadas.`),
  /** Contador de líneas editadas. */
  edited: (n: number): string => (n === 1 ? '1 línea editada' : `${n} líneas editadas`),
  /** Quita la edición y vuelve al texto original. */
  restore: 'Restaurar texto original',
  /** Etiqueta de «Deshacer» para una edición de línea («Deshacer edición de línea»). */
  undoEdit: 'edición de línea',
  /** Etiqueta de «Deshacer» para una restauración («Deshacer restauración de línea»). */
  undoRestore: 'restauración de línea',
  /** Nombre accesible del cuadro de edición de una línea. */
  editorLabel: (page: number): string => `Editar línea de la página ${page}`,
};
