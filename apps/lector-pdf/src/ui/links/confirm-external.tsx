import { services } from '../../state/services';
import { showNotice } from '../../state/notice';
import { Dialog } from '../kit/Dialog';
import { msg } from '../messages';

export interface ConfirmExternalLinkProps {
  /** URL pendiente de confirmación, o null si no hay diálogo abierto. */
  readonly url: string | null;
  /** Se llama al cancelar, con Esc y tras confirmar. Quien lo usa quita la URL pendiente. */
  readonly onClose: () => void;
}

/**
 * Pide confirmación antes de abrir un enlace externo en el navegador (PDF-014 y PDF-016 usan el mismo diálogo).
 */
export function ConfirmExternalLink({ url, onClose }: ConfirmExternalLinkProps) {
  return (
    <Dialog
      open={url !== null}
      title={msg.confirmExternalTitle}
      actions={[
        {
          label: msg.openLink,
          onClick: () => {
            if (url !== null) openExternal(url);
            onClose();
          },
        },
        { label: msg.cancel, onClick: onClose },
      ]}
      onClose={onClose}
    >
      {url === null ? null : msg.confirmExternal(url)}
    </Dialog>
  );
}

function openExternal(url: string): void {
  void services()
    .platform.openExternalUrl(url)
    .then((result) => {
      if (!result.ok) showNotice(msg.openLinkFailed);
    });
}
