import type { Config } from 'tailwindcss'

const config: Config = {
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}', './hooks/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        bg: { base: '#000000', panel: '#0A0A0A', cell: '#111111', hover: '#1A1A1A' },
        border: { DEFAULT: '#2A2A2A', active: '#FFB000' },
        text: { primary: '#E5E5E5', secondary: '#888888', muted: '#555555', disabled: '#333333' },
        amber: { DEFAULT: '#FFB000', dim: '#806000' },
        green: '#00FF7F',
        red: '#FF3838',
        yellow: '#FFEE00',
        cyan: '#00D9FF',
        live: '#00D9FF',
      },
      borderRadius: {
        none: '0',
        DEFAULT: '0',
        xs: '0',
        sm: '0',
        md: '0',
        lg: '0',
        xl: '0',
        '2xl': '0',
        full: '9999px',
      },
      fontFamily: {
        sans: ['Geist Mono', 'IBM Plex Mono', 'SF Mono', 'Menlo', 'monospace'],
        mono: ['Geist Mono', 'IBM Plex Mono', 'SF Mono', 'Menlo', 'monospace'],
      },
    },
  },
  plugins: [],
}

export default config
