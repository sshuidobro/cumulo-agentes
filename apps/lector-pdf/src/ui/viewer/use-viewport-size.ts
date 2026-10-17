import { useEffect, useState, type RefObject } from 'react';
import type { Size } from '../../core/zoom';

const NO_SIZE: Size = { width: 0, height: 0 };

/** Tamaño interior (sin barras de desplazamiento) del elemento, actualizado con `ResizeObserver`. */
export function useViewportSize(ref: RefObject<HTMLElement | null>): Size {
  const [size, setSize] = useState<Size>(NO_SIZE);

  useEffect(() => {
    const el = ref.current;
    if (el === null) return undefined;
    const update = (): void => {
      setSize((prev) =>
        prev.width === el.clientWidth && prev.height === el.clientHeight
          ? prev
          : { width: el.clientWidth, height: el.clientHeight },
      );
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(el);
    return () => observer.disconnect();
  }, [ref]);

  return size;
}
