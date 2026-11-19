'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { seal, inspect, parseValues, parseDump, compare } = require('./ptap-ledger-review.cjs');
const row = (id = 1) => ({ id, at: '2026-10-30T12:00:00.000Z', plant_id: 'synthetic', target: 'v1', command: 'abrir', status: 'confirmed', user_id: null, user_name: null, user_email: null, role: null, written_value: '1', confirmed_value: null, signature: null, prev_signature: null });
test('quoted dump data is decoded without evaluating SQL', () => {
  assert.deepEqual(parseValues("(1,'a\\\'b','a''b',NULL,'x\\n\\0\\\\');"), [[1, "a'b", "a'b", null, 'x\n\0\\']]);
  for (const text of ['(SLEEP(1));', "(1); DROP TABLE command_log;", '(9007199254740993);', "('x\\q');"]) assert.throws(() => parseValues(text));
});
test('dump schema and rows must match, empty table is distinct from missing schema', () => {
  const columns = Object.keys(row());
  const schema = 'CREATE TABLE `command_log` (\n' + columns.map(c => '  `' + c + '` text').join(',\n') + '\n) ENGINE=InnoDB;';
  assert.deepEqual(parseDump(schema), []);
  assert.throws(() => parseDump(''));
  assert.throws(() => parseDump(schema + '\nINSERT INTO `command_log` VALUES (1);'));
  assert.throws(() => parseDump(schema + '\nINSERT INTO `command_log` VALUES (SLEEP(1));'));
});
test('link order follows completion rather than IDs, and unsigned history blocks acceptance', () => {
  const first = row(2); first.signature = seal(first, 'synthetic-secret');
  const last = row(1); last.prev_signature = first.signature; last.signature = seal(last, 'synthetic-secret');
  const good = inspect([last, first], 'synthetic-secret');
  assert.equal(good.invalidHmac, 0); assert.equal(good.brokenLinks, 0); assert.equal(good.tip, last.signature); assert.equal(good.eligibleForBaseline, true);
  assert.equal(inspect([last, first, row(3)], 'synthetic-secret').eligibleForBaseline, false);
  assert.equal(inspect([last], 'synthetic-secret').brokenLinks, 1);
  assert.equal(inspect([{ ...first, status: 'failed' }], 'synthetic-secret').invalidHmac, 1);
  assert.equal(inspect([first], 'wrong').invalidHmac, 1);
});
test('backup comparison reports mutations and missing historical rows', () => {
  assert.deepEqual(compare([row(1), row(3)], [row(1), row(2)]), { same: 1, changed: 0, absentFromLive: 1, absentFromBackup: 1 });
  assert.equal(compare([row()], [{ ...row(), target: 'v2' }]).changed, 1);
});
