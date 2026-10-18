import { create, type StoreApi, type UseBoundStore } from 'zustand';
import { DEFAULT_NIGHT_MODE, DEFAULT_THEME, type Theme } from '../core/appearance';

export interface AppearanceState {
  readonly theme: Theme;
  /** Modo noche de las páginas: el documento se dibuja con `NIGHT_PAGE_COLORS`. */
  readonly nightMode: boolean;
}

export const useAppearance: UseBoundStore<StoreApi<AppearanceState>> = create<AppearanceState>()(() => ({
  theme: DEFAULT_THEME,
  nightMode: DEFAULT_NIGHT_MODE,
}));
