import { useEffect, useRef, useState, type ChangeEvent, type KeyboardEvent } from 'react';
import { repliesOf, type ReplyAnnotation } from '../../core/annotations';
import { deleteAnnotation, getEffective } from '../../state/annotation-actions';
import { addReply, editReply } from '../../state/reply-actions';
import { IconEdit, IconTrash } from '../icons';
import { IconButton } from '../kit/IconButton';
import { commentsMsg } from '../messages-comments';
import { formatCommentDate } from './comment-date';
import styles from './ReplyThread.module.css';

export interface ReplyThreadProps {
  /** Comentario al que se responde. */
  readonly parentId: string;
  /** Esc en el campo de respuesta: cierra la ventana de comentario. */
  readonly onEscape: () => void;
}

/**
 * Hilo de respuestas de una ventana de comentario (PDF-109): lista con editar y borrar, y el campo para responder.
 * Va debajo del comentario y se relee del almacén en cada render (la ventana se redibuja con cada edición).
 */
export function ReplyThread({ parentId, onEscape }: ReplyThreadProps) {
  const replies = repliesOf(getEffective(), parentId);
  const [draft, setDraft] = useState('');
  const fieldRef = useRef<HTMLTextAreaElement>(null);

  /** Añade la respuesta; el campo se vacía y conserva el foco. */
  function send(): void {
    if (addReply(parentId, draft) === null) return;
    setDraft('');
    fieldRef.current?.focus();
  }

  function onFieldKeyDown(event: KeyboardEvent<HTMLTextAreaElement>): void {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      onEscape();
      return;
    }
    if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
      event.preventDefault();
      send();
    }
  }

  function onFieldChange(event: ChangeEvent<HTMLTextAreaElement>): void {
    setDraft(event.currentTarget.value);
  }

  return (
    <div className={styles.thread}>
      {replies.length > 0 && (
        <>
          <p className={styles.count}>{commentsMsg.replyCount(replies.length)}</p>
          <ol className={styles.list} aria-label={commentsMsg.replies}>
            {replies.map((reply) => (
              <ReplyItem
                key={reply.id}
                reply={reply}
                onDelete={() => {
                  deleteAnnotation(reply.id);
                  fieldRef.current?.focus();
                }}
              />
            ))}
          </ol>
        </>
      )}
      <textarea
        ref={fieldRef}
        className={styles.field}
        aria-label={commentsMsg.replyField}
        placeholder={commentsMsg.replyField}
        value={draft}
        onChange={onFieldChange}
        onKeyDown={onFieldKeyDown}
      />
      <div className={styles.composer}>
        <button type="button" className={styles.send} disabled={draft.trim() === ''} onClick={send}>
          {commentsMsg.replyButton}
        </button>
      </div>
    </div>
  );
}

interface ReplyItemProps {
  readonly reply: ReplyAnnotation;
  readonly onDelete: () => void;
}

function ReplyItem({ reply, onDelete }: ReplyItemProps) {
  const [editing, setEditing] = useState(false);
  const editRef = useRef<HTMLButtonElement>(null);

  /** Fin de la edición: `text` `null` = cancelada. `refocus`: devolver el foco al botón de editar. */
  function onEnd(text: string | null, refocus: boolean): void {
    setEditing(false);
    if (text !== null) editReply(reply.id, text);
    if (refocus) editRef.current?.focus();
  }

  return (
    <li className={styles.reply}>
      <header className={styles.head}>
        <span className={styles.author}>{reply.author}</span>
        <time dateTime={reply.modified}>{formatCommentDate(reply.modified)}</time>
        <span className={styles.actions}>
          <IconButton ref={editRef} label={commentsMsg.replyEdit} onClick={() => setEditing(true)}>
            <IconEdit />
          </IconButton>
          <IconButton label={commentsMsg.replyDelete} onClick={onDelete}>
            <IconTrash />
          </IconButton>
        </span>
      </header>
      {editing ? (
        <ReplyEditor initial={reply.contents} onEnd={onEnd} />
      ) : (
        <p className={styles.text}>{reply.contents}</p>
      )}
    </li>
  );
}

interface ReplyEditorProps {
  readonly initial: string;
  readonly onEnd: (text: string | null, refocus: boolean) => void;
}

/** Edición del texto de una respuesta: Intro (sin Mayús) o perder el foco confirma; Esc cancela. */
function ReplyEditor({ initial, onEnd }: ReplyEditorProps) {
  const [text, setText] = useState(initial);
  const fieldRef = useRef<HTMLTextAreaElement>(null);
  const ended = useRef(false);

  // Al empezar a editar, el foco va al final del texto.
  useEffect(() => {
    const el = fieldRef.current;
    if (el === null) return;
    el.focus();
    el.setSelectionRange(el.value.length, el.value.length);
  }, []);

  /** Una sola vez: Intro, Esc y la pérdida de foco pueden llegar en cadena. */
  function end(value: string | null, refocus: boolean): void {
    if (ended.current) return;
    ended.current = true;
    onEnd(value, refocus);
  }

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>): void {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      end(null, true);
      return;
    }
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      end(text, true);
    }
  }

  return (
    <textarea
      ref={fieldRef}
      className={styles.field}
      aria-label={commentsMsg.replyEdit}
      value={text}
      onChange={(event) => setText(event.currentTarget.value)}
      onKeyDown={onKeyDown}
      onBlur={() => end(text, false)}
    />
  );
}
