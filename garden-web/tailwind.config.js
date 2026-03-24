/** @type {import('tailwindcss').Config} */
module.exports = {
  darkMode: 'class',
  content: [
    './app/**/*.{js,ts,jsx,tsx}',
  ],
  theme: {
    extend: {
      keyframes: {
        'slide-up': {
          '0%': { transform: 'translateY(100%)' },
          '100%': { transform: 'translateY(0)' },
        },
      },
      animation: {
        'slide-up': 'slide-up 0.3s ease-out',
      },
      colors: {
        gray: {
          750: '#2a3040',
        },
        earth: {
          50: '#fdf8f0',
          100: '#f5ead4',
          200: '#ebdbb2',
          300: '#d4b896',
          400: '#b8956a',
          500: '#9c7a50',
          600: '#7d5f3a',
          700: '#5e4528',
          800: '#3f2d1a',
          900: '#2a1e10',
        },
        garden: {
          50: '#f0fdf4',
          100: '#dcfce7',
          200: '#bbf7d0',
          300: '#86efac',
          400: '#4ade80',
          500: '#22c55e',
          600: '#16a34a',
          700: '#15803d',
          800: '#166534',
          900: '#14532d',
        },
      },
    },
  },
  plugins: [],
};
