const path = require('node:path');
const { writeFileSync, renameSync, mkdirSync } = require('node:fs');

const OUT = path.resolve(__dirname, '../src/assets/legal/oss-licenses.json');
const REPO_ROOT = path.resolve(__dirname, '..');

/**
 * Normalizes the `licenses` field returned by license-checker-rseidelsohn,
 * which can be a string, an array of strings, or missing entirely.
 * Never throws — a package with an unparsable license degrades to 'UNKNOWN'
 * (AD-3) instead of failing the whole generation.
 */
function normalizeLicense(raw) {
  if (!raw) return 'UNKNOWN';
  const value = Array.isArray(raw) ? raw.join(' OR ') : String(raw);
  return value.trim() || 'UNKNOWN';
}

function splitNameVersion(key) {
  const at = key.lastIndexOf('@');
  // Scoped packages (@scope/name@version) always have their version separator
  // after index 0; a bare '@1.0.0' key (no version) would have at === 0.
  if (at <= 0) return { name: key, version: '' };
  return { name: key.slice(0, at), version: key.slice(at + 1) };
}

/** NFR-S-135-02: production dependencies only — devDependencies never appear here. */
function buildManifest(packages) {
  const entries = Object.entries(packages || {})
    .map(([key, meta]) => {
      const { name, version } = splitNameVersion(key);
      return {
        name,
        version,
        license: normalizeLicense(meta && meta.licenses),
        repository: (meta && meta.repository) || null,
      };
    })
    .filter((entry) => entry.name && entry.version)
    .sort((a, b) => a.name.localeCompare(b.name) || a.version.localeCompare(b.version));

  return { generatedAt: new Date().toISOString(), packages: entries };
}

/** Atomic write (write-temp-then-rename): no reader ever sees a truncated file. */
function writeManifest(manifest) {
  mkdirSync(path.dirname(OUT), { recursive: true });
  const tmp = `${OUT}.${process.pid}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  renameSync(tmp, OUT);
}

function main() {
  const checker = require('license-checker-rseidelsohn');

  checker.init(
    {
      start: REPO_ROOT,
      production: true,
      excludePrivatePackages: true,
      excludePackages: 'eudistack-core-wallet-pwa',
    },
    (err, packages) => {
      // R-6: the inspector MUST NOT break the build — degrade to an empty,
      // still-valid manifest (ES-03 handles this on the UI side).
      if (err) {
        console.warn('[oss-licenses] degraded (license-checker error):', err.message);
        writeManifest({ generatedAt: new Date().toISOString(), packages: [] });
        return;
      }
      const manifest = buildManifest(packages);
      writeManifest(manifest);
      console.log(`[oss-licenses] ${manifest.packages.length} production dependencies`);
    }
  );
}

// Only run as a side effect when invoked as a CLI script (`node scripts/generate-oss-licenses.js`),
// never when required as a module — the spec file imports the pure helpers below without
// triggering the async license-checker scan.
if (require.main === module) {
  try {
    main();
  } catch (e) {
    console.warn('[oss-licenses] degraded (unexpected failure):', e.message);
    try {
      writeManifest({ generatedAt: new Date().toISOString(), packages: [] });
    } catch (e2) {
      console.warn('[oss-licenses] could not write degraded fallback:', e2.message);
    }
  }
}

module.exports = { normalizeLicense, splitNameVersion, buildManifest };
