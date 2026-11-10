import type { Config } from 'tailwindcss';
// Tokens do design system Domma Tecnologia (seção 19.0)
export default {
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        action: { DEFAULT: '#5B3FE6', hover: '#4A2FD4', soft: '#ECE8FF', ink: '#3A24B0' },
        ink: { DEFAULT: '#1A1033', soft: '#4B4466', mute: '#6E6887' },
        canvas: '#F6F4FF',
        line: '#E3DEF7',
        ok: { DEFAULT: '#0F8A5F', soft: '#E3F6EE' },
        warn: { DEFAULT: '#A35C00', soft: '#FFF3DC', line: '#F5C26B' },
        bad: { DEFAULT: '#C2283B', soft: '#FDECEE' },
      },
      fontFamily: {
        sans: ['Manrope', 'system-ui', '-apple-system', 'Segoe UI', 'Roboto', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace'],
      },
      borderRadius: { ctl: '10px', card: '16px' },
      boxShadow: { card: '0 1px 2px rgba(26,16,51,.04), 0 4px 16px rgba(26,16,51,.06)' },
    },
  },
  plugins: [],
} satisfies Config;
