// @vitest-environment jsdom
import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createStorageStore, type Platform } from '@suite/platform';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { initServices } from '../../src/state/services';
import {
  addImages,
  closeImagesDialog,
  createPdfFromImages,
  useImagesDialog,
  type ImageItem,
} from '../../src/state/images-pdf-actions';
import { ImagesDialog } from '../../src/ui/organize/ImagesDialog';
import { imagesMsg } from '../../src/ui/messages-images';
import { organizeMsg } from '../../src/ui/messages-organize';
import { createFakePlatform } from '../helpers/fake-platform';

function isObject(value: unknown): value is object {
  return typeof value === 'object' && value !== null;
}

vi.mock('../../src/state/images-pdf-actions', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  addImages: vi.fn(async () => undefined),
  createPdfFromImages: vi.fn(async () => 'saved'),
}));

let platform: Platform;

/** Imágenes de la lista con ids image-1, image-2… y miniaturas falsas. */
function itemsOf(...names: string[]): ImageItem[] {
  return names.map((name, index) => ({
    id: `image-${String(index + 1)}`,
    name,
    bytes: new Uint8Array([1]),
    previewUrl: `blob:${name}`,
  }));
}

function setItems(items: readonly ImageItem[]): void {
  useImagesDialog.setState({ open: true, items });
}

function optionNames(): string[] {
  return within(screen.getByRole('listbox', { name: imagesMsg.list }))
    .getAllByRole('option')
    .map((option) => option.textContent);
}

beforeEach(() => {
  platform = createFakePlatform({ prefs: createStorageStore(null, 'images-ui.') });
  initServices({ platform, assetBaseUrl: '/' });
  useImagesDialog.setState({ open: true, items: [], pageSize: 'a4', margin: 18 });
});

afterEach(() => {
  closeImagesDialog();
  vi.mocked(addImages).mockClear();
  vi.mocked(createPdfFromImages).mockClear();
});

describe('ImagesDialog', () => {
  it('sin imágenes: indicación, «Crear PDF» deshabilitado y el diálogo con su nombre', () => {
    render(<ImagesDialog />);
    expect(screen.getByRole('dialog', { name: imagesMsg.title })).toBeInTheDocument();
    expect(screen.getByText(imagesMsg.hint)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: imagesMsg.create })).toBeDisabled();
  });

  it('muestra las imágenes en orden, cada una con su miniatura y sin texto alternativo', () => {
    setItems(itemsOf('foto.jpg', 'firma.png'));
    render(<ImagesDialog />);
    expect(optionNames()).toEqual(['foto.jpg', 'firma.png']);
    const thumbs = screen.getByRole('listbox', { name: imagesMsg.list }).querySelectorAll('img');
    expect(Array.from(thumbs, (img) => img.getAttribute('src'))).toEqual(['blob:foto.jpg', 'blob:firma.png']);
    expect(screen.getByRole('button', { name: imagesMsg.create })).toBeEnabled();
  });

  it('«Bajar» y «Subir» reordenan la lista; el primero no puede subir', async () => {
    setItems(itemsOf('a.jpg', 'b.jpg', 'c.jpg'));
    render(<ImagesDialog />);
    const user = userEvent.setup();
    expect(screen.getByRole('button', { name: `${imagesMsg.moveUp} a.jpg` })).toBeDisabled();
    await user.click(screen.getByRole('button', { name: `${imagesMsg.moveDown} a.jpg` }));
    expect(optionNames()).toEqual(['b.jpg', 'a.jpg', 'c.jpg']);
    await user.click(screen.getByRole('button', { name: `${imagesMsg.moveUp} c.jpg` }));
    expect(optionNames()).toEqual(['b.jpg', 'c.jpg', 'a.jpg']);
  });

  it('Alt+↓ con el foco en una imagen la baja y conserva el foco en ella', () => {
    setItems(itemsOf('a.jpg', 'b.jpg'));
    render(<ImagesDialog />);
    const first = screen.getByRole('option', { name: 'a.jpg' });
    first.focus();
    fireEvent.keyDown(first, { key: 'ArrowDown', altKey: true });
    expect(optionNames()).toEqual(['b.jpg', 'a.jpg']);
    expect(screen.getByRole('option', { name: 'a.jpg' })).toHaveFocus();
  });

  it('«Quitar» saca la imagen de la lista', async () => {
    setItems(itemsOf('a.jpg', 'b.jpg'));
    render(<ImagesDialog />);
    await userEvent.setup().click(screen.getByRole('button', { name: `${imagesMsg.remove} a.jpg` }));
    expect(optionNames()).toEqual(['b.jpg']);
  });

  it('«Añadir imágenes…» lanza el selector', async () => {
    render(<ImagesDialog />);
    await userEvent.setup().click(screen.getByRole('button', { name: imagesMsg.add }));
    expect(addImages).toHaveBeenCalledTimes(1);
  });

  it('«Crear PDF» crea el PDF con la lista actual', async () => {
    setItems(itemsOf('a.jpg'));
    render(<ImagesDialog />);
    await userEvent.setup().click(screen.getByRole('button', { name: imagesMsg.create }));
    expect(createPdfFromImages).toHaveBeenCalledTimes(1);
  });

  it('elegir «Ajustar a cada imagen» deshabilita el margen; A4 lo vuelve a habilitar y se guarda', async () => {
    render(<ImagesDialog />);
    const user = userEvent.setup();
    expect(screen.getByRole('radio', { name: imagesMsg.none })).toBeEnabled();
    await user.click(screen.getByRole('radio', { name: imagesMsg.fit }));
    expect(useImagesDialog.getState().pageSize).toBe('fit');
    expect(screen.getByRole('radio', { name: imagesMsg.none })).toBeDisabled();
    await user.click(screen.getByRole('radio', { name: imagesMsg.a4 }));
    expect(screen.getByRole('radio', { name: imagesMsg.none })).toBeEnabled();
    await user.click(screen.getByRole('radio', { name: imagesMsg.normal }));
    expect(useImagesDialog.getState().margin).toBe(36);
    expect(platform.prefs.get('images-pdf-options', isObject)).toEqual({ pageSize: 'a4', margin: 36 });
  });

  it('«Cancelar» cierra el diálogo', async () => {
    render(<ImagesDialog />);
    await userEvent.setup().click(screen.getByRole('button', { name: organizeMsg.cancel }));
    expect(useImagesDialog.getState().open).toBe(false);
  });
});
