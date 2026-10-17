import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './ui/theme.css';
import './engine/styles';
import './engine/worker';
import { App } from './ui/App';

const container = document.getElementById('root');
if (!container) throw new Error('Falta el elemento #root en index.html');

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
