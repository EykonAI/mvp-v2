/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './app/**/*.{js,ts,jsx,tsx,mdx}',
    './components/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        eykon: {
          'bg-void':   '#05080F',
          'bg-navy':   '#0A1220',
          'bg-panel':  '#0F182A',
          'bg-raised': '#15203A',
          'bg-hover':  '#1A2846',
          rule:        '#1E2C49',
          'rule-soft': '#15203A',
          'rule-strong':'#2B3A5C',
          ink:         '#E8EDF5',
          'ink-dim':   '#98A3B5',
          'ink-faint': '#5A6478',
          'ink-ghost': '#3A4256',
          teal:        '#19D0B8',
          'teal-dim':  '#0E9A88',
          'teal-deep': '#0A5E54',
          amber:       '#D4A24C',
          red:         '#E05D50',
          green:       '#4ABF8A',
          violet:      '#8B7FD8',
          coral:       '#DE7F70',
          wheat:       '#D4A24C',
        },
      },
      fontFamily: {
        display: ['Jura', 'sans-serif'],
        sans:    ['IBM Plex Sans', 'system-ui', 'sans-serif'],
        mono:    ['IBM Plex Mono', 'monospace'],
      },
      fontSize: {
        'eyebrow': ['9.5px', { lineHeight: '1.2', letterSpacing: '0.22em' }],
        'panel':   ['10px',  { lineHeight: '1.2', letterSpacing: '0.22em' }],
      },
      keyframes: {
        pulse: {
          '0%, 100%': { opacity: '1' },
          '50%':      { opacity: '0.35' },
        },
        pulseRing: {
          '0%':   { opacity: '0.3' },
          '50%':  { opacity: '1' },
          '100%': { opacity: '0.3' },
        },
      },
      animation: {
        'eykon-pulse':      'pulse 2s infinite',
        'eykon-pulse-ring': 'pulseRing 2.6s infinite',
      },
    },
  },
  plugins: [],
};
