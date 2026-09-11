/// <reference types="vite/client" />

// Imported as unknown; src/contract/fixtures.ts validates and narrows it at load time.
declare module '@contract/fixtures.json' {
  const fixtures: unknown;
  export default fixtures;
}
