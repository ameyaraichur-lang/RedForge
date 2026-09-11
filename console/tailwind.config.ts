import type { Config } from 'tailwindcss';

const config: Config = {
  content: [
    './app/**/*.{ts,tsx}',
    './components/**/*.{ts,tsx}',
    './lib/**/*.{ts,tsx}',
  ],
  theme: {
    extend: {
      colors: {
        ink: { DEFAULT: '#0a0e14', 2: '#0d1420' },
        panel: '#111823',
        line: '#94a3b826', // ~15% alpha slate
        'line-2': '#94a3b84d', // ~30% alpha slate
        acc: '#22d3ee',
        warn: '#fbbf24',
        crit: '#f87171',
        ok: '#34d399',
        mut: '#94a3b8',
        dim: '#64748b',
      },
      fontFamily: {
        sans: [
          'Inter',
          'ui-sans-serif',
          'system-ui',
          '-apple-system',
          'Segoe UI',
          'Roboto',
          'Helvetica Neue',
          'Arial',
          'sans-serif',
        ],
        mono: [
          'ui-monospace',
          'Cascadia Code',
          'SF Mono',
          'Menlo',
          'Consolas',
          'Liberation Mono',
          'monospace',
        ],
      },
      boxShadow: {
        glow: '0 0 24px rgba(34, 211, 238, 0.14)',
        'glow-warn': '0 0 24px rgba(251, 191, 36, 0.16)',
        'glow-crit': '0 0 24px rgba(248, 113, 113, 0.18)',
      },
      animation: {
        'pulse-dot': 'pulseDot 1.6s ease-in-out infinite',
        'edge-flow': 'edgeFlow 1s linear infinite',
        blink: 'blink 0.9s steps(2, start) infinite',
      },
      keyframes: {
        pulseDot: {
          '0%, 100%': { opacity: '1' },
          '50%': { opacity: '0.35' },
        },
        edgeFlow: {
          to: { strokeDashoffset: '-12' },
        },
        blink: {
          '50%': { opacity: '0.25' },
        },
      },
    },
  },
  plugins: [],
};

export default config;
