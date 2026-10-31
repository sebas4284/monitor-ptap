#!/usr/bin/env node
'use strict';
// Read-only. Does not install SDKs, run Gradle/prebuild, sign, publish, or contact Firebase.
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { createRequire } = require('node:module');

function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch { throw new Error('JSON no disponible o inválido; no se muestra su contenido.'); }
}

function firebaseMatches(config, packageName, expectedProject) {
  if (!expectedProject) throw new Error('Falta PTAP_FIREBASE_PROJECT_ID confirmado por el responsable de Firebase/backend.');
  if (config?.project_info?.project_id !== expectedProject || !/^\d+$/.test(String(config?.project_info?.project_number || ''))) {
    throw new Error('La configuración Firebase no coincide con el proyecto esperado.');
  }
  const clients = config.client?.filter(client => client?.client_info?.android_client_info?.package_name === packageName) || [];
  if (clients.length !== 1 || !clients[0].client_info.mobilesdk_app_id || !clients[0].api_key?.some(key => key.current_key)) {
    throw new Error('Se requiere exactamente un cliente Firebase Android válido para el package de esta aplicación.');
  }
}

function signer(output) {
  const matches = [...output.matchAll(/^Signer #\d+ certificate SHA-256 digest: ([a-f0-9]{64})$/gmi)].map(match => match[1].toLowerCase());
  if (matches.length !== 1) throw new Error('No se pudo verificar exactamente un certificado firmante SHA256.');
  return matches[0];
}

function main() {
  if (process.platform !== 'linux') throw new Error('Ejecutar en la VM Linux de compilación.');
  if (process.argv.length > 3) throw new Error('Uso: node tools/vm/ptap-android-release-preflight.cjs [APK-candidata]');
  const repo = process.cwd();
  const mobile = path.join(repo, 'apps/mobile');
  const sdk = process.env.ANDROID_HOME || '/home/xpertic_app/android-build/sdk';
  const jdk = process.env.JAVA_HOME || '/home/xpertic_app/android-build/jdk';
  const app = readJson(path.join(mobile, 'app.json')).expo;
  const requireLocal = createRequire(path.join(repo, 'package.json'));
  const nativeCatalog = fs.readFileSync(path.join(path.dirname(requireLocal.resolve('react-native/package.json')), 'gradle/libs.versions.toml'), 'utf8');
  const catalog = key => {
    const value = nativeCatalog.match(new RegExp(`^${key} = "([^"\\n]+)"`, 'm'))?.[1];
    if (!value) throw new Error(`Requisito Android ausente: ${key}`);
    return value;
  };
  const failures = [];
  const check = (label, action) => {
    try { action(); console.log(`OK ${label}`); }
    catch (error) { failures.push(label); console.log(`FALTA ${label}: ${error.message}`); }
  };
  const assert = (condition, message) => { if (!condition) throw new Error(message); };
  const run = (executable, args) => {
    const result = spawnSync(executable, args, { encoding: 'utf8', timeout: 30000, maxBuffer: 1024 * 1024,
      env: { ...process.env, JAVA_HOME: jdk, PATH: `${jdk}/bin:${process.env.PATH || ''}` } });
    if (result.error || result.status !== 0) throw new Error('Herramienta ausente, fallida o agotó su plazo; no se muestra su salida.');
    return `${result.stdout || ''}\n${result.stderr || ''}`;
  };
  console.log(`Expo ${requireLocal('expo/package.json').version}; RN ${requireLocal('react-native/package.json').version}; objetivo ${app.version}/${app.android.versionCode}`);
  console.log(`Requisitos instalados RN: compileSDK ${catalog('compileSdk')}, build-tools ${catalog('buildTools')}, NDK ${catalog('ndkVersion')}, AGP ${catalog('agp')}`);
  check('Firebase Android/proyecto/cliente de aplicación', () => {
    const file = process.env.GOOGLE_SERVICES_JSON ? path.resolve(process.env.GOOGLE_SERVICES_JSON) : path.join(mobile, 'google-services.json');
    const stat = fs.lstatSync(file);
    assert(stat.isFile() && stat.size < 1024 * 1024, 'Se requiere google-services.json regular y acotado.');
    const relative = path.relative(repo, file);
    if (relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative)) {
      assert(spawnSync('git', ['check-ignore', '--quiet', '--', file], { cwd: repo }).status === 0, 'Firebase dentro del repositorio debe estar ignorado por git.');
    }
    firebaseMatches(readJson(file), app.android.package, process.env.PTAP_FIREBASE_PROJECT_ID);
  });
  check('JDK17 validado', () => assert(/version "17\./.test(run(path.join(jdk, 'bin/java'), ['-version'])), 'Se requiere el JDK17 evaluado para este build.'));
  check('Configuración compileSDK', () => {
    const config = fs.readFileSync(path.join(mobile, 'app.config.js'), 'utf8');
    const override = config.match(/compileSdkVersion\s*:\s*(\d+)/)?.[1];
    assert(!override || Number(override) >= Number(catalog('compileSdk')), 'app.config.js impone un compileSDK inferior al de RN instalado.');
  });
  for (const [label, location] of [
    ['SDK build-tools', `build-tools/${catalog('buildTools')}/aapt2`],
    ['NDK', `ndk/${catalog('ndkVersion')}/source.properties`],
  ]) check(label, () => assert(fs.existsSync(path.join(sdk, location)), `No está instalado ${location}.`));
  check('SDK plataforma', () => {
    const major = catalog('compileSdk');
    const platform = [`android-${major}`, `android-${major}.0`].map(name => path.join(sdk, 'platforms', name)).find(file => fs.existsSync(path.join(file, 'android.jar')));
    assert(platform, `No está instalada la plataforma Android ${major}.0.`);
    const properties = fs.readFileSync(path.join(platform, 'source.properties'), 'utf8');
    assert(new RegExp(`^AndroidVersion.ApiLevel=${major}(?:\\.0)?$`, 'm').test(properties.replace(/\r/g, '')), 'API de la plataforma instalada no coincide.');
  });
  check('Gradle compatible con AGP9.2', () => {
    assert(catalog('agp') === '9.2.1', 'Nueva versión AGP: revisar documentación exacta antes de compilar.');
    const wrapper = fs.readFileSync(path.join(mobile, 'android/gradle/wrapper/gradle-wrapper.properties'), 'utf8');
    const version = wrapper.match(/gradle-(\d+)\.(\d+)\.(\d+)-(?:bin|all)\.zip/)?.slice(1).map(Number);
    assert(version && version[0] === 9 && (version[1] > 4 || (version[1] === 4 && version[2] >= 1)), 'AGP9.2 requiere Gradle>=9.4.1; revisar wrapper generado y checksum oficial.');
    assert(/^distributionSha256Sum=[a-f0-9]{64}$/mi.test(wrapper), 'Falta distributionSha256Sum oficial en wrapper.');
  });
  check('Proyecto nativo regenerado con versión y Firebase', () => {
    const gradle = fs.readFileSync(path.join(mobile, 'android/app/build.gradle'), 'utf8');
    assert(Number(gradle.match(/versionCode\s+(\d+)/)?.[1]) === app.android.versionCode, 'versionCode nativo obsoleto.');
    assert(gradle.match(/versionName\s+"([^"]+)"/)?.[1] === app.version, 'versionName nativo obsoleto.');
    assert(gradle.includes('com.google.gms.google-services'), 'Falta plugin Google Services en el proyecto nativo.');
    const google = readJson(path.join(mobile, 'android/app/google-services.json'));
    firebaseMatches(google, app.android.package, process.env.PTAP_FIREBASE_PROJECT_ID);
  });
  const candidate = process.argv[2];
  if (candidate) check('APK candidata compatible y versión nueva', () => {
    const tools = path.join(sdk, 'build-tools', catalog('buildTools'));
    const published = '/var/www/ptap-download/monitor-ptap.apk';
    const oldSigner = signer(run(path.join(tools, 'apksigner'), ['verify', '--print-certs', published]));
    assert(signer(run(path.join(tools, 'apksigner'), ['verify', '--print-certs', candidate])) === oldSigner, 'Firma distinta del APK publicado: se rechaza actualización.');
    const describe = file => {
      const result = run(path.join(tools, 'aapt2'), ['dump', 'badging', file]).match(/^package: name='([^']+)' versionCode='(\d+)' versionName='([^']+)'/m);
      assert(result, 'Metadatos APK ausentes.');
      return { packageName: result[1], code: Number(result[2]), version: result[3] };
    };
    const old = describe(published), next = describe(candidate);
    assert(old.packageName === next.packageName && next.packageName === app.android.package, 'Package incompatible.');
    assert(next.code > old.code && next.code === app.android.versionCode && next.version === app.version, 'Versión APK no corresponde al árbol o no supera la publicada.');
    console.log(`Firma compatible SHA256 ${oldSigner}; candidata ${next.version}/${next.code}`);
  });
  console.log(candidate ? 'No se publicó ni instaló la APK.' : 'Sin APK candidata: la entrega y la compatibilidad de firma aún no están verificadas.');
  if (failures.length) process.exitCode = 1;
}

module.exports = { firebaseMatches, signer, readJson };
if (require.main === module) { try { main(); } catch (error) { console.error(error.message); process.exitCode = 1; } }
