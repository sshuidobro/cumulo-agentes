/**
 * jsdom no implementa ResizeObserver ni calcula layout. Este doble registra los observadores para que
 * el test dispare los cambios de tamaño con `triggerResize`.
 */
export class FakeResizeObserver {
  static instances: FakeResizeObserver[] = [];
  readonly targets = new Set<Element>();
  private readonly callback: ResizeObserverCallback;

  constructor(callback: ResizeObserverCallback) {
    this.callback = callback;
    FakeResizeObserver.instances.push(this);
  }

  observe(target: Element): void {
    this.targets.add(target);
  }

  unobserve(target: Element): void {
    this.targets.delete(target);
  }

  disconnect(): void {
    this.targets.clear();
    FakeResizeObserver.instances = FakeResizeObserver.instances.filter((o) => o !== this);
  }

  /** Avisa a los observadores de `target` como si su tamaño hubiera cambiado. */
  static triggerResize(target: Element): void {
    for (const observer of FakeResizeObserver.instances) {
      if (observer.targets.has(target)) observer.callback([], observer as unknown as ResizeObserver);
    }
  }
}

export function installResizeObserver(): void {
  if (typeof globalThis.ResizeObserver === 'undefined') {
    globalThis.ResizeObserver = FakeResizeObserver as unknown as typeof ResizeObserver;
  }
}
