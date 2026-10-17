import { useEffect, useRef, useState } from 'react';
import { openDropped } from '../../state/document-actions';
import { msg } from '../messages';
import styles from './open.module.css';

/** Solo arrastres de ficheros; el resto de arrastres los ignora la ventana. */
function carriesFiles(event: DragEvent): boolean {
  return event.dataTransfer?.types.includes('Files') === true;
}

/**
 * Web: mientras hay ficheros arrastrados sobre la ventana muestra la superposición;
 * al soltar abre el primero. Los eventos llegan de `window` (sincronización con el navegador).
 */
export function DropOverlay() {
  const [dragging, setDragging] = useState(false);
  // Los eventos de entrada y salida se suceden por cada elemento hijo: un contador evita parpadeos.
  const depth = useRef(0);

  useEffect(() => {
    const onEnter = (event: DragEvent): void => {
      if (!carriesFiles(event)) return;
      depth.current += 1;
      setDragging(true);
    };
    const onLeave = (event: DragEvent): void => {
      if (!carriesFiles(event)) return;
      depth.current = Math.max(0, depth.current - 1);
      if (depth.current === 0) setDragging(false);
    };
    const onOver = (event: DragEvent): void => {
      // Sin preventDefault el navegador no permite soltar.
      if (carriesFiles(event)) event.preventDefault();
    };
    const onDrop = (event: DragEvent): void => {
      if (!carriesFiles(event)) return;
      event.preventDefault();
      depth.current = 0;
      setDragging(false);
      if (event.dataTransfer !== null) void openDropped(event.dataTransfer);
    };
    window.addEventListener('dragenter', onEnter);
    window.addEventListener('dragleave', onLeave);
    window.addEventListener('dragover', onOver);
    window.addEventListener('drop', onDrop);
    return () => {
      window.removeEventListener('dragenter', onEnter);
      window.removeEventListener('dragleave', onLeave);
      window.removeEventListener('dragover', onOver);
      window.removeEventListener('drop', onDrop);
    };
  }, []);

  if (!dragging) return null;
  return (
    <div className={styles.overlay}>
      <p className={styles.overlayText}>{msg.dropHere}</p>
    </div>
  );
}
