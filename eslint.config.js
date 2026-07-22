const expoConfig = require('eslint-config-expo/flat');
const prettierConfig = require('eslint-config-prettier');

module.exports = [
  ...expoConfig,
  prettierConfig,
  {
    // expo/no-dynamic-env-var existe porque Expo INLINEA las EXPO_PUBLIC_* en build (un acceso
    // dinámico allí devuelve undefined en runtime). El backend es Node puro: process.env[name]
    // es legítimo y sus helpers de config lo usan a propósito. Solo se apaga para el API.
    files: ['apps/api/**/*.ts'],
    rules: { 'expo/no-dynamic-env-var': 'off' },
  },
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/.expo/**',
      '**/coverage/**',
    ],
  },
];
