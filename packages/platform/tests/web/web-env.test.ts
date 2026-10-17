import { afterEach, describe, expect, it, vi } from 'vitest';
import { defaultWebEnv } from '../../src/web/web-env';

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
  Reflect.deleteProperty(window, 'showOpenFilePicker');
  Reflect.deleteProperty(window, 'localStorage');
});

describe('defaultWebEnv', () => {
  it('usa la ventana y el localStorage reales', () => {
    const env = defaultWebEnv();
    expect(env.window).toBe(window);
    expect(env.storage).toBe(window.localStorage);
  });

  it('closeWindow por defecto llama a window.close', () => {
    const close = vi.spyOn(window, 'close').mockImplementation(() => undefined);
    defaultWebEnv().closeWindow();
    expect(close).toHaveBeenCalledTimes(1);
  });

  it('sin File System Access no ofrece selectores', () => {
    const env = defaultWebEnv();
    expect(env.showOpenFilePicker).toBeUndefined();
    expect(env.showSaveFilePicker).toBeUndefined();
  });

  it('enlaza el selector de File System Access a window', async () => {
    const picker = vi.fn(function (this: unknown) { return Promise.resolve([]); });
    Object.defineProperty(window, 'showOpenFilePicker', { value: picker, configurable: true, writable: true });
    const env = defaultWebEnv();
    await env.showOpenFilePicker?.({ multiple: false });
    expect(picker).toHaveBeenCalledTimes(1);
    expect(picker.mock.contexts[0]).toBe(window);
  });

  it('si localStorage lanza (cookies bloqueadas) el storage es null', () => {
    Object.defineProperty(window, 'localStorage', {
      configurable: true,
      get() { throw new DOMException('bloqueado', 'SecurityError'); },
    });
    expect(defaultWebEnv().storage).toBeNull();
  });

  it('pickWithInput resuelve con el fichero elegido en el input', async () => {
    const file = new File(['abc'], 'a.pdf');
    vi.spyOn(HTMLInputElement.prototype, 'click').mockImplementation(function (this: HTMLInputElement) {
      Object.defineProperty(this, 'files', { value: [file], configurable: true });
      this.dispatchEvent(new Event('change'));
    });
    const picked = await defaultWebEnv().pickWithInput('.pdf,application/pdf');
    expect(picked).toBe(file);
  });

  it('pickWithInput resuelve con null si el usuario cancela', async () => {
    vi.spyOn(HTMLInputElement.prototype, 'click').mockImplementation(function (this: HTMLInputElement) {
      this.dispatchEvent(new Event('cancel'));
    });
    expect(await defaultWebEnv().pickWithInput('.pdf')).toBeNull();
  });

  it('pickWithInput configura el atributo accept', async () => {
    let accept = '';
    vi.spyOn(HTMLInputElement.prototype, 'click').mockImplementation(function (this: HTMLInputElement) {
      accept = this.accept;
      this.dispatchEvent(new Event('cancel'));
    });
    await defaultWebEnv().pickWithInput('.csv,text/csv');
    expect(accept).toBe('.csv,text/csv');
  });

  it('download crea un enlace, lo pulsa y revoca la URL a los 10 s', () => {
    vi.useFakeTimers();
    const createObjectURL = vi.fn((): string => 'blob:suite-test');
    const revokeObjectURL = vi.fn();
    URL.createObjectURL = createObjectURL;
    URL.revokeObjectURL = revokeObjectURL;
    let downloadName = '';
    let clicks = 0;
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      clicks += 1;
      downloadName = this.download;
      expect(this.isConnected).toBe(true);
    });

    const blob = new Blob(['x']);
    defaultWebEnv().download(blob, 'copia.pdf');

    expect(createObjectURL).toHaveBeenCalledWith(blob);
    expect(clicks).toBe(1);
    expect(downloadName).toBe('copia.pdf');
    expect(document.querySelectorAll('a[download]')).toHaveLength(0);
    expect(revokeObjectURL).not.toHaveBeenCalled();
    vi.advanceTimersByTime(10_000);
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:suite-test');
  });
});
