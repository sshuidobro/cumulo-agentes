import { create } from 'zustand';

export interface PropertiesDialogState {
  readonly open: boolean;
}

/** Estado del diálogo «Propiedades del documento» (PDF-045). Lo abren Ctrl+D y el menú «Más acciones». */
export const usePropertiesDialog = create<PropertiesDialogState>()(() => ({ open: false }));

export function openProperties(): void {
  usePropertiesDialog.setState({ open: true });
}

export function closeProperties(): void {
  usePropertiesDialog.setState({ open: false });
}
