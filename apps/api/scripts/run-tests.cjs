const { readdirSync } = require('node:fs');
const { join, resolve } = require('node:path');
const { spawnSync } = require('node:child_process');

const root = resolve(__dirname, '..');

function testArguments(requested = []) {
  const files = requested.length
    ? requested
    : readdirSync(join(root, 'test'))
        .filter((name) => /\.test\.(ts|cjs)$/.test(name))
        .sort()
        .map((name) => join('test', name));
  return ['--import', 'tsx', '--test', '--test-concurrency=2', ...files];
}

module.exports = { testArguments };

if (require.main === module) {
  const result = spawnSync(process.execPath, testArguments(process.argv.slice(2)), {
    cwd: root,
    env: { ...process.env, TSX_TSCONFIG_PATH: join(root, 'tsconfig.test.json') },
    stdio: 'inherit',
  });
  if (result.error) console.error(result.error.message);
  process.exit(result.status ?? 1);
}
