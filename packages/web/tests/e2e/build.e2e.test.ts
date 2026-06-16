import { execSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';

/**
 * Repository-root absolute path. Used as the working directory for the build
 * so the npm-workspace flag resolves the web package correctly.
 */
const repoRoot = resolve(fileURLToPath(import.meta.url), '../../../../..');

/**
 * Absolute path to the web package's `dist/` directory — populated by
 * `vite build`, asserted on as the deployable artifact.
 */
const distDir = join(repoRoot, 'packages/web/dist');

/**
 * E2E for the web UI boilerplate, from the end-user/spec perspective: running
 * `vite build` against `@lametrader/web` produces a deployable artifact whose
 * HTML references a JS bundle, that bundle file exists, and the bundle text
 * contains the brand string the React shell renders.
 *
 * Mirrors the spec's end-to-end expectation in `specs/web-ui-boilerplate.spec.md`.
 */
describe('web boilerplate build (e2e)', () => {
  beforeAll(() => {
    rmSync(distDir, { recursive: true, force: true });
    execSync('npm run build -w @lametrader/web', {
      cwd: repoRoot,
      stdio: 'inherit',
      env: { ...process.env, CI: '1' },
    });
  });

  it('emits an index.html that references a JS bundle from assets', () => {
    const html = readFileSync(join(distDir, 'index.html'), 'utf8');
    const match = html.match(/src="(\/assets\/[^"]+\.js)"/);
    const bundlePath = match?.[1] ?? null;
    expect({
      hasIndexHtml: existsSync(join(distDir, 'index.html')),
      bundleReferenced: bundlePath !== null,
      bundleExistsOnDisk: bundlePath !== null && existsSync(join(distDir, bundlePath.slice(1))),
    }).toEqual({
      hasIndexHtml: true,
      bundleReferenced: true,
      bundleExistsOnDisk: true,
    });
  });

  it('emits a JS bundle whose contents include the brand string lametrader', () => {
    const assets = readdirSync(join(distDir, 'assets'));
    const jsFiles = assets.filter((file) => file.endsWith('.js'));
    const bundlesContainingBrand = jsFiles.filter((file) =>
      readFileSync(join(distDir, 'assets', file), 'utf8').includes('lametrader'),
    );
    expect({
      hasAtLeastOneJsBundle: jsFiles.length > 0,
      brandFound: bundlesContainingBrand.length > 0,
    }).toEqual({ hasAtLeastOneJsBundle: true, brandFound: true });
  });
});
