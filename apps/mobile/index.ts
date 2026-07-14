import { registerRootComponent } from 'expo';

import App from './App';

const isMetaMaskError = (value: unknown) => {
  const message = typeof value === 'string'
    ? value
    : value instanceof Error
      ? value.message
      : '';

  return /metamask/i.test(message);
};

if (typeof window !== 'undefined') {
  const originalOnError = window.onerror;

  window.onerror = (message, source, lineno, colno, error) => {
    if (isMetaMaskError(message) || isMetaMaskError(error)) {
      return true;
    }

    if (originalOnError) {
      return originalOnError(message, source, lineno, colno, error);
    }

    return false;
  };

  window.addEventListener('error', event => {
    if (isMetaMaskError(event.error ?? event.message)) {
      event.preventDefault();
    }
  });

  window.addEventListener('unhandledrejection', event => {
    if (isMetaMaskError(event.reason)) {
      event.preventDefault();
    }
  });
}

// registerRootComponent calls AppRegistry.registerComponent('main', () => App);
// It also ensures that whether you load the app in Expo Go or in a native build,
// the environment is set up appropriately
registerRootComponent(App);
