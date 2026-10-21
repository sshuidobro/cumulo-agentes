import type { SignatureStatus } from '../../core/signature/digital';
import { goToPage } from '../../state/navigation';
import { useSignatures } from '../../state/digital-signature-actions';
import { digitalSignMsg } from '../messages-digital-signature';
import styles from './SignaturesPanel.module.css';

/** Texto del estado de una firma: el motivo si no es válida, y el aviso de cambios posteriores. */
export function signatureStatusText(status: SignatureStatus): string {
  const base = status.verdict === 'valid'
    ? digitalSignMsg.validSignature
    : status.problem ?? (status.verdict === 'invalid' ? digitalSignMsg.statusInvalid : digitalSignMsg.statusUnknown);
  return status.changedAfter ? `${base} ${digitalSignMsg.changedAfter}` : base;
}

/** Fecha ISO de la firma, legible; si no se puede leer, el texto tal cual. */
function formatSignedAt(iso: string | null): string | null {
  if (iso === null) return null;
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? iso : date.toLocaleString('es-ES');
}

interface SignatureItemProps {
  readonly status: SignatureStatus;
}

function SignatureItem({ status }: SignatureItemProps) {
  const name = status.signer?.subject ?? digitalSignMsg.unknownSigner;
  const signedAt = formatSignedAt(status.signedAt);
  const invalid = status.verdict === 'invalid' || status.changedAfter;
  const text = signatureStatusText(status);
  const body = (
    <>
      <span className={styles.name}>{name}</span>
      <span className={invalid ? `${styles.status} ${styles.statusInvalid}` : styles.status}>{text}</span>
    </>
  );
  const page = status.pageIndex;
  return (
    <li className={styles.item}>
      {page === null ? (
        <div className={styles.goto}>{body}</div>
      ) : (
        <button
          type="button"
          className={styles.goto}
          title={digitalSignMsg.goToPage(page + 1)}
          onClick={() => { goToPage(page); }}
        >
          {body}
        </button>
      )}
      <dl className={styles.details}>
        {signedAt !== null && (<><dt>{digitalSignMsg.signedAt}</dt><dd>{signedAt}</dd></>)}
        {status.reason !== null && (<><dt>{digitalSignMsg.reason}</dt><dd>{status.reason}</dd></>)}
        {status.location !== null && (<><dt>{digitalSignMsg.location}</dt><dd>{status.location}</dd></>)}
      </dl>
    </li>
  );
}

/** Pestaña «Firmas» (PDF-139): las firmas del documento con su estado. Clic en una lleva a su página. */
export function SignaturesPanel() {
  const status = useSignatures((s) => s.status);
  const list = useSignatures((s) => s.list);
  if (status === 'checking') return <p className={styles.note} role="status">{digitalSignMsg.checking}</p>;
  if (status === 'error') return <p className={styles.note} role="alert">{digitalSignMsg.checkFailed}</p>;
  if (list.length === 0) return <p className={styles.note}>{digitalSignMsg.noSignatures}</p>;
  return (
    <div className={styles.panel}>
      <ul className={styles.list} aria-label={digitalSignMsg.panelLabel}>
        {list.map((item, index) => (
          <SignatureItem key={`${item.fieldName}-${index}`} status={item} />
        ))}
      </ul>
    </div>
  );
}
