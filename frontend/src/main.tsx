import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { createHttpClient } from './api/client';
import './styles.css';

const container = document.getElementById('root');
if (container === null) {
  throw new Error('index.html is missing the #root container');
}

// The one place the application chooses a transport. In development the Vite
// proxy forwards /api and /health to the Go service on localhost:8080.
createRoot(container).render(
  <StrictMode>
    <App client={createHttpClient()} />
  </StrictMode>,
);
