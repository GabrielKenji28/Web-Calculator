import { fileURLToPath, URL } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

/**
 * `contract/fixtures.json` lives outside this package's root. The `@contract`
 * alias gives it a stable specifier, and `server.fs.allow` lets the dev server
 * actually read it from above the project root.
 */
const projectRoot = fileURLToPath(new URL('.', import.meta.url));
const contractDir = fileURLToPath(new URL('../contract', import.meta.url));

/** The Go service this app is proxied to during development. */
const BACKEND_ORIGIN = 'http://localhost:8080';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@contract': contractDir,
    },
  },
  server: {
    port: 5173,
    fs: {
      allow: [projectRoot, contractDir],
    },
    // Wired up now so the integration milestone is a client swap, not a config change.
    proxy: {
      '/api': { target: BACKEND_ORIGIN, changeOrigin: true },
      '/health': { target: BACKEND_ORIGIN, changeOrigin: true },
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
  },
  test: {
    environment: 'jsdom',
    globals: false,
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'lcov'],
      include: ['src/**/*.ts', 'src/**/*.tsx'],
      exclude: [
        // Browser bootstrap: a few lines of createRoot wiring, nothing to assert.
        'src/main.tsx',
        'src/**/*.d.ts',
        // Only the harness setup is excluded, not all of src/test. The fixture
        // preview adapter lives there now, and it is real, asserted-on logic —
        // excluding the whole directory would drop it out of the denominator and
        // inflate the reported figure.
        'src/test/setup.ts',
        'src/__tests__/**',
      ],
    },
  },
});
