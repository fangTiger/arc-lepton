import type { Config } from 'tailwindcss'

const config: Config = {
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}', './hooks/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        bg: { base: '#0A0B10', surface: '#14161D', elevated: '#1C1F28', inset: '#060709' },
        arc: { DEFAULT: '#4D7EFF', hover: '#6B92FF' },
        text: { primary: '#F4F5F8', secondary: '#A1A6B3', muted: '#6B7280', disabled: '#4B5563' },
        success: '#10B981',
        danger: '#F75A5A',
        warning: '#F5A623',
        live: '#00D9FF',
      },
      borderRadius: { xs: '6px', sm: '10px', md: '14px', lg: '20px' },
      fontFamily: { sans: ['Geist', 'sans-serif'], mono: ['Geist Mono', 'monospace'] },
      boxShadow: {
        'arc-glow': '0 0 32px rgba(77,126,255,0.40)',
        'live-glow': '0 0 12px rgba(0,217,255,0.50)',
      },
    },
  },
  plugins: [],
}

export default config
