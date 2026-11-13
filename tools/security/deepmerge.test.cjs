const assert = require('node:assert/strict');
const { test } = require('node:test');
const { createRequire } = require('node:module');
const { mkdtempSync, writeFileSync, readFileSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const path = require('node:path');
const merge = require('deepmerge');

for (const side of ['target', 'source']) {
  test(`deepmerge omits dangerous own enumerable keys from ${side}`, () => {
    const dangerous = JSON.parse('{"__proto__":{"injected":true},"constructor":{"prototype":{"injected":true}},"prototype":{"injected":true},"safe":{"value":1}}');
    const other = Object.assign(Object.create(null), { safe: { extra: 2 } });
    const result = side === 'target' ? merge(dangerous, other) : merge(other, dangerous);
    assert.equal(Object.getPrototypeOf(result), Object.prototype);
    assert.equal(result.injected, undefined);
    for (const key of ['__proto__', 'constructor', 'prototype']) {
      assert.equal(Object.hasOwn(result, key), false, `must omit ${key}`);
    }
    assert.deepEqual(result.safe, { value: 1, extra: 2 });
    assert.equal({}.injected, undefined);
  });
}

test('deepmerge preserves enumerable symbols, array cloning and custom merge options', () => {
  const symbol = Symbol('safe');
  const left = { [symbol]: { a: 1 }, list: [{ a: 1 }] };
  const result = merge(left, { [symbol]: { b: 2 }, list: [{ b: 2 }] });
  assert.deepEqual(result[symbol], { a: 1, b: 2 });
  assert.deepEqual(result.list, [{ a: 1 }, { b: 2 }]);
  assert.notEqual(result.list[0], left.list[0]);
  assert.deepEqual(merge({ list: [1] }, { list: [2] }, { arrayMerge: (_target, source) => source }), { list: [2] });
  assert.deepEqual(merge({ n: { a: 1 } }, { n: { b: 2 } }, {
    customMerge: (key) => key === 'n' ? () => ({ custom: true }) : undefined,
  }), { n: { custom: true } });
  assert.deepEqual(merge.all([{ a: 1 }, { b: 2 }]), { a: 1, b: 2 });
});

test('Expo config resolves the local patch and merges a static app config without writing in dry run', async (t) => {
  const expoRequire = createRequire(require.resolve('@expo/config/package.json'));
  assert.equal(expoRequire.resolve('deepmerge'), require.resolve('deepmerge'));
  assert.equal(expoRequire('deepmerge/package.json').version, '4.3.1-ptap.1');
  const project = mkdtempSync(path.join(tmpdir(), 'ptap-deepmerge-config-'));
  t.after(() => {
    assert.ok(project.startsWith(path.join(tmpdir(), 'ptap-deepmerge-config-')));
    rmSync(project, { recursive: true, force: true });
  });
  writeFileSync(path.join(project, 'package.json'), JSON.stringify({ name: 'synthetic-config', version: '1.0.0' }));
  const original = JSON.stringify({ expo: { name: 'Synthetic', slug: 'synthetic', extra: { a: 1 }, updates: { requestHeaders: { a: '1' } } } });
  writeFileSync(path.join(project, 'app.json'), original);
  const result = await require('@expo/config').modifyConfigAsync(project, {
    extra: { b: 2 }, updates: { requestHeaders: { b: '2' } },
  }, { skipSDKVersionRequirement: true }, { dryRun: true });
  assert.equal(result.type, 'success');
  assert.deepEqual(result.config.extra, { a: 1, b: 2 });
  assert.deepEqual(result.config.updates.requestHeaders, { a: '1', b: '2' });
  assert.equal(readFileSync(path.join(project, 'app.json'), 'utf8'), original);
});
