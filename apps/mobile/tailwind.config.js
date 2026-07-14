/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './app/**/*.{js,jsx,ts,tsx}',
    './components/**/*.{js,jsx,ts,tsx}',
  ],
  presets: [require('nativewind/preset')],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        primary: '#1565C0',
        accent: '#2196F3',
        success: '#4CAF50',
        danger: '#F44336',
        warning: '#FF9800',
        surface: '#F5F7FA',
      },
    },
  },
  plugins: [],
};
