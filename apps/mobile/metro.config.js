const path = require('path');
const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

config.resolver.unstable_enablePackageExports = true;
config.resolver.unstable_enablePackageImports = true;
config.watchFolders = [path.resolve(__dirname, '..', '..', 'packages', 'shared')];

module.exports = config;
