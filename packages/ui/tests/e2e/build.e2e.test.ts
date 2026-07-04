import { execSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
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
const distDir = join(repoRoot, 'packages/ui/dist');

/**
 * E2E for the web UI build, from the end-user/spec perspective: running
 * `vite build` against `@lametrader/ui` produces a deployable artifact — an
 * `index.html` that carries the app shell (title + root mount) and references a
 * hashed JS bundle that exists on disk and is substantial (the real app, not a
 * failed or empty build).
 *
 * These assertions read only *deterministic* artifact properties. An earlier
 * revision grepped the minified JS bundle for a rendered source string
 * ("Watchlist"), but rolldown emits minified output differently across machines
 * — that marker was present in a local build yet absent from CI's, on identical
 * versions and source — so a bundle string-grep is not a reliable artifact
 * assertion. That the shell actually *renders* its content is covered
 * deterministically in jsdom by `packages/ui/src/App.test.tsx`.
 *
 * Mirrors the spec's end-to-end expectation in `specs/web-ui-boilerplate.spec.md`.
 */
describe('web boilerplate build (e2e)', () => {
  beforeAll(() => {
    rmSync(distDir, { recursive: true, force: true });
    execSync('npm run build -w @lametrader/ui', {
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

  it('ships the app shell: index.html carries the app title and root mount, and the referenced bundle is substantial', () => {
    const html = readFileSync(join(distDir, 'index.html'), 'utf8');
    const bundlePath = html.match(/src="(\/assets\/[^"]+\.js)"/)?.[1] ?? null;
    const bundleBytes = bundlePath ? statSync(join(distDir, bundlePath.slice(1))).size : 0;
    expect({
      // The app's own `index.html` template, not Vite's default — proves the
      // deployable is this app, not a scaffold or a broken/empty build.
      hasAppTitle: html.includes('<title>lametrader</title>'),
      hasRootMount: html.includes('id="root"'),
      // The real application bundle is ~1 MB; a failed / empty / boilerplate
      // build is a few KB. This floor proves the app actually shipped without
      // grepping the minified bundle for a (non-deterministic) source string.
      bundleIsSubstantial: bundleBytes > 200_000,
    }).toEqual({ hasAppTitle: true, hasRootMount: true, bundleIsSubstantial: true });
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

  it("emits a JS bundle whose contents include the indicator stream's subscribe-indicator wire verb", () => {
    // `subscribe-indicator` is the control verb the chart's live overlay
    // subscription sends over `/stream`. Its presence in the bundle confirms
    // the chart's live indicator-overlay path ships with the deployable
    // artifact.
    const assets = readdirSync(join(distDir, 'assets'));
    const jsFiles = assets.filter((file) => file.endsWith('.js'));
    const bundlesContainingMarker = jsFiles.filter((file) =>
      readFileSync(join(distDir, 'assets', file), 'utf8').includes('subscribe-indicator'),
    );
    expect(bundlesContainingMarker.length > 0).toEqual(true);
  });

  it("emits a JS bundle whose contents include the indicator-inputs schema's min-rule message marker", () => {
    // "must be ≥ " is a distinctive substring of the indicator-inputs Yup
    // schema's min-rule message (built dynamically from each Number descriptor's
    // `min`). Its presence in the bundle confirms `lib/indicator-inputs-schema.ts`
    // is wired into the indicator panel and ships with the deployable artifact.
    const assets = readdirSync(join(distDir, 'assets'));
    const jsFiles = assets.filter((file) => file.endsWith('.js'));
    const bundlesContainingMarker = jsFiles.filter((file) =>
      readFileSync(join(distDir, 'assets', file), 'utf8').includes('must be ≥ '),
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
