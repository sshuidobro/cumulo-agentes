import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { loadPlatform } from '@suite/platform';
import './ui/theme.css';
import './engine/styles';
import './engine/worker';
import { App } from './ui/App';
import { openDocument } from './state/document-actions';
import { initServices } from './state/services';

const container = document.getElementById('root');
if (!container) throw new Error('Falta el elemento #root en index.html');

const platform = await loadPlatform({ prefsPrefix: 'lector-pdf.' });
initServices({ platform, assetBaseUrl: new URL('pdfjs/', document.baseURI).href });
platform.onFileOpenedFromOS((file) => void openDocument(file));

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
