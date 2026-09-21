import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { registerBuiltins } from './core/builtins';
import './styles/app.css';

registerBuiltins();

const container = document.getElementById('root');
if (!container) throw new Error('#root missing');

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>
);
