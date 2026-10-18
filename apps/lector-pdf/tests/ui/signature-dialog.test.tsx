// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createStorageStore, type Platform } from '@suite/platform';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SignatureArt } from '../../src/core/annotations/model';
import { isStoredSignatures } from '../../src/core/signature/stored';
import { signatureMsg } from '../../src/ui/messages-signature';
import { SignatureDialog } from '../../src/ui/signature/SignatureDialog';
import { SignatureMenu } from '../../src/ui/signature/SignatureMenu';
import { saveSignature, useSignatures } from '../../src/state/signature-actions';
import { services, initServices } from '../../src/state/services';
import { initialViewerState, useViewer } from '../../src/state/viewer-store';
import { createFakePlatform } from '../helpers/fake-platform';

/** Contexto 2D de mentira: basta con lo que usa el diálogo. */
function fakeContext(): CanvasRenderingContext2D {
  const ctx = {
    beginPath: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    stroke: vi.fn(),
    clearRect: vi.fn(),
    fillText: vi.fn(),
    measureText: () => ({ width: 120, actualBoundingBoxAscent: 40, actualBoundingBoxDescent: 12 }),
    getImageData: (_x: number, _y: number, w: number, h: number) => ({ data: new Uint8ClampedArray(w * h * 4) }),
  };
  return ctx as unknown as CanvasRenderingContext2D;
}

function setUpPlatform(prefs = createStorageStore(null, 'test.')): void {
  initServices({
    platform: createFakePlatform({ prefs }) as Platform,
    assetBaseUrl: '',
  });
}

function storedInPrefs(): unknown {
  return services().platform.prefs.get('signatures', isStoredSignatures);
}

/** Dibuja un trazo con eventos de puntero simulados sobre el lienzo. */
function drawStroke(canvas: HTMLElement): void {
  fireEvent.pointerDown(canvas, { clientX: 10, clientY: 10, button: 0, pointerType: 'mouse' });
  fireEvent.pointerMove(canvas, { clientX: 60, clientY: 40, buttons: 1, pointerType: 'mouse' });
  fireEvent.pointerUp(canvas, { clientX: 60, clientY: 40, pointerType: 'mouse' });
}

