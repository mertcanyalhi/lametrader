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
 * The web build emits one or more chunked bundles; the rules editor surface
 * is spread across them. Concatenate the contents so callers can look for
 * marker strings without caring which chunk they ended up in.
 */
function readBundles(): string {
  const assets = readdirSync(join(distDir, 'assets'));
  const jsFiles = assets.filter((file) => file.endsWith('.js'));
  return jsFiles.map((file) => readFileSync(join(distDir, 'assets', file), 'utf8')).join('\n');
}

/**
 * E2E for the rules UI bundle post-cutover: running `vite build` produces a
 * deployable artifact whose bundles carry the rule editor's marker copy.
 *
 * The four reference shapes (Ex.1–Ex.4 from #396) are exercised via JSDOM
 * unit tests; this e2e only asserts the bundle actually ships.
 */
describe('rules web UI bundle (e2e)', () => {
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

  it("emits a bundle carrying the rule editor's title copy", () => {
    // 'New rule' is the create-mode dialog title — its presence in the bundle
    // confirms the editor module is wired into the live route tree and ships
    // with the deployable artifact.
    const bundles = readBundles();
    expect(bundles.includes('New rule')).toEqual(true);
  });

  it("emits a bundle carrying the operand-kind label 'Price' (the rename target)", () => {
    // 'Price' replaces v1's 'Current' end-to-end per ADR 0016. The label is
    // the operand-picker dropdown copy.
    const bundles = readBundles();
    expect(bundles.includes('Price')).toEqual(true);
  });

  it('emits a bundle carrying the chart-page symbol-scoped rules dialog title copy', () => {
    // 'Rules for ' is the symbol-scoped rules modal's title prefix (the
    // chart bottom-bar Rules button opens it). Presence in the bundle confirms
    // the dialog ships with the deployable artifact (issue #427).
    const bundles = readBundles();
    expect(bundles.includes('Rules for ')).toEqual(true);
  });
});
