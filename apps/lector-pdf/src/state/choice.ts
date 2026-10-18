import { create } from 'zustand';

/** Opción de un diálogo de elección: el botón muestra `label` y al pulsarlo se resuelve con `value`. */
export interface ChoiceOption<T extends string> {
  readonly label: string;
  readonly value: T;
}

export interface ChoiceSpec<T extends string> {
  readonly title: string;
  readonly message?: string;
  /** Botones del pie, en orden. El primero recibe el foco. */
  readonly options: readonly ChoiceOption<T>[];
  /** Valor con el que se resuelve si el usuario cierra con Esc (debe ser el de un botón de «Cancelar»). */
  readonly cancel: T;
}

interface ActiveChoice {
  readonly title: string;
  readonly message: string | null;
  readonly options: readonly { readonly label: string; readonly pick: () => void }[];
  readonly dismiss: () => void;
}

/** Diálogo de elección visible (lo pinta `ui/kit/ChoiceDialog`). Como mucho uno a la vez. */
export const useChoice = create<{ readonly active: ActiveChoice | null }>()(() => ({ active: null }));

/**
 * Muestra un diálogo modal con botones y espera la elección. Si ya había uno abierto, este se cierra
 * con su valor de cancelación. Cada promesa se resuelve exactamente una vez.
 */
export function askChoice<T extends string>(spec: ChoiceSpec<T>): Promise<T> {
  return new Promise<T>((resolve) => {
    const previous = useChoice.getState().active;
    let current: ActiveChoice | null = null;
    let settled = false;
    const settle = (value: T): void => {
      if (settled) return;
      settled = true;
      if (useChoice.getState().active === current) useChoice.setState({ active: null });
      resolve(value);
    };
    previous?.dismiss();
    current = {
      title: spec.title,
      message: spec.message ?? null,
      options: spec.options.map((option) => ({ label: option.label, pick: () => { settle(option.value); } })),
      dismiss: () => { settle(spec.cancel); },
    };
    useChoice.setState({ active: current });
  });
}