beforeEach(() => {
  setUpPlatform();
  useSignatures.setState({ list: [] });
  useViewer.setState({ ...initialViewerState, notice: null });
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => fakeContext());
  Object.defineProperty(document, 'fonts', {
    value: { load: vi.fn(async () => []) },
    configurable: true,
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('SignatureDialog', () => {
  it('no pinta nada cuando está cerrado', () => {
    render(<SignatureDialog open={false} onDone={() => undefined} onCancel={() => undefined} />);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('deshabilita Aceptar al abrir y lo habilita tras dibujar un trazo', () => {
    const onDone = vi.fn();
    render(<SignatureDialog open onDone={onDone} onCancel={() => undefined} />);
    const accept = screen.getByRole('button', { name: signatureMsg.accept });
    expect(accept).toBeDisabled();

    drawStroke(screen.getByLabelText(signatureMsg.canvasLabel));
    expect(accept).toBeEnabled();

    fireEvent.click(accept);
    return waitFor(() => {
      expect(onDone).toHaveBeenCalledTimes(1);
      const art = onDone.mock.calls[0]?.[0] as SignatureArt;
      expect(art.kind).toBe('ink');
    });
  });

  it('Esc cancela', async () => {
    const user = userEvent.setup();
    const onCancel = vi.fn();
    render(<SignatureDialog open onDone={() => undefined} onCancel={onCancel} />);
    await user.keyboard('{Escape}');
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('←/→ cambian de pestaña y el foco va a la pestaña activa', async () => {
    const user = userEvent.setup();
    render(<SignatureDialog open onDone={() => undefined} onCancel={() => undefined} />);
    const draw = screen.getByRole('tab', { name: signatureMsg.tabDraw });
    const text = screen.getByRole('tab', { name: signatureMsg.tabText });
    const image = screen.getByRole('tab', { name: signatureMsg.tabImage });
    expect(draw).toHaveAttribute('aria-selected', 'true');

    draw.focus();
    await user.keyboard('{ArrowRight}');
    expect(text).toHaveAttribute('aria-selected', 'true');
    expect(text).toHaveFocus();

    await user.keyboard('{ArrowRight}');
    expect(image).toHaveAttribute('aria-selected', 'true');
    expect(image).toHaveFocus();

    await user.keyboard('{ArrowRight}');
    expect(draw).toHaveAttribute('aria-selected', 'true');
    expect(draw).toHaveFocus();

    await user.keyboard('{ArrowLeft}');
    expect(image).toHaveAttribute('aria-selected', 'true');
    expect(image).toHaveFocus();
  });

  it('la pestaña Escribir con «Ana Pérez» entrega una firma rgba-deflate', async () => {
    const user = userEvent.setup();
    const onDone = vi.fn();
    render(<SignatureDialog open onDone={onDone} onCancel={() => undefined} />);
    await user.click(screen.getByRole('tab', { name: signatureMsg.tabText }));
    await user.type(screen.getByRole('textbox', { name: signatureMsg.textLabel }), 'Ana Pérez');

    const accept = screen.getByRole('button', { name: signatureMsg.accept });
    expect(accept).toBeEnabled();
    await user.click(accept);

    await waitFor(() => { expect(onDone).toHaveBeenCalledTimes(1); });
    const art = onDone.mock.calls[0]?.[0] as SignatureArt;
    expect(art.kind).toBe('image');
    if (art.kind !== 'image') throw new Error('se esperaba una imagen');
    expect(art.format).toBe('rgba-deflate');
    expect(art.pixelWidth).toBeGreaterThan(0);
    expect(art.pixelHeight).toBeGreaterThan(0);
  });

  it('el texto vacío no se puede aceptar', async () => {
    const user = userEvent.setup();
    render(<SignatureDialog open onDone={() => undefined} onCancel={() => undefined} />);
    await user.click(screen.getByRole('tab', { name: signatureMsg.tabText }));
    await user.type(screen.getByRole('textbox', { name: signatureMsg.textLabel }), '   ');
    expect(screen.getByRole('button', { name: signatureMsg.accept })).toBeDisabled();
  });

  it('con «Guardar esta firma» marcada la firma queda guardada; desmarcada, no', async () => {
    const user = userEvent.setup();
    const onDone = vi.fn();
    const { unmount } = render(<SignatureDialog open onDone={onDone} onCancel={() => undefined} />);
    drawStroke(screen.getByLabelText(signatureMsg.canvasLabel));
    await user.click(screen.getByRole('button', { name: signatureMsg.accept }));
    await waitFor(() => { expect(onDone).toHaveBeenCalledTimes(1); });
    expect(useSignatures.getState().list).toHaveLength(1);
    expect(storedInPrefs()).toHaveLength(1);
    unmount();

    render(<SignatureDialog open onDone={onDone} onCancel={() => undefined} />);
    await user.click(screen.getByRole('checkbox', { name: signatureMsg.save }));
    drawStroke(screen.getByLabelText(signatureMsg.canvasLabel));
    await user.click(screen.getByRole('button', { name: signatureMsg.accept }));
    await waitFor(() => { expect(onDone).toHaveBeenCalledTimes(2); });
    expect(useSignatures.getState().list).toHaveLength(1);
    expect(storedInPrefs()).toHaveLength(1);
  });

  it('si el almacén no conserva la firma, avisa y la firma se usa igualmente', async () => {
    setUpPlatform({ get: () => null, set: () => undefined, remove: () => undefined });
    const user = userEvent.setup();
    const onDone = vi.fn();
    render(<SignatureDialog open onDone={onDone} onCancel={() => undefined} />);
    drawStroke(screen.getByLabelText(signatureMsg.canvasLabel));
    await user.click(screen.getByRole('button', { name: signatureMsg.accept }));
    await waitFor(() => { expect(onDone).toHaveBeenCalledTimes(1); });
    expect(useViewer.getState().notice?.text).toBe(signatureMsg.storeFailed);
  });

  it('un fichero que no es una imagen válida muestra el error de imagen', async () => {
    const user = userEvent.setup();
    const onDone = vi.fn();
    const { container } = render(<SignatureDialog open onDone={onDone} onCancel={() => undefined} />);
    await user.click(screen.getByRole('tab', { name: signatureMsg.tabImage }));
    const input = container.ownerDocument.querySelector('input[type="file"]');
    if (!(input instanceof HTMLInputElement)) throw new Error('falta el selector de fichero');
    await user.upload(input, new File(['no soy una imagen'], 'firma.png', { type: 'image/png' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'La imagen no es válida o no está en un formato admitido (PNG o JPEG).',
    );
    expect(screen.getByRole('button', { name: signatureMsg.accept })).toBeDisabled();
  });
});

describe('SignatureMenu', () => {
  it('lista las firmas guardadas con miniatura y ofrece borrarlas', async () => {
    const user = userEvent.setup();
    const onPick = vi.fn();
    saveSignature({ kind: 'ink', paths: [[2, 32, 42, 2]], width: 2, box: [44, 34] });
    render(<SignatureMenu onPick={onPick} />);

    await user.click(screen.getByRole('button', { name: signatureMsg.menuLabel }));
    expect(screen.getByRole('img', { name: signatureMsg.savedName(1) })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: signatureMsg.deleteSaved(1) })).toBeInTheDocument();

    await user.click(screen.getByRole('menuitem', { name: signatureMsg.savedName(1) }));
    expect(onPick).toHaveBeenCalledWith(expect.objectContaining({ kind: 'ink' }));
  });

  it('«Borrar firma guardada 1» quita la firma de la lista y de la preferencia', async () => {
    const user = userEvent.setup();
    saveSignature({ kind: 'ink', paths: [[2, 32, 42, 2]], width: 2, box: [44, 34] });
    render(<SignatureMenu onPick={() => undefined} />);

    await user.click(screen.getByRole('button', { name: signatureMsg.menuLabel }));
    await user.click(screen.getByRole('menuitem', { name: signatureMsg.deleteSaved(1) }));
    expect(useSignatures.getState().list).toHaveLength(0);
    expect(storedInPrefs()).toHaveLength(0);
  });
});
