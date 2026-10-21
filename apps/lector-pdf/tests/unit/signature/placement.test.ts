import { describe, expect, it } from 'vitest';
import {
  KEYBOARD_SIGNATURE_BOX_PT,
  MIN_SIGNATURE_BOX_PT,
  centeredSignatureBox,
  certificateValidity,
  isLargeEnoughBox,
} from '../../../src/core/signature/digital/placement';
import type { CertificateInfo } from '../../../src/core/signature/digital';

const INFO: CertificateInfo = {
  subject: 'Prueba Cúmulo',
  issuer: 'Prueba Cúmulo',
  serial: '01',
  validFrom: '2026-01-01T00:00:00.000Z',
  validTo: '2027-01-01T00:00:00.000Z',
};

describe('recuadro de firma visible', () => {
  it('acepta exactamente el mínimo y rechaza algo menor en cualquiera de los dos lados', () => {
    expect(isLargeEnoughBox([0, 0, MIN_SIGNATURE_BOX_PT.width, MIN_SIGNATURE_BOX_PT.height])).toBe(true);
    expect(isLargeEnoughBox([0, 0, MIN_SIGNATURE_BOX_PT.width - 1, 100])).toBe(false);
    expect(isLargeEnoughBox([0, 0, 300, MIN_SIGNATURE_BOX_PT.height - 1])).toBe(false);
  });

  it('cuenta el tamaño sin importar el sentido del arrastre', () => {
    expect(isLargeEnoughBox([300, 200, 0, 0])).toBe(true);
    expect(isLargeEnoughBox([60, 20, 0, 0])).toBe(true);
  });

  it('centra el recuadro de teclado de 200×60 pt en la página', () => {
    const rect = centeredSignatureBox(612, 792);
    expect(rect).toEqual([206, 366, 406, 426]);
    expect(rect[2] - rect[0]).toBe(KEYBOARD_SIGNATURE_BOX_PT.width);
    expect(rect[3] - rect[1]).toBe(KEYBOARD_SIGNATURE_BOX_PT.height);
  });
});

describe('validez del certificado', () => {
  const from = Date.parse(INFO.validFrom);
  const to = Date.parse(INFO.validTo);

  it('vale entre las dos fechas, con los límites incluidos', () => {
    expect(certificateValidity(INFO, from)).toBe('valid');
    expect(certificateValidity(INFO, to)).toBe('valid');
    expect(certificateValidity(INFO, (from + to) / 2)).toBe('valid');
  });

  it('está caducado después de validTo y aún no es válido antes de validFrom', () => {
    expect(certificateValidity(INFO, to + 1)).toBe('expired');
    expect(certificateValidity(INFO, from - 1)).toBe('not-yet-valid');
  });

  it('no puede juzgar un certificado cuyas fechas no se leen', () => {
    expect(certificateValidity({ ...INFO, validTo: 'no es una fecha' }, from)).toBe('unreadable');
  });
});
