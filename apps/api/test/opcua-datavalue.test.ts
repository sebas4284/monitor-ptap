import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DataType, DataValue, StatusCodes, Variant, VariantArrayType } from 'node-opcua';
import { OpcUaConnectivityAdapter } from '../src/infrastructure/connectivity/adapters/opcua/opcua-connectivity.adapter';
import type { MonitorTarget } from '../src/infrastructure/connectivity/mapping/opc-mapping.loader';
import type { RawBufferSample } from '../src/infrastructure/connectivity/ports/connectivity-adapter.port';

// Exercise the production converter without constructing a session, timers or a PLC client.
const converter = Object.create(OpcUaConnectivityAdapter.prototype) as {
  toSample(
    target: Pick<MonitorTarget, 'browseName' | 'channel'>,
    value: DataValue,
  ): RawBufferSample;
};
const target: Pick<MonitorTarget, 'browseName' | 'channel'> = {
  browseName: 'REAL_IN_TEST',
  channel: 'realIn',
};
const convert = (value: DataValue) => converter.toSample(target, value);

test('DataValue: a numeric scalar preserves value, metadata and source/server timestamps', () => {
  const source = new Date('2026-11-10T13:00:00.000Z');
  const server = new Date('2026-11-10T13:00:00.050Z');
  assert.deepEqual(
    convert(
      new DataValue({
        value: new Variant({ dataType: DataType.Double, value: 12.5 }),
        statusCode: StatusCodes.Good,
        sourceTimestamp: source,
        serverTimestamp: server,
      }),
    ),
    {
      browseName: 'REAL_IN_TEST',
      channel: 'realIn',
      values: [12.5],
      quality: 'Good',
      statusCode: 'Good',
      sourceTimestamp: source.toISOString(),
      serverTimestamp: server.toISOString(),
    },
  );
});

test('DataValue: boolean scalars remain boolean, including false', () => {
  for (const value of [true, false]) {
    assert.deepEqual(
      convert(new DataValue({ value: new Variant({ dataType: DataType.Boolean, value }) })).values,
      [value],
    );
  }
});

test('DataValue: numeric and boolean arrays preserve every element', () => {
  const numbers = convert(
    new DataValue({
      value: new Variant({
        dataType: DataType.Double,
        arrayType: VariantArrayType.Array,
        value: [1.25, -2, 0],
      }),
    }),
  );
  assert.deepEqual(numbers.values, [1.25, -2, 0]);
  const booleans = convert(
    new DataValue({
      value: new Variant({
        dataType: DataType.Boolean,
        arrayType: VariantArrayType.Array,
        value: [false, true, false],
      }),
    }),
  );
  assert.deepEqual(booleans.values, [false, true, false]);
});

test('DataValue: typed arrays become ordinary arrays without changing their signed values', () => {
  const sample = convert(
    new DataValue({
      value: new Variant({
        dataType: DataType.Int16,
        arrayType: VariantArrayType.Array,
        value: new Int16Array([-32768, 0, 32767]),
      }),
    }),
  );
  assert.deepEqual(sample.values, [-32768, 0, 32767]);
  assert.ok(Array.isArray(sample.values));
});

test('DataValue: Bad and Uncertain quality are never promoted to Good', () => {
  for (const [statusCode, quality] of [
    [StatusCodes.BadNoCommunication, 'Bad'],
    [StatusCodes.UncertainLastUsableValue, 'Uncertain'],
  ] as const) {
    const sample = convert(
      new DataValue({
        value: new Variant({ dataType: DataType.Double, value: 6 }),
        statusCode,
      }),
    );
    assert.equal(sample.quality, quality);
    assert.equal(sample.statusCode, statusCode.name);
    assert.deepEqual(sample.values, [6]);
  }
});

test('DataValue: absent timestamps stay null rather than pretending the data is new', () => {
  const sample = convert(
    new DataValue({ value: new Variant({ dataType: DataType.Double, value: 0 }) }),
  );
  assert.equal(sample.sourceTimestamp, null);
  assert.equal(sample.serverTimestamp, null);
  assert.deepEqual(sample.values, [0]);
});

test('DataValue: missing value produces an empty array, never an invented zero', () => {
  assert.deepEqual(convert(new DataValue({ statusCode: StatusCodes.BadNoData })).values, []);
});

test('DataValue: non-finite values remain detectable by the downstream quality layer', () => {
  const sample = convert(
    new DataValue({
      value: new Variant({
        dataType: DataType.Double,
        arrayType: VariantArrayType.Array,
        value: [NaN, Infinity, -Infinity],
      }),
    }),
  );
  assert.ok(Number.isNaN(sample.values[0]));
  assert.deepEqual(sample.values.slice(1), [Infinity, -Infinity]);
});
