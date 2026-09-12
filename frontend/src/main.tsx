import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { createHttpClient } from './api/client';
import './styles.css';

const container = document.getElementById('root');
if (container === null) {
  throw new Error('index.html is missing the #root container');
}

createRoot(container).render(
  <StrictMode>
    <App client={createHttpClient()} />
  </StrictMode>,
);
