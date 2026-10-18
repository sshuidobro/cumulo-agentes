import { createPortal } from 'react-dom';
import { usePrintJob } from '../../state/print-actions';

/**
 * Documento de impresión (PDF-044): una hoja por página, con su imagen. Vive en `body` y solo se ve al imprimir
 * (`print.css`). Sin impresión en curso está vacío.
 */
export function PrintContainer() {
  const sheets = usePrintJob((s) => s.sheets);
  const sheet = usePrintJob((s) => s.sheet);
  const pageCss = usePrintJob((s) => s.pageCss);

  return createPortal(
    <div id="print-container">
      {pageCss === null ? null : <style>{pageCss}</style>}
      {sheet === null
        ? null
        : sheets.map((item) => {
            // Con giro, la imagen se dibuja en una caja de lado invertido y se gira 90° sobre su centro.
            const rotated = item.rotate === 90;
            const boxWidth = rotated ? sheet.heightPt : sheet.widthPt;
            const boxHeight = rotated ? sheet.widthPt : sheet.heightPt;
            return (
              <div
                key={item.url}
                className="sheet"
                style={{ width: `${String(sheet.widthPt)}pt`, height: `${String(sheet.heightPt)}pt` }}
              >
                <img
                  src={item.url}
                  alt=""
                  data-rotate={item.rotate}
                  style={{
                    width: `${String(boxWidth)}pt`,
                    height: `${String(boxHeight)}pt`,
                    transform: rotated ? 'translate(-50%, -50%) rotate(90deg)' : 'translate(-50%, -50%)',
                  }}
                />
              </div>
            );
          })}
    </div>,
    document.body,
  );
}
