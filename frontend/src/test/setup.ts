import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

// Vitest runs with `globals: false`, so React Testing Library cannot register
// its own automatic cleanup. Do it explicitly.
afterEach(() => {
  cleanup();
});
