import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { registerBuiltins } from './core/builtins';
import { attachPersistence, restoreLayout } from './core/persistence';
import './styles/app.css';

registerBuiltins();

const container = document.getElementById('root');
if (!container) throw new Error('#root missing');

void restoreLayout().then(() => {
  attachPersistence();
  createRoot(container).render(
    <StrictMode>
      <App />
    </StrictMode>
  );
});
