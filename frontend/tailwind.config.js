// The HCDP portal's type (www.hawaii.edu/climate-data-portal: the OnePress
// theme on Bootstrap 4.0.0-alpha.6), read from its CSS and confirmed in
// Chromium (computed styles and the fonts actually painted), 2026-09-25:
//  - body text, headings and buttons: Bootstrap's native system stack, no
//    webfont (San Francisco on Apple, Segoe UI on Windows, Roboto on Android
//    and ChromeOS, the distribution's UI font on Linux). HCDP's copy of the
//    theme comments out its Open Sans body and Raleway heading rules, so
//    headings are the body family, weight 500 (Bootstrap) unless set.
//  - top navigation: Raleway 600 (Google Fonts, linked in index.html).
//  - code: the theme's monospace stack, no webfont.
const PORTAL_SANS = ['-apple-system', 'system-ui', 'BlinkMacSystemFont', '"Segoe UI"', 'Roboto', '"Helvetica Neue"', 'Arial', 'sans-serif']

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
        sans: PORTAL_SANS,
        // Headings: the same family as the body, as on the portal.
        display: PORTAL_SANS,
        // The portal's menu type (.onepress-menu a).
        nav: ['Raleway', 'Helvetica', 'Arial', 'sans-serif'],
        // The portal's code type (tt, kbd, pre, code, samp, var).
        mono: ['Monaco', 'Consolas', '"Andale Mono"', '"DejaVu Sans Mono"', 'monospace'],
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
