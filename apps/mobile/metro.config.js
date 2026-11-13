const path = require('path');
const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

config.resolver.unstable_enablePackageExports = true;
config.resolver.unstable_enablePackageImports = true;
config.watchFolders = [path.resolve(__dirname, '..', '..', 'packages', 'shared')];

const getTransformOptions = config.transformer.getTransformOptions;
config.transformer.getTransformOptions = async (...args) => {
  const defaults = await getTransformOptions(...args);
  return {
    ...defaults,
    transform: {
      ...defaults.transform,
      inlineRequires:
        args[1].platform === 'web' && !args[1].dev ? true : defaults.transform.inlineRequires,
    },
  };
};

module.exports = config;
