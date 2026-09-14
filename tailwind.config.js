/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        ink: '#1C1917',
        'ink-soft': '#57534E',
        'ink-faint': '#A8A29E',
        paper: '#FAFAF9',
        'paper-sunk': '#F2F1EF',
        rule: '#D6D3D1',
        owed: '#B45309',
        settled: '#3F6212',
        accent: '#7C2D12',
        'accent-soft': '#FDF4EC',
      },
      fontFamily: {
        sans: ['"IBM Plex Sans Thai"', 'system-ui', '-apple-system', 'sans-serif'],
      },
      fontSize: {
        '2xs': ['0.6875rem', { lineHeight: '1rem' }],
      },
      spacing: {
        touch: '2.75rem',
      },
    },
  },
  plugins: [],
};
