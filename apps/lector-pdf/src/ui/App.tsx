import { IconButton } from './kit/IconButton';
import { IconOpen } from './icons';
import { msg } from './messages';
import styles from './App.module.css';

export function App() {
  return (
    <div className={styles.app}>
      <header className={styles.toolbar} role="toolbar" aria-label={msg.toolbarLabel}>
        <IconButton label={msg.open}>
          <IconOpen />
        </IconButton>
      </header>
      <main className={styles.main}>
        <h1 className={styles.title}>{msg.emptyTitle}</h1>
        <p className={styles.hint}>{msg.emptyHint}</p>
      </main>
    </div>
  );
}
