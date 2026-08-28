const { execSync } = require('node:child_process');
const { writeFileSync, renameSync, mkdirSync } = require('node:fs');
const path = require('node:path');

const OUT = path.resolve(__dirname, '../src/app/core/constants/build-info.constants.ts');

/**
 * EC-05 — precedence chain for the build identifier:
 *   1) BUILD_ID      (injectable by any CI/CD pipeline)
 *   2) GITHUB_SHA     (GitHub Actions)
 *   3) git rev-parse  (local dev with .git available)
 *   4) 'local'        (container/tarball without .git — NEVER empty)
 */
function resolveBuildId() {
  const fromEnv = process.env.BUILD_ID || process.env.GITHUB_SHA;
  if (fromEnv) return fromEnv.slice(0, 7);
  try {
    return (
      execSync('git rev-parse --short HEAD', { stdio: ['ignore', 'pipe', 'ignore'] })
        .toString()
        .trim() || 'local'
    );
  } catch {
    return 'local';
  }
}

function render(version, buildId) {
  return (
    `// GENERATED FILE — do not edit. Produced by scripts/generate-build-info.js\n` +
    `export const BUILD_INFO = {\n` +
    `  version: ${JSON.stringify(version)},\n` +
    `  buildId: ${JSON.stringify(buildId)},\n` +
    `  builtAt: ${JSON.stringify(new Date().toISOString())},\n` +
    `} as const;\n\n` +
    `export type BuildInfo = typeof BUILD_INFO;\n`
  );
}

/** R-5/R-6: writes are atomic (write-temp-then-rename) so a concurrent build/test never reads a truncated file. */
function writeAtomic(body) {
  mkdirSync(path.dirname(OUT), { recursive: true });
  const tmp = `${OUT}.${process.pid}.tmp`;
  writeFileSync(tmp, body, 'utf8');
  renameSync(tmp, OUT);
}

function main() {
  const { version } = require('../package.json');
  const buildId = resolveBuildId();
  writeAtomic(render(version, buildId));
  console.log(`[build-info] ${version} (${buildId})`);
}

// R-5/R-6: this script must NEVER exit 1 — a failure here would break every
// build and every test run of the repo, not just the About section. If the
// primary path fails, degrade to a minimal but still-valid file.
try {
  main();
} catch (e) {
  console.warn('[build-info] degraded:', e.message);
  try {
    const { version } = require('../package.json');
    writeAtomic(render(version, 'local'));
  } catch (e2) {
    console.warn('[build-info] could not write degraded fallback:', e2.message);
  }
}
