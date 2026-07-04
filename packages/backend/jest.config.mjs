/**
 * Jest is this package's test runner (Vitest stays for the rest of the
 * monorepo).
 *
 * SWC (`@swc/jest`) is the transform: it compiles the decorator-driven Nest
 * sources fast and — crucially — emits the design-type metadata the DI
 * container reads at runtime (`legacyDecorator` + `decoratorMetadata`, the
 * transform-side twin of tsconfig's `experimentalDecorators` +
 * `emitDecoratorMetadata`).  It compiles to CommonJS so Jest runs the suite
 * without Node's ESM loader, independent of this package being `type: module`.
 *
 * Two projects mirror the repo's test tiers, selected with `--selectProjects`:
 * - `unit` — `.spec.ts` files under `src`, fast and deterministic.
 * - `e2e` — `.e2e-spec.ts` files under `test`, booting the app against a
 *   Testcontainers Mongo.
 * The `.spec.ts` / `.e2e-spec.ts` suffixes are deliberately distinct from
 * Vitest's `.test.ts` / `.e2e.test.ts` globs so the two runners never collide.
 */

/**
 * The SWC transform, shared by both projects.
 * @type {[string, import('@swc/core').Options]}
 */
const swcTransform = [
  '@swc/jest',
  {
    jsc: {
      target: 'es2022',
      parser: { syntax: 'typescript', decorators: true },
      transform: { legacyDecorator: true, decoratorMetadata: true },
      keepClassNames: true,
    },
    module: { type: 'commonjs' },
  },
];

/**
 * Settings common to both tiers.
 * @type {import('jest').Config}
 */
const base = {
  transform: { '^.+\\.(t|j)s$': swcTransform },
  // reflect-metadata must be loaded before any decorated class is evaluated.
  setupFiles: ['reflect-metadata'],
  moduleFileExtensions: ['ts', 'js', 'json', 'node'],
  moduleNameMapper: {
    // Resolve the sibling workspace package to its TypeScript source, so tests
    // run without a prior `@lametrader/core` build (SWC transpiles it too).
    '^@lametrader/core$': '<rootDir>/../core/src/index.ts',
    // NodeNext sources import with explicit `.js` specifiers; strip the
    // extension so Jest resolves the real `.ts` file.
    '^(\\.{1,2}/.*)\\.js$': '$1',
  },
};

/** @type {import('jest').Config} */
export default {
  projects: [
    {
      ...base,
      displayName: 'unit',
      testMatch: ['<rootDir>/src/**/*.spec.ts'],
    },
    {
      ...base,
      displayName: 'e2e',
      testMatch: ['<rootDir>/test/**/*.e2e-spec.ts'],
      testTimeout: 120_000,
      // One shared Testcontainers Mongo for the whole tier: `globalSetup` starts
      // it and exports `MONGODB_URI` before any spec is imported (early enough
      // for `@nestjs/config`'s import-time `validate`); `reset-db` drops the
      // database before each file; `globalTeardown` stops the container.
      globalSetup: '<rootDir>/test/global-setup.ts',
      globalTeardown: '<rootDir>/test/global-teardown.ts',
      setupFilesAfterEnv: ['<rootDir>/test/reset-db.ts'],
    },
  ],
};
