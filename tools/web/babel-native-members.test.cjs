const { test } = require('node:test');
const assert = require('node:assert/strict');
const { transformSync } = require('@babel/core');
const { runInNewContext } = require('node:vm');
const plugin = require('./babel-native-members.cjs');
const helper = `function native() { const data = require('react-native'); native = function () { return data; }; return data; }`;
function transform(source) {
  return transformSync(source, { configFile: false, babelrc: false, plugins: [plugin] }).code;
}
test('lazy native imports preserve values and avoid loading unrelated web components', () => {
  const code = transform(
    helper + `exports.read = () => native().Platform; exports.view = () => native().View;`,
  );
  assert.doesNotMatch(code, /require\(['"]react-native['"]\)/);
  const loads = [];
  const platform = { OS: 'web' };
  const context = {
    exports: {},
    require(name) {
      loads.push(name);
      return { default: name.endsWith('/Platform') ? platform : 'view' };
    },
  };
  runInNewContext(code, context);
  assert.equal(loads.length, 0);
  assert.equal(context.exports.read(), platform);
  assert.deepEqual(loads, ['react-native-web/dist/exports/Platform']);
  assert.equal(context.exports.view(), 'view');
});
test('web platform reads become static without rewriting assignments or other members', () => {
  const code = transform(
    helper + 'exports.os = native().Platform.OS; exports.value = native().Platform.Version;',
  );
  assert.match(code, /exports.os = "web"/);
  assert.match(code, /native\(\).Platform.Version/);
  assert.match(transform(helper + 'native().Platform.OS = "other";'), /Platform.OS = "other"/);
});

test('unknown, dynamic, escaped or mutated namespaces retain the original import', () => {
  for (const usage of [
    'native()[key]',
    'native().Unknown',
    'consume(native())',
    'native().View = other',
    'delete native().View',
    'native = other; native().View',
  ]) {
    assert.match(transform(helper + usage), /require\(['"]react-native['"]\)/, usage);
  }
  assert.match(
    transform(helper.replace('return data; }', 'log(); return data; }') + 'native().View'),
    /require\(['"]react-native['"]\)/,
  );
});
