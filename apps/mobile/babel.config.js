module.exports = function (api) {
  const web = api.caller(caller => caller?.platform === 'web');
  return {
    presets: ['babel-preset-expo'],
    plugins: web ? [require.resolve('../../tools/web/babel-native-members.cjs')] : [],
  };
};
