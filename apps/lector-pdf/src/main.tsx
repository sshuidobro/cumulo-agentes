import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { createIdbDraftStore, loadPlatform } from '@suite/platform';
import './ui/theme.css';
import './engine/styles';
import './engine/worker';
import { loadPdfjs } from './engine/pdfjs';
import { App } from './ui/App';
import { openRequested, registerDocumentParticipant } from './state/document-actions';
import { registerAnnotationParticipant } from './state/annotation-actions';
import { registerOrganizeParticipant } from './state/organize-actions';
import { registerRedactParticipant } from './state/redact-actions';
import { registerSignatureParticipant } from './state/digital-signature-actions';
import { registerFormsParticipant } from './state/form-actions';
import { initServices } from './state/services';
import { startPositionSync } from './state/position-sync';
import { loadAppearance } from './state/appearance-actions';
import { loadViewMode, registerViewParticipant } from './state/view-actions';
import { registerHistoryParticipant } from './state/history';
import { registerSearchParticipant } from './state/search-actions';
import { registerSidebarParticipant } from './state/sidebar-actions';
import { installCloseGuard } from './state/unsaved-guard';
import { startDraftSync } from './state/draft-sync';
import { startRecentSync } from './state/recent-actions';

const container = document.getElementById('root');
if (!container) throw new Error('Falta el elemento #root en index.html');

const platform = await loadPlatform({ prefsPrefix: 'lector-pdf.' });
initServices({ platform, assetBaseUrl: new URL('pdfjs/', document.baseURI).href });
platform.onFileOpenedFromOS((file) => void openRequested(file));
startPositionSync();
registerDocumentParticipant();
registerAnnotationParticipant();
registerOrganizeParticipant();
registerRedactParticipant();
registerSignatureParticipant();
registerFormsParticipant();
registerHistoryParticipant();
registerSearchParticipant();
registerSidebarParticipant();
registerViewParticipant();
startRecentSync();
startDraftSync(createIdbDraftStore('lector-pdf'));
loadAppearance();
loadViewMode();
installCloseGuard();

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

// ADR-0017: pdf.js se evalúa en otra tarea, después de pintar la ventana. Si falla, loadPdf lo reintenta y muestra el error.
const preloadPdfjs = (): void => {
  loadPdfjs().catch(() => undefined);
};
if (typeof window.requestIdleCallback === 'function') window.requestIdleCallback(preloadPdfjs, { timeout: 2000 });
else window.setTimeout(preloadPdfjs, 0);
