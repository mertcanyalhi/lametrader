import { fileURLToPath } from 'node:url';
import { configDefaults, defineConfig } from 'vitest/config';

/**
 * Resolve a workspace package to its TypeScript source entry, so the test tiers
 * exercise source directly (fast TDD, no build step) instead of stale `dist`.
 */
const pkgSrc = (name: string): string =>
  fileURLToPath(new URL(`./packages/${name}/src/index.ts`, import.meta.url));

/**
 * Workspace-package aliases. Applied per project — with `test.projects` each
 * project is isolated and does not inherit a root-level `resolve`.
 */
const alias = {
  '@lametrader/core': pkgSrc('core'),
  '@lametrader/engine': pkgSrc('engine'),
  '@lametrader/api': pkgSrc('api'),
  '@lametrader/cli': pkgSrc('cli'),
};

/**
 * Three test tiers as Vitest projects, selected with `--project`:
 *
 * - `unit` — fast, deterministic, no network. The default for `npm test` / CI.
 * - `e2e` — full hexagon wired with real infra (poll -> persist -> process -> expect).
 * - `live` — raw adapter against a real external API (`*.live.test.ts`).
 *
 * `passWithNoTests` keeps the gates green while the tree is still being built out.
 */
export default defineConfig({
  test: {
    passWithNoTests: true,
    projects: [
      {
        resolve: { alias },
        test: {
          name: 'unit',
          include: ['packages/**/src/**/*.test.ts'],
          exclude: [...configDefaults.exclude, '**/*.e2e.test.ts', '**/*.live.test.ts'],
        },
      },
      {
        resolve: { alias },
        test: {
          name: 'e2e',
          include: ['packages/*/tests/e2e/**/*.e2e.test.ts'],
          testTimeout: 30_000,
          hookTimeout: 120_000,
        },
      },
      {
        resolve: { alias },
        test: {
          name: 'live',
          include: ['packages/**/src/**/*.live.test.ts'],
          testTimeout: 20_000,
        },
      },
    ],
    coverage: {
      provider: 'v8',
      include: ['packages/**/src/**/*.ts'],
      exclude: ['**/*.test.ts', '**/index.ts', '**/testing/**'],
    },
  },
});
