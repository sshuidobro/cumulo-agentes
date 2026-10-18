import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { createIdbDraftStore, loadPlatform } from '@suite/platform';
import './ui/theme.css';
import './engine/styles';
import './engine/worker';
import { App } from './ui/App';
import { openRequested } from './state/document-actions';
import { initServices } from './state/services';
import { startPositionSync } from './state/position-sync';
import { loadAppearance } from './state/appearance-actions';
import { installCloseGuard } from './state/unsaved-guard';
import { startDraftSync } from './state/draft-sync';

const container = document.getElementById('root');
if (!container) throw new Error('Falta el elemento #root en index.html');

const platform = await loadPlatform({ prefsPrefix: 'lector-pdf.' });
initServices({ platform, assetBaseUrl: new URL('pdfjs/', document.baseURI).href });
platform.onFileOpenedFromOS((file) => void openRequested(file));
startPositionSync();
startDraftSync(createIdbDraftStore('lector-pdf'));
loadAppearance();
installCloseGuard();

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
