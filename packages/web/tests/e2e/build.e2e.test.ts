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

  it('emits a JS bundle whose contents include the rendered nav label Watchlist', () => {
    const assets = readdirSync(join(distDir, 'assets'));
    const jsFiles = assets.filter((file) => file.endsWith('.js'));
    const bundlesContainingMarker = jsFiles.filter((file) =>
      readFileSync(join(distDir, 'assets', file), 'utf8').includes('Watchlist'),
    );
    expect({
      hasAtLeastOneJsBundle: jsFiles.length > 0,
      markerFound: bundlesContainingMarker.length > 0,
    }).toEqual({ hasAtLeastOneJsBundle: true, markerFound: true });
  });

  it('emits a JS bundle whose contents include the profile picker trigger label', () => {
    // "No profile" is the profile-picker trigger's empty-state label; its
    // presence in the bundle confirms the chart's profile-picker module is
    // wired into the live route tree and ships with the deployable artifact.
    const assets = readdirSync(join(distDir, 'assets'));
    const jsFiles = assets.filter((file) => file.endsWith('.js'));
    const bundlesContainingMarker = jsFiles.filter((file) =>
      readFileSync(join(distDir, 'assets', file), 'utf8').includes('No profile'),
    );
    expect(bundlesContainingMarker.length > 0).toEqual(true);
  });

  it("emits a JS bundle whose contents include the indicator panel's no-profile warning", () => {
    // "Select or create a profile to add indicators" is the indicator-panel
    // dialog's warning copy when no profile is selected; its presence in the
    // bundle confirms the chart's indicator-panel module is wired into the
    // live route tree and ships with the deployable artifact.
    const assets = readdirSync(join(distDir, 'assets'));
    const jsFiles = assets.filter((file) => file.endsWith('.js'));
    const bundlesContainingMarker = jsFiles.filter((file) =>
      readFileSync(join(distDir, 'assets', file), 'utf8').includes(
        'Select or create a profile to add indicators',
      ),
    );
    expect(bundlesContainingMarker.length > 0).toEqual(true);
  });

  it("emits a JS bundle whose contents include the indicator legend's hide-overlay label", () => {
    // "Hide overlay" is the legend's eye-toggle accessible name (rendered when
    // the overlay is visible). Its presence in the bundle confirms the chart's
    // indicator-overlay module is wired into the live route tree and ships
    // with the deployable artifact.
    const assets = readdirSync(join(distDir, 'assets'));
    const jsFiles = assets.filter((file) => file.endsWith('.js'));
    const bundlesContainingMarker = jsFiles.filter((file) =>
      readFileSync(join(distDir, 'assets', file), 'utf8').includes('Hide overlay'),
    );
    expect(bundlesContainingMarker.length > 0).toEqual(true);
  });
});
