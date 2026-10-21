import { useAnnotations } from '../../state/annotation-store';
import { choosePageImage, setEditBarOpen, setTool } from '../../state/annotation-actions';
import { IconButton } from '../kit/IconButton';
import { MenuButton } from '../kit/MenuButton';
import { IconClose, IconColor, IconFontSize, IconFreeText, IconPageImage, IconRedact } from '../icons';
import { editMsg } from '../messages-edit';
import { msg } from '../messages';
import { redactMsg } from '../messages-redact';
import { colorEntries, fontSizeEntries } from './CommentToolbar';
import { RedactBar } from './RedactBar';
import styles from './CommentToolbar.module.css';

/**
 * Segunda fila de la barra principal, con «Editar» activo (PDF-130): «Añadir texto», «Añadir imagen», tamaño de letra
 * y color del texto añadido, y «Cerrar». Los botones son nativos: se alcanzan con Tab.
 */
export function EditToolbar() {
  const tool = useAnnotations((s) => s.tool);
  const colors = useAnnotations((s) => s.colors);
  const fontSize = useAnnotations((s) => s.fontSize);

  return (
    <div role="toolbar" aria-label={editMsg.editButton} aria-orientation="horizontal" className={styles.toolbar}>
      <IconButton
        label={editMsg.addText}
        pressed={tool === 'page-text'}
        onClick={() => {
          setTool(tool === 'page-text' ? 'none' : 'page-text');
        }}
      >
        <IconFreeText />
      </IconButton>
      <IconButton
        label={editMsg.addImage}
        pressed={tool === 'page-image'}
        onClick={() => {
          void choosePageImage();
        }}
      >
        <IconPageImage />
      </IconButton>
      <MenuButton label={msg.fontSize} entries={fontSizeEntries(fontSize)}>
        <IconFontSize />
      </MenuButton>
      <MenuButton label={msg.color} entries={colorEntries('page-text', colors, null)}>
        <IconColor />
      </MenuButton>
      <IconButton
        label={redactMsg.tool}
        pressed={tool === 'redact'}
        onClick={() => {
          setTool(tool === 'redact' ? 'none' : 'redact');
        }}
      >
        <IconRedact />
      </IconButton>
      {tool === 'redact' && <RedactBar />}
      <IconButton
        label={editMsg.close}
        onClick={() => {
          setEditBarOpen(false);
        }}
      >
        <IconClose />
      </IconButton>
    </div>
  );
}
