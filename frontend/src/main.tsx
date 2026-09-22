import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { ErrorBoundary } from './components/ErrorBoundary';
import { registerBuiltins } from './core/builtins';
import './styles/app.css';

registerBuiltins();

const container = document.getElementById('root');
if (!container) throw new Error('#root missing');

createRoot(container).render(
  <StrictMode>
    <ErrorBoundary
      fallback={
        <div className="app-crash" role="alert">
          <h1>Something went wrong</h1>
          <p>The homepage hit an unexpected error. Reload to recover — your layout is saved.</p>
          <button type="button" className="tb-btn tb-btn--primary" onClick={() => location.reload()}>
            Reload
          </button>
        </div>
      }
    >
      <App />
    </ErrorBoundary>
  </StrictMode>
);
