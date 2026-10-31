import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createContext, runInContext } from 'node:vm';
import path from 'node:path';
import { CANAL_AVISOS } from '@ptap/shared';

function config(settings: unknown, env: Record<string, string> = { GOOGLE_SERVICES_JSON: '/synthetic/google-services.json' }) {
  const module = { exports: undefined as any };
  const context = createContext({ module, __dirname: '/synthetic/mobile', process: { env },
    require: (name: string) => name === 'path' ? path : name === 'fs' ? {
      existsSync: () => settings !== undefined,
      readFileSync: () => Buffer.from(JSON.stringify(settings)),
    } : (() => { throw new Error(`Unexpected import ${name}`); })() });
  runInContext(readFileSync(new URL('../app.config.js', import.meta.url), 'utf8'), context);
  return module.exports({ config: { android: { package: 'com.ptap.monitor' }, plugins: [] } });
}

const androidConfig = {
  project_info: { project_id: 'synthetic-project', project_number: '123456789' },
  client: [{ client_info: { mobilesdk_app_id: 'synthetic-app', android_client_info: { package_name: 'com.ptap.monitor' } },
    api_key: [{ current_key: 'synthetic-public-android-key' }] }],
};

test('push-required Android build refuses missing configuration instead of silently creating a pushless APK', () => {
  assert.throws(() => config(undefined, { PTAP_REQUIRE_FCM: '1' }), /Falta google-services/);
  assert.throws(() => config(undefined), /Falta google-services/);
  assert.equal(config(undefined, {}).android.googleServicesFile, undefined, 'web/development without FCM remains supported');
});

test('Android configuration cannot embed backend credentials or use another package', () => {
  assert.throws(() => config({ type: 'service_account', private_key: 'synthetic-never-real' }), /cuenta de servicio/);
  assert.throws(() => config({ ...androidConfig, private_key: 'synthetic-never-real' }), /cuenta de servicio/);
  assert.throws(() => config({ ...androidConfig, client: [{ ...androidConfig.client[0],
    client_info: { ...androidConfig.client[0].client_info, android_client_info: { package_name: 'another.package' } } }] }), /paquete Android/);
});

test('matching public Firebase configuration is included with shared FCM default channel and Expo58 compile SDK', () => {
  const result = config(androidConfig);
  assert.ok(result.android.googleServicesFile.endsWith('google-services.json'));
  assert.equal(result.plugins.find((plugin: any) => plugin[0] === 'expo-notifications')[1].defaultChannel, CANAL_AVISOS);
  assert.equal(result.plugins.find((plugin: any) => plugin[0] === 'expo-build-properties')[1].android.compileSdkVersion, 37);
});
