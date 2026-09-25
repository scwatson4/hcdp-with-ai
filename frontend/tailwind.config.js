/** @type {import('tailwindcss').Config} */
export default {
  darkMode: ['class'],
  content: ['./index.html', './src/**/*.{js,jsx,ts,tsx}'],
  theme: {
    container: {
      center: true,
      padding: '2rem',
      screens: { '2xl': '1400px' },
    },
    extend: {
      colors: {
        canvas: 'hsl(var(--canvas))',
        surface: 'hsl(var(--surface))',
        muted: {
          DEFAULT: 'hsl(var(--muted))',
          foreground: 'hsl(var(--muted-foreground))',
        },
        inset: 'hsl(var(--inset))',
        border: 'hsl(var(--border))',
        'border-strong': 'hsl(var(--border-strong))',
        ring: 'hsl(var(--ring))',
        foreground: 'hsl(var(--foreground))',
        subtle: 'hsl(var(--subtle-foreground))',
        accent: {
          DEFAULT: 'hsl(var(--accent))',
          foreground: 'hsl(var(--accent-foreground))',
          soft: 'hsl(var(--accent-soft))',
        },
        destructive: {
          DEFAULT: 'hsl(var(--destructive))',
          foreground: 'hsl(var(--destructive-foreground))',
        },
        success: 'hsl(var(--success))',
        warning: 'hsl(var(--warning))',
        card: {
          DEFAULT: 'hsl(var(--card))',
          foreground: 'hsl(var(--card-foreground))',
        },
        popover: {
          DEFAULT: 'hsl(var(--popover))',
          foreground: 'hsl(var(--popover-foreground))',
        },
        input: 'hsl(var(--input))',
        primary: {
          DEFAULT: 'hsl(var(--accent))',
          foreground: 'hsl(var(--accent-foreground))',
        },
        secondary: {
          DEFAULT: 'hsl(var(--muted))',
          foreground: 'hsl(var(--foreground))',
        },
        data: {
          1: 'hsl(var(--data-1))',
          2: 'hsl(var(--data-2))',
          3: 'hsl(var(--data-3))',
          4: 'hsl(var(--data-4))',
          5: 'hsl(var(--data-5))',
        },
        // Severity (My Agents). `<alpha-value>` lets `bg-sev-alert/10` tint.
        sev: {
          routine: 'hsl(var(--sev-routine) / <alpha-value>)',
          watch: 'hsl(var(--sev-watch) / <alpha-value>)',
          alert: 'hsl(var(--sev-alert) / <alpha-value>)',
        },
      },
      borderRadius: {
        lg: 'var(--radius)',
        md: 'calc(var(--radius) - 2px)',
        sm: 'calc(var(--radius) - 4px)',
      },
      fontFamily: {
        sans: ['Inter', '-apple-system', 'BlinkMacSystemFont', 'sans-serif'],
        // Newsreader, not Literata: Literata gives U+02BB (ʻokina) a zero
        // advance width, so "Hawaiʻi" renders as "Hawaiï". Not fixable in CSS.
        display: ['Newsreader', 'Georgia', 'serif'],
        mono: ['"JetBrains Mono"', '"Fira Code"', 'monospace'],
      },
      fontSize: {
        xs: ['0.75rem', { lineHeight: '1.1rem' }],
        sm: ['0.8125rem', { lineHeight: '1.2rem' }],
        base: ['0.9375rem', { lineHeight: '1.55rem' }],
        lg: ['1.0625rem', { lineHeight: '1.6rem' }],
        xl: ['1.25rem', { lineHeight: '1.75rem' }],
        '2xl': ['1.75rem', { lineHeight: '2.1rem' }],
        '3xl': ['2.25rem', { lineHeight: '2.6rem' }],
      },
      keyframes: {
        'accordion-down': {
          from: { height: '0' },
          to: { height: 'var(--radix-accordion-content-height)' },
        },
        'accordion-up': {
          from: { height: 'var(--radix-accordion-content-height)' },
          to: { height: '0' },
        },
        'fade-in': { from: { opacity: '0' }, to: { opacity: '1' } },
        'slide-up': {
          from: { opacity: '0', transform: 'translateY(6px)' },
          to: { opacity: '1', transform: 'translateY(0)' },
        },
      },
      animation: {
        'accordion-down': 'accordion-down 0.2s ease-out',
        'accordion-up': 'accordion-up 0.2s ease-out',
        'fade-in': 'fade-in 0.2s ease-out',
        'slide-up': 'slide-up 0.25s ease-out',
      },
    },
  },
  plugins: [require('tailwindcss-animate')],
}
