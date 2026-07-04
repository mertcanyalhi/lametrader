/**
 * Browser entry point — applies the initial theme, then mounts the React app
 * into the `#root` element. The theme is applied before React mounts so the
 * `dark` class is already on `<html>` when the first paint happens.
 */
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@radix-ui/themes/styles.css';
import { App } from './App';
import './index.css';
import { getLogger } from './lib/log';
import { applyInitialTheme } from './lib/theme';

applyInitialTheme();

const container = document.getElementById('root');
if (!container) {
  getLogger('main').error({ phase: 'mount' }, 'root element #root not found');
  throw new Error('root element #root not found');
}

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
