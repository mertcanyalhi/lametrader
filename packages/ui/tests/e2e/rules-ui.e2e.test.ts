import { execSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';

/** Repository-root absolute path. */
const repoRoot = resolve(fileURLToPath(import.meta.url), '../../../../..');

/** Web package's `dist/` directory — populated by `vite build`. */
const distDir = join(repoRoot, 'packages/ui/dist');

/**
 * E2E for the rules UI build: running `vite build` produces a deployable
 * artifact — an `index.html` alongside a substantial JS bundle in `dist/assets`.
 *
 * This asserts only *deterministic* artifact properties. Earlier revisions
 * grepped the minified bundles for rule-editor marker copy ('New rule',
 * 'Price', the empty-state copy), but rolldown emits minified output
 * differently across machines — those markers were present in a local build yet
 * absent from CI's on identical versions and source — so a bundle string-grep
 * is not a reliable assertion. That the rule editor's reference shapes (Ex.1–Ex.4
 * from #396) actually render is covered deterministically in jsdom by the rules
 * UI unit tests.
 */
describe('rules web UI bundle (e2e)', () => {
  beforeAll(() => {
    rmSync(distDir, { recursive: true, force: true });
    execSync('npm run build -w @lametrader/ui', {
      cwd: repoRoot,
      stdio: 'inherit',
      env: { ...process.env, CI: '1' },
    });
  });

  it('emits an index.html alongside a substantial JS bundle in dist/', () => {
    const assets = existsSync(join(distDir, 'assets')) ? readdirSync(join(distDir, 'assets')) : [];
    const jsBytes = assets
      .filter((file) => file.endsWith('.js'))
      .reduce((sum, file) => sum + readFileSync(join(distDir, 'assets', file), 'utf8').length, 0);
    expect({
      hasIndexHtml: existsSync(join(distDir, 'index.html')),
      // A real application bundle is ~1 MB; a failed / empty build is a few KB.
      bundleIsSubstantial: jsBytes > 200_000,
    }).toEqual({ hasIndexHtml: true, bundleIsSubstantial: true });
  });
});
