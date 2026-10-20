import { create } from 'zustand';

export interface PasswordRequest {
  /** Identifica cada petición: el diálogo se vuelve a montar (campo vacío) en cada intento nuevo. */
  readonly id: number;
  readonly name: string;
  readonly incorrect: boolean;
  /** Texto del diálogo; `null` = el de «está protegido, escribe la contraseña para abrirlo». */
  readonly text: string | null;
}

/** Petición de contraseña visible (la pinta `ui/security/PasswordDialog`). Como mucho una a la vez. */
export const usePasswordPrompt = create<{ readonly request: PasswordRequest | null }>()(() => ({ request: null }));

/** Resolución de la petición activa. Vive fuera del store: una función no es estado serializable. */
let pending: ((password: string | null) => void) | null = null;
let lastId = 0;

/**
 * Pide la contraseña de un PDF protegido. Resuelve con la contraseña escrita o con `null` si se cancela.
 * Si ya había una petición, esta se cancela (se resuelve con `null`). Cada promesa se resuelve exactamente una vez.
 * La contraseña solo vive en esta promesa y en el campo del diálogo: no se registra ni se guarda aquí.
 */
export function askPassword(name: string, incorrect: boolean, text: string | null = null): Promise<string | null> {
  pending?.(null);
  return new Promise<string | null>((resolve) => {
    pending = resolve;
    lastId += 1;
    usePasswordPrompt.setState({ request: { id: lastId, name, incorrect, text } });
  });
}

function settle(password: string | null): void {
  const resolve = pending;
  pending = null;
  usePasswordPrompt.setState({ request: null });
  resolve?.(password);
}

/** Lo llama el diálogo al pulsar «Abrir» (o Intro) con un valor no vacío. */
export function submitPassword(password: string): void {
  if (pending !== null) settle(password);
}

/** Cancela la petición activa (botón «Cancelar», Esc o apertura reemplazada). Sin petición, no hace nada. */
export function cancelPassword(): void {
  if (pending !== null) settle(null);
}
