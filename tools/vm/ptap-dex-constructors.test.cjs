'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { inspectConstructors } = require('./ptap-dex-constructors.cjs');
const constructor = (parameters = '', visibility = 'public') => `<constructor name="fixture" static="false" visibility="${visibility}">${parameters}</constructor>`;
const fixture = (work = '', overwriting = '', array = '') => `<api>
<package name="androidx.work.impl"><class name="WorkDatabase_Impl" visibility="public">${work}</class></package>
<package name="androidx.work"><class name="OverwritingInputMerger" visibility="public">${overwriting}</class><class name="ArrayCreatingInputMerger" visibility="public">${array}</class></package>
</api>`;

test('DEX regression rejects shipped shape with existing classes but no constructors', () => {
  const result = inspectConstructors(fixture());
  assert.ok(result.every(item => item.present));
  assert.ok(result.every(item => item.constructorCount === 0 && !item.retainedPublicNoArg));
});

test('DEX regression requires exactly one public noarg constructor in each exact package', () => {
  assert.ok(inspectConstructors(fixture(constructor(), constructor(), constructor())).every(item => item.retainedPublicNoArg));
  assert.equal(inspectConstructors(fixture(constructor('<parameter name="arg0" type="int"></parameter>'), constructor(), constructor()))[0].retainedPublicNoArg, false);
  assert.equal(inspectConstructors(fixture(constructor('', 'private'), constructor(), constructor()))[0].retainedPublicNoArg, false);
  const duplicate = `${fixture(constructor(), constructor(), constructor())}<package name="androidx.work"><class name="OverwritingInputMerger" visibility="public">${constructor()}</class></package>`;
  assert.equal(inspectConstructors(duplicate)[1].retainedPublicNoArg, false);
  assert.ok(inspectConstructors(fixture(constructor(), constructor(), constructor()).replace('name="androidx.work.impl"', 'name="wrong.package"'))[0].present === false);
});
