/** @type {import('tailwindcss').Config} */

// rgb(var(--sc-*) / <alpha-value>) lets Tailwind opacity modifiers
// (bg-primary/10 etc.) work against the CSS-variable palette defined
// in globals.css. The --sc-* triplets are the eYKON brand tokens.
const sc = (name) => `rgb(var(--sc-${name}) / <alpha-value>)`;

module.exports = {
  darkMode: 'class',
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
        // shadcn/ui semantic tokens (components/ui/*)
        background: sc('background'),
        foreground: sc('foreground'),
        card: { DEFAULT: sc('card'), foreground: sc('card-foreground') },
        popover: { DEFAULT: sc('popover'), foreground: sc('popover-foreground') },
        primary: { DEFAULT: sc('primary'), foreground: sc('primary-foreground') },
        secondary: { DEFAULT: sc('secondary'), foreground: sc('secondary-foreground') },
        muted: { DEFAULT: sc('muted'), foreground: sc('muted-foreground') },
        accent: { DEFAULT: sc('accent'), foreground: sc('accent-foreground') },
        destructive: { DEFAULT: sc('destructive'), foreground: sc('destructive-foreground') },
        border: sc('border'),
        input: sc('input'),
        ring: sc('ring'),
        chart: {
          1: sc('chart-1'),
          2: sc('chart-2'),
          3: sc('chart-3'),
          4: sc('chart-4'),
          5: sc('chart-5'),
        },
        sidebar: {
          DEFAULT: sc('sidebar'),
          foreground: sc('sidebar-foreground'),
          primary: sc('sidebar-primary'),
          'primary-foreground': sc('sidebar-primary-foreground'),
          accent: sc('sidebar-accent'),
          'accent-foreground': sc('sidebar-accent-foreground'),
          border: sc('sidebar-border'),
          ring: sc('sidebar-ring'),
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
  plugins: [require('tailwindcss-animate')],
};
