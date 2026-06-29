import { execSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';

/** Repository-root absolute path. */
const repoRoot = resolve(fileURLToPath(import.meta.url), '../../../../..');

/** Web package's `dist/` directory — populated by `vite build`. */
const distDir = join(repoRoot, 'packages/web/dist');

/**
 * Read every JS bundle inside `dist/assets`.
 *
 * The web build emits one or more chunked bundles; the v2 editor's surface is
 * spread across them. Concatenate the contents so callers can look for marker
 * strings without caring which chunk they ended up in.
 */
function readBundles(): string {
  const assets = readdirSync(join(distDir, 'assets'));
  const jsFiles = assets.filter((file) => file.endsWith('.js'));
  return jsFiles.map((file) => readFileSync(join(distDir, 'assets', file), 'utf8')).join('\n');
}

/**
 * E2E for the v2 rules UI bundle: running `vite build` produces a deployable
 * artifact whose bundles carry the v2 editor's marker copy + route handle.
 *
 * Mirrors the spec's end-to-end expectation in
 * `specs/rules-v2-web-ui.spec.md`. The four reference shapes (Ex.1–Ex.4 from
 * #396) are exercised via JSDOM unit tests; this e2e only asserts the bundle
 * actually ships.
 */
describe('rules-v2 web UI bundle (e2e)', () => {
  beforeAll(() => {
    rmSync(distDir, { recursive: true, force: true });
    execSync('npm run build -w @lametrader/web', {
      cwd: repoRoot,
      stdio: 'inherit',
      env: { ...process.env, CI: '1' },
    });
  });

  it('emits an index.html alongside JS bundles in dist/', () => {
    expect({
      hasIndexHtml: existsSync(join(distDir, 'index.html')),
      hasAssetsDir: existsSync(join(distDir, 'assets')),
    }).toEqual({ hasIndexHtml: true, hasAssetsDir: true });
  });

  it("emits a bundle carrying the v2 rule editor's title copy", () => {
    // 'New rule (v2)' is the create-mode dialog title — its presence in the
    // bundle confirms the v2 editor module is wired into the live route tree
    // and ships with the deployable artifact.
    const bundles = readBundles();
    expect(bundles.includes('New rule (v2)')).toEqual(true);
  });

  it("emits a bundle carrying the v2 sidebar entry's label", () => {
    // 'Rules v2' is the feature-flagged sidebar nav entry's accessible name.
    const bundles = readBundles();
    expect(bundles.includes('Rules v2')).toEqual(true);
  });

  it('emits a bundle carrying the rules-v2 storage flag key', () => {
    // 'rulesV2Enabled' is the localStorage flag key the feature gate reads;
    // its presence in the bundle confirms the gate module ships.
    const bundles = readBundles();
    expect(bundles.includes('rulesV2Enabled')).toEqual(true);
  });

  it("emits a bundle carrying the v2 operand-kind label 'Price' (the rename target)", () => {
    // 'Price' replaces v1's 'Current' end-to-end per ADR 0016. The label is
    // the operand-picker dropdown copy.
    const bundles = readBundles();
    expect(bundles.includes('Price')).toEqual(true);
  });
});
