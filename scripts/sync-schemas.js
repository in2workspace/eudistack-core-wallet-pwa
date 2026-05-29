const fs = require('fs');
const path = require('path');

const src = process.env.SCHEMAS_SRC
  ? path.resolve(process.env.SCHEMAS_SRC)
  : path.resolve(__dirname, '../../eudistack-platform-dev/dev-tools/schemas');
const dst = path.resolve(__dirname, '../src/assets/schemas');

if (!fs.existsSync(src)) {
  console.error(`ERROR: canonical schemas not found at ${src}`);
  console.error('Clone eudistack-platform-dev as a sibling directory, or in CI add a checkout step with path: ../eudistack-platform-dev');
  process.exit(1);
}

fs.mkdirSync(dst, { recursive: true });

const files = fs
  .readdirSync(src)
  .filter((f) => f.endsWith('.json') && fs.statSync(path.join(src, f)).isFile());

if (files.length === 0) {
  console.error(`ERROR: no .json schemas found in ${src}`);
  process.exit(1);
}

files.forEach((f) => fs.copyFileSync(path.join(src, f), path.join(dst, f)));
console.log(`Schemas synced from platform-dev (${files.length} files)`);
