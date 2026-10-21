import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { memorySource, type OpenedFile } from '@suite/platform';
import { err, ok, type AppError, type Result } from '@suite/shared';
import { ALL_ALLOWED } from '../../src/core/pdf/crypto';
import { cipherKindOf } from '../../src/core/permissions';
import { pdfError } from '../../src/core/errors';
import type { DocOpsClient, RunOptions, SourceInput } from '../../src/core/doc-ops/client';
import { openForSave } from '../../src/core/pdf';
import { openDocument } from '../../src/state/document-actions';
import { inProcessDocOps, setDocOpsRunner } from '../../src/state/doc-ops';
import {
  protectDocument,
  protectFormError,
  removeProtection,
  toPermissionChoice,
  type ProtectForm,
} from '../../src/state/protect-actions';
import { cancelPassword, submitPassword, usePasswordPrompt } from '../../src/state/password-prompt';
import { useViewer } from '../../src/state/viewer-store';
import { securityMsg } from '../../src/ui/messages-security';
import { openedFile } from '../helpers/fake-platform';
import { fixtureBytes, openFixture, setupSaveHarness, waitForScan } from '../helpers/save-harness';

const h = setupSaveHarness();

/** Formulario base: sin protección. Cada prueba cambia solo lo que prueba. */
const NONE: ProtectForm = {
  requireOpen: false,
  openPassword: '',
  openConfirm: '',
  restrict: false,
  ownerPassword: '',
  ownerConfirm: '',
  print: 'high',
  changes: 'all-but-extract',
  copy: true,
};

const OPEN_ONLY: ProtectForm = { ...NONE, requireOpen: true, openPassword: 'abc', openConfirm: 'abc' };

/** Texto de la última notificación visible. */
function notice(): string | undefined {
  return useViewer.getState().notice?.text;
}

/** Ejecutor que sustituye la operación `target` por `result` (sin ejecutarla). El resto se ejecuta de verdad. */
function failingOp(target: string, result: Result<unknown, AppError>): DocOpsClient {
  const inner = inProcessDocOps();
  return {
    async run<T>(op: string, args: unknown, sources: readonly SourceInput[], opts?: RunOptions): Promise<Result<T, AppError>> {
      if (op === target) return result as Result<T, AppError>;
      return inner.run<T>(op, args, sources, opts);
    },
    dispose: () => inner.dispose(),
  };
}

/** Hace que la plataforma «guarde» el PDF en memoria: el fichero reabierto contiene los bytes escritos. */
function acceptBytesWrites(): void {
  h.save.mockImplementation(async (target: OpenedFile, data) => {
    if (data.kind !== 'bytes') return err(pdfError('organize-invalid'));
    return ok({ ...openedFile(target.name, memorySource(data.bytes)), canSaveInPlace: target.canSaveInPlace });
  });
}

/** Abre un PDF cifrado con su contraseña de usuario y espera al visor. */
async function openEncrypted(name: string, password: string): Promise<void> {
  const file: OpenedFile = { ...openedFile(name, memorySource(fixtureBytes(name))), canSaveInPlace: true };
  await openDocument(file, { password });
  await vi.waitFor(() => {
    expect(useViewer.getState().status).toBe('ready');
  }, { timeout: 30_000 });
  await waitForScan();
}

/** Espera a que haya una petición de contraseña visible y la responde. */
async function answerPassword(password: string): Promise<void> {
  await vi.waitFor(() => {
    expect(usePasswordPrompt.getState().request).not.toBeNull();
  });
  submitPassword(password);
}

beforeEach(() => {
  acceptBytesWrites();
});

afterEach(() => {
  setDocOpsRunner(null);
  h.save.mockClear();
  useViewer.setState({ notice: null });
});

