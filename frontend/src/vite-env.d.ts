/// <reference types="vite/client" />

/**
 * `contract/fixtures.json` is the frozen, shared source of truth. It is imported
 * as `unknown` on purpose: `src/contract/fixtures.ts` validates and narrows it at
 * load time, which keeps the compiler honest and avoids inferring an 80-case
 * literal type for an artifact this package does not own.
 */
declare module '@contract/fixtures.json' {
  const fixtures: unknown;
  export default fixtures;
}
