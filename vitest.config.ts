import { configDefaults, defineConfig } from 'vitest/config';

/**
 * Three test tiers as Vitest projects, selected with `--project`:
 *
 * - `unit` — fast, deterministic, no network. Pure domain + application logic
 *   exercised against fake adapters. The default for `npm test` / CI and the
 *   tier TDD is written in.
 * - `e2e` — wires the full hexagon (real infra, real-or-recorded sources) and
 *   asserts an end-to-end outcome: poll -> persist -> process -> expect. One per
 *   major feature; run via `npm run test:e2e` and in CI on PRs.
 * - `live` — raw adapter against a real external API (`*.live.test.ts`). Flaky by
 *   nature, so opt-in via `npm run test:live` and kept out of the default run.
 *
 * `passWithNoTests` keeps the gates green while the tree is still being built out.
 */
export default defineConfig({
  test: {
    passWithNoTests: true,
    projects: [
      {
        test: {
          name: 'unit',
          include: ['packages/**/src/**/*.test.ts'],
          exclude: [...configDefaults.exclude, '**/*.e2e.test.ts', '**/*.live.test.ts'],
          passWithNoTests: true,
        },
      },
      {
        test: {
          name: 'e2e',
          include: ['packages/**/src/**/*.e2e.test.ts'],
          testTimeout: 30_000,
          passWithNoTests: true,
        },
      },
      {
        test: {
          name: 'live',
          include: ['packages/**/src/**/*.live.test.ts'],
          testTimeout: 20_000,
          passWithNoTests: true,
        },
      },
    ],
    coverage: {
      provider: 'v8',
      include: ['packages/**/src/**/*.ts'],
      exclude: ['**/*.test.ts', '**/index.ts'],
    },
  },
});