describe('toPermissionChoice (PDF-132)', () => {
  it('sin restricciones concede todo, igual que ALL_ALLOWED', () => {
    expect(toPermissionChoice(NONE)).toEqual(ALL_ALLOWED);
    expect(toPermissionChoice({ ...NONE, restrict: false, changes: 'none', print: 'none', copy: false })).toEqual(
      ALL_ALLOWED,
    );
  });

  const restricted = { ...NONE, restrict: true };

  it('«none» no concede cambios ni impresión sin contraseña', () => {
    const p = toPermissionChoice({ ...restricted, changes: 'none', print: 'none', copy: false });
    expect(p).toEqual({ print: 'none', copy: false, modify: false, annotate: false, fillForms: false, assemble: false });
  });

  it('«assemble» concede solo montar el documento', () => {
    const p = toPermissionChoice({ ...restricted, changes: 'assemble' });
    expect(p).toEqual({ print: 'high', copy: true, modify: false, annotate: false, fillForms: false, assemble: true });
  });

  it('«forms» concede rellenar formularios', () => {
    const p = toPermissionChoice({ ...restricted, changes: 'forms' });
    expect(p).toEqual({ print: 'high', copy: true, modify: false, annotate: false, fillForms: true, assemble: false });
  });

  it('«comments» concede comentar y rellenar formularios', () => {
    const p = toPermissionChoice({ ...restricted, changes: 'comments' });
    expect(p).toEqual({ print: 'high', copy: true, modify: false, annotate: true, fillForms: true, assemble: false });
  });

  it('«all-but-extract» concede todo menos la copia, que depende de su casilla', () => {
    const p = toPermissionChoice({ ...restricted, changes: 'all-but-extract', copy: false, print: 'low' });
    expect(p).toEqual({ print: 'low', copy: false, modify: true, annotate: true, fillForms: true, assemble: true });
  });
});

describe('protectFormError (PDF-132)', () => {
  it('sin ninguna protección, pide elegir una', () => {
    expect(protectFormError(NONE)).toBe(securityMsg.chooseOne);
  });

  it('contraseña de apertura vacía con la casilla marcada', () => {
    expect(protectFormError({ ...NONE, requireOpen: true })).toBe(securityMsg.passwordRequired);
  });

  it('contraseña de permisos vacía con la restricción marcada', () => {
    expect(protectFormError({ ...NONE, restrict: true })).toBe(securityMsg.passwordRequired);
  });

  it('confirmación distinta en la contraseña de apertura', () => {
    expect(protectFormError({ ...OPEN_ONLY, openConfirm: 'abd' })).toBe(securityMsg.passwordMismatch);
  });

  it('confirmación distinta en la contraseña de permisos', () => {
    const f: ProtectForm = { ...NONE, restrict: true, ownerPassword: 'x', ownerConfirm: 'y' };
    expect(protectFormError(f)).toBe(securityMsg.passwordMismatch);
  });

  it('apertura y permisos iguales', () => {
    const f: ProtectForm = { ...OPEN_ONLY, restrict: true, ownerPassword: 'abc', ownerConfirm: 'abc' };
    expect(protectFormError(f)).toBe(securityMsg.passwordsEqual);
  });

  it('formulario válido: null', () => {
    expect(protectFormError(OPEN_ONLY)).toBeNull();
    expect(protectFormError({ ...NONE, restrict: true, ownerPassword: 'p', ownerConfirm: 'p' })).toBeNull();
    const both: ProtectForm = { ...OPEN_ONLY, restrict: true, ownerPassword: 'otra', ownerConfirm: 'otra' };
    expect(protectFormError(both)).toBeNull();
  });

  it('el primer problema es el que se muestra', () => {
    // Apertura sin confirmar y permisos vacíos: se avisa de la contraseña vacía de permisos antes que de la confirmación.
    expect(protectFormError({ ...OPEN_ONLY, openConfirm: 'x', restrict: true })).toBe(securityMsg.passwordRequired);
  });
});

