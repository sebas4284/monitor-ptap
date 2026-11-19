#!/usr/bin/env node
'use strict';
// Read-only SDK fallback when REA's optional JADX provider is unavailable. No build/APK execution.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const DEXDUMP = '/home/xpertic_app/android-build/sdk/build-tools/37.0.0/dexdump';
const TARGETS = ['androidx.work.impl.WorkDatabase_Impl', 'androidx.work.OverwritingInputMerger', 'androidx.work.ArrayCreatingInputMerger'];
const attribute = (text, name) => text.match(new RegExp(`\\b${name}="([^"]*)"`))?.[1];

function inspectConstructors(xml) {
  const found = new Map(TARGETS.map(name => [name, []]));
  for (const packageBlock of xml.matchAll(/<package\b([^>]*)>([\s\S]*?)<\/package>/g)) {
    const packageName = attribute(packageBlock[1], 'name');
    for (const classBlock of packageBlock[2].matchAll(/<class\b([^>]*)>([\s\S]*?)<\/class>/g)) {
      const className = `${packageName}.${attribute(classBlock[1], 'name')}`;
      if (!found.has(className)) continue;
      const constructors = [...classBlock[2].matchAll(/<constructor\b([^>]*)>([\s\S]*?)<\/constructor>/g)];
      const noArg = constructors.filter(item => attribute(item[1], 'visibility') === 'public' &&
        attribute(item[1], 'static') === 'false' && !/<parameter\b/.test(item[2]));
      found.get(className).push({ classPublic: attribute(classBlock[1], 'visibility') === 'public',
        constructorCount: constructors.length, publicNoArgCount: noArg.length });
    }
  }
  return TARGETS.map(className => {
    const declarations = found.get(className);
    const declaration = declarations[0];
    return { className, declarations: declarations.length, present: declarations.length === 1,
      constructorCount: declaration?.constructorCount || 0, publicNoArgCount: declaration?.publicNoArgCount || 0,
      retainedPublicNoArg: declarations.length === 1 && declaration.classPublic && declaration.publicNoArgCount === 1 };
  });
}

function main(apk) {
  if (process.platform !== 'linux' || process.getuid() === 0) throw new Error('Use ordinary Linux user');
  apk = path.resolve(apk);
  if (fs.realpathSync(apk) !== apk) throw new Error('APK symlink rejected');
  const stat = fs.statSync(apk);
  if (!stat.isFile() || stat.size === 0 || stat.size > 256 * 1024 * 1024) throw new Error('APK size invalid');
  const bytes = fs.readFileSync(apk);
  const sha256 = crypto.createHash('sha256').update(bytes).digest('hex');
  const result = spawnSync(DEXDUMP, ['-l', 'xml', apk], { timeout: 45000, maxBuffer: 128 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, LC_ALL: 'C' } });
  if (result.error || result.status !== 0) throw new Error('SDK DEX inspection incomplete');
  const classes = inspectConstructors(result.stdout.toString('utf8'));
  const after = fs.statSync(apk);
  if (after.ino !== stat.ino || after.size !== stat.size || after.mtimeMs !== stat.mtimeMs) throw new Error('APK changed');
  const passed = classes.every(item => item.retainedPublicNoArg);
  console.log(JSON.stringify({ inspectionSucceeded: true, sha256, sizeBytes: bytes.length, classes, passed }));
  if (!passed) process.exitCode = 1;
}

module.exports = { inspectConstructors };
if (require.main === module) {
  try { if (process.argv.length !== 3) throw new Error('One APK required'); main(process.argv[2]); }
  catch { console.log(JSON.stringify({ inspectionSucceeded: false, passed: false })); process.exitCode = 1; }
}
