import { useId, useState, type KeyboardEvent } from 'react';
import type { CertificateInfo } from '../../core/signature/digital';
import { certificateValidity, type CertificateValidity } from '../../core/signature/digital/placement';
import {
  chooseCertificate,
  closeSignDialog,
  setSignField,
  signInvisible,
  startPlacing,
  unlockCertificate,
  useSignDialog,
} from '../../state/digital-signature-actions';
import { Dialog } from '../kit/Dialog';
import { digitalSignMsg } from '../messages-digital-signature';
import styles from './DigitalSignDialog.module.css';

/** Hora actual para la validez del certificado (se evalúa en cada render del diálogo). */
function currentTimeMs(): number {
  return Date.now();
}

/** Fecha ISO legible; si no se puede leer, el texto tal cual. */
function formatDate(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? iso : date.toLocaleString('es-ES');
}

/** Aviso del certificado si no se puede usar, o `null` si vale ahora. */
function validityWarning(validity: CertificateValidity): string | null {
  switch (validity) {
    case 'valid':
      return null;
    case 'expired':
      return digitalSignMsg.certExpired;
    case 'not-yet-valid':
      return digitalSignMsg.certNotYetValid;
    case 'unreadable':
      return digitalSignMsg.certUnreadable;
  }
}

interface CertificateDetailsProps {
  readonly info: CertificateInfo;
}

function CertificateDetails({ info }: CertificateDetailsProps) {
  return (
    <dl className={styles.details}>
      <dt>{digitalSignMsg.certSubject}</dt>
      <dd>{info.subject}</dd>
      <dt>{digitalSignMsg.certIssuer}</dt>
      <dd>{info.issuer}</dd>
      <dt>{digitalSignMsg.certValidFrom}</dt>
      <dd>{formatDate(info.validFrom)}</dd>
      <dt>{digitalSignMsg.certValidTo}</dt>
      <dd>{formatDate(info.validTo)}</dd>
    </dl>
  );
}

/**
 * «Firmar con certificado» (PDF-139): elegir un .p12/.pfx, desbloquearlo con su contraseña y firmar, visible (con
 * recuadro que se coloca en la página) o invisible. La contraseña escrita vive solo en `SignDialogBody`, que se
 * desmonta al cerrar el diálogo: al reabrirlo el campo aparece vacío.
 */
export function DigitalSignDialog() {
  const open = useSignDialog((s) => s.open);
  if (!open) return null;
  return <SignDialogBody />;
}

function SignDialogBody() {
  const open = useSignDialog((s) => s.open);
  const form = useSignDialog((s) => s.form);
  const error = useSignDialog((s) => s.error);
  const [password, setPassword] = useState('');
  // Al elegir otro certificado (objeto nuevo en `form.p12`) se borra la contraseña escrita para el anterior.
  const [passwordFor, setPasswordFor] = useState(form.p12);
  if (passwordFor !== form.p12) {
    setPasswordFor(form.p12);
    setPassword('');
  }
  const [busy, setBusy] = useState(false);
  const certId = useId();
  const passId = useId();
  const reasonId = useId();
  const locationId = useId();

  const validity = form.info === null ? null : certificateValidity(form.info, currentTimeMs());
  const warning = validity === null ? null : validityWarning(validity);
  const canSign = form.p12 !== null && form.info !== null && validity === 'valid' && !busy;

  const unlock = async (): Promise<void> => {
    if (busy || form.p12 === null) return;
    setBusy(true);
    const ok = await unlockCertificate(password);
    setBusy(false);
    if (ok) setPassword('');
  };

  // Intro en la contraseña equivale a «Desbloquear».
  const onPasswordKeyDown = (event: KeyboardEvent<HTMLInputElement>): void => {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    void unlock();
  };

  const sign = (): void => {
    if (!canSign) return;
    if (form.visible) startPlacing();
    else void signInvisible();
  };

  return (
    <Dialog
      open={open}
      title={digitalSignMsg.dialogTitle}
      onClose={closeSignDialog}
      actions={[
        { label: form.visible ? digitalSignMsg.placeAndSign : digitalSignMsg.sign, onClick: sign, disabled: !canSign },
        { label: digitalSignMsg.cancel, onClick: closeSignDialog },
      ]}
    >
      {error !== null && <p className={styles.error} role="alert">{error}</p>}
      <fieldset className={styles.section}>
        <legend className={styles.legend}>{digitalSignMsg.certificateGroup}</legend>
        <div className={styles.row}>
          <button type="button" className={styles.button} onClick={() => { void chooseCertificate(); }}>
            {digitalSignMsg.chooseCertificate}
          </button>
          <span id={certId}>{form.p12 === null ? digitalSignMsg.noCertificate : form.p12.name}</span>
        </div>
        {form.p12 !== null && (
          <div className={styles.row}>
            <label htmlFor={passId}>{digitalSignMsg.passwordLabel}</label>
            <input
              id={passId}
              type="password"
              autoComplete="off"
              className={styles.input}
              value={password}
              aria-describedby={certId}
              onChange={(event) => { setPassword(event.target.value); }}
              onKeyDown={onPasswordKeyDown}
            />
            <button type="button" className={styles.button} disabled={busy} onClick={() => { void unlock(); }}>
              {digitalSignMsg.unlock}
            </button>
          </div>
        )}
        {form.info !== null && (
          <>
            <p className={styles.muted}>{digitalSignMsg.unlocked}</p>
            <CertificateDetails info={form.info} />
          </>
        )}
        {warning !== null && <p className={styles.warning} role="alert">{warning}</p>}
      </fieldset>

      <fieldset className={styles.section}>
        <legend className={styles.legend}>{digitalSignMsg.signatureType}</legend>
        <label className={styles.option}>
          <input
            type="radio"
            name={`${certId}-mode`}
            checked={form.visible}
            onChange={() => { setSignField({ visible: true }); }}
          />
          {digitalSignMsg.visibleOption}
        </label>
        <label className={styles.option}>
          <input
            type="radio"
            name={`${certId}-mode`}
            checked={!form.visible}
            onChange={() => { setSignField({ visible: false }); }}
          />
          {digitalSignMsg.invisibleOption}
        </label>
      </fieldset>

      <div className={styles.row}>
        <label htmlFor={reasonId}>{digitalSignMsg.reasonLabel}</label>
        <input
          id={reasonId}
          type="text"
          className={styles.input}
          value={form.reason}
          onChange={(event) => { setSignField({ reason: event.target.value }); }}
        />
      </div>
      <div className={styles.row}>
        <label htmlFor={locationId}>{digitalSignMsg.locationLabel}</label>
        <input
          id={locationId}
          type="text"
          className={styles.input}
          value={form.location}
          onChange={(event) => { setSignField({ location: event.target.value }); }}
        />
      </div>
      <p className={styles.muted}>{digitalSignMsg.localNote}</p>
    </Dialog>
  );
}