describe('protectDocument (PDF-132)', () => {
  it('protege con contraseña de apertura: reabre con ella, AES-256 y sin pedirla de nuevo', async () => {
    await openFixture();

    expect(await protectDocument(OPEN_ONLY)).toBe('saved');

    expect(h.save).toHaveBeenCalledTimes(1);
    const data = h.save.mock.calls[0]?.[1] as { kind: string; bytes: Uint8Array };
    expect(data.kind).toBe('bytes');
    expect(useViewer.getState().status).toBe('ready');
    expect(useViewer.getState().encrypted).toBe(true);
    const reader = await openForSave(memorySource(data.bytes), 'abc');
    expect(reader.ok && cipherKindOf(reader.value.security)).toBe('aes-256');
    expect(await openForSave(memorySource(data.bytes), '')).toMatchObject({ ok: false });
    expect(notice()).toBe(securityMsg.protectedNotice);
  });

  it('un error de la operación se muestra en español y no toca el fichero', async () => {
    await openFixture();
    setDocOpsRunner(failingOp('protect', err(pdfError('organize-invalid'))));

    expect(await protectDocument(OPEN_ONLY)).toBe('failed');

    expect(h.save).not.toHaveBeenCalled();
    expect(notice()).toBe(pdfError('organize-invalid').message);
    expect(useViewer.getState().status).toBe('ready');
  });

  it('sin documento no hace nada', async () => {
    expect(await protectDocument(OPEN_ONLY)).toBe('nothing');
    expect(h.save).not.toHaveBeenCalled();
  });
});

describe('removeProtection (PDF-132)', () => {
  // Sin contraseña de usuario y con restricciones: al abrirlo, la operación exige la de permisos (PDF-131).
  const RESTRICTED = 'encrypted-owner-only.pdf';

  it('pide la contraseña de permisos y deja el documento sin cifrar', async () => {
    await openEncrypted(RESTRICTED, '');

    const pending = removeProtection();
    await answerPassword('propietario');

    expect(await pending).toBe('saved');
    const data = h.save.mock.calls[0]?.[1] as { kind: string; bytes: Uint8Array };
    const reader = await openForSave(memorySource(data.bytes), undefined);
    expect(reader.ok && cipherKindOf(reader.value.security)).toBe('none');
    expect(useViewer.getState().encrypted).toBe(false);
    expect(notice()).toBe(securityMsg.unprotectedNotice);
  });

  it('una contraseña de permisos incorrecta vuelve a pedirla', async () => {
    await openEncrypted(RESTRICTED, '');

    const pending = removeProtection();
    await answerPassword('mal');
    await vi.waitFor(() => {
      expect(usePasswordPrompt.getState().request?.incorrect).toBe(true);
    });
    submitPassword('propietario');

    expect(await pending).toBe('saved');
    expect(h.save).toHaveBeenCalledTimes(1);
  });

  it('cancelar la contraseña no toca el fichero', async () => {
    await openEncrypted(RESTRICTED, '');

    const pending = removeProtection();
    await vi.waitFor(() => {
      expect(usePasswordPrompt.getState().request).not.toBeNull();
    });
    cancelPassword();

    expect(await pending).toBe('cancelled');
    expect(h.save).not.toHaveBeenCalled();
  });

  it('con la contraseña de permisos ya abierta no pide nada', async () => {
    await openEncrypted(RESTRICTED, 'propietario');

    expect(await removeProtection()).toBe('saved');
    expect(usePasswordPrompt.getState().request).toBeNull();
  });

  it('con permisos completos (encrypted-aes-256) la contraseña de usuario basta: PDF-131 no exige la de permisos', async () => {
    await openEncrypted('encrypted-aes-256.pdf', 'usuario');

    expect(await removeProtection()).toBe('saved');
    expect(usePasswordPrompt.getState().request).toBeNull();
  });

  it('un PDF sin cifrar avisa de que no tiene contraseña', async () => {
    await openFixture();

    expect(await removeProtection()).toBe('failed');
    expect(h.save).not.toHaveBeenCalled();
    expect(notice()).toBe(pdfError('not-protected').message);
  });
});
