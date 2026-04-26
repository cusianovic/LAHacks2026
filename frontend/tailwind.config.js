/** @type {import('tailwindcss').Config} */
// Pupload theme.
//
// Single source of truth: CSS custom properties declared in `index.css`
// (look for `:root { ... }`). This config just exposes them as Tailwind
// utility classes so you can write `bg-canvas`, `text-ink`, etc.
//
// To re-skin the editor: change the variables in `index.css`.
// To add a new token: declare the variable, then map it here.
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // ── core surfaces ────────────────────────────────────────
        canvas: 'var(--color-canvas)',          // primary work area (light)
        chrome: 'var(--color-chrome)',          // sidebars + pill (dark)
        // raised dark surfaces used inside `chrome` panels (input fills,
        // active button bg, hover states).
        raised: {
          DEFAULT: 'var(--color-raised)',      // input / control fill
          strong: 'var(--color-raised-strong)', // active / pressed fill
          hover: 'var(--color-raised-hover)',  // hover fill
        },
        // ── borders ──────────────────────────────────────────────
        border: 'var(--color-border)',          // single seam color
        // ── text ─────────────────────────────────────────────────
        ink: {
          DEFAULT: 'var(--color-ink)',         // primary
          dim: 'var(--color-ink-dim)',         // labels / secondary
          faint: 'var(--color-ink-faint)',     // hints / placeholders
          inverse: 'var(--color-ink-inverse)', // dark text on light canvas
        },
        // ── row treatments (lists) ──────────────────────────────
        row: {
          hover: 'var(--color-row-hover)',     // rgba white 0.06
          active: 'var(--color-row-active)',   // rgba white 0.10
        },
        // ── status (used by status dot + node strips) ───────────
        status: {
          saved: 'var(--color-status-saved)',
          saving: 'var(--color-status-saving)',
          dirty: 'var(--color-status-dirty)',
          error: 'var(--color-status-error)',
          warn: 'var(--color-status-warn)',
          idle: 'var(--color-status-idle)',
          ready: 'var(--color-status-ready)',
          running: 'var(--color-status-running)',
          complete: 'var(--color-status-complete)',
          waiting: 'var(--color-status-waiting)',
        },
        // ── accent (kept available, used sparingly) ──────────────
        accent: {
          DEFAULT: 'var(--color-accent)',
          dim: 'var(--color-accent-dim)',
        },
      },
      fontFamily: {
        sans: ['"Geist Variable"', 'Geist', 'Inter', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        mono: ['"JetBrains Mono Variable"', '"JetBrains Mono"', 'ui-monospace', 'monospace'],
      },
      fontSize: {
        // Figma's right-bar reference points.
        '2xs': ['10px', '14px'],
        'xs-13': ['13px', '16px'],
      },
      borderRadius: {
        // 6px is the rounded corner used by Figma for list rows + inputs.
        row: '6px',
        // 20px for the floating pill.
        pill: '20px',
      },
      boxShadow: {
        // Subtle selection ring around nodes / focused inputs.
        focus: '0 0 0 1px var(--color-accent)',
        // Drop shadow under the floating dark pill on the light canvas.
        pill: '0 6px 18px -6px rgba(0,0,0,0.35), 0 2px 6px -2px rgba(0,0,0,0.25)',
        // Light-canvas card shadow (when needed).
        card: '0 4px 16px -8px rgba(0,0,0,0.25)',
      },
      // Run-time animations on canvas nodes. `pulse-ring` is the soft
      // halo that signals a clickable upload datawell. `marching-stripes`
      // is the moving diagonal pattern on a step's status strip while
      // the controller reports it as RUNNING.
      keyframes: {
        'pulse-ring': {
          '0%, 100%': { boxShadow: '0 0 0 0 rgba(2, 134, 87, 0.55)' },
          '50%': { boxShadow: '0 0 0 8px rgba(2, 134, 87, 0)' },
        },
        'marching-stripes': {
          '0%': { backgroundPosition: '0 0' },
          '100%': { backgroundPosition: '24px 0' },
        },
      },
      animation: {
        'pulse-ring': 'pulse-ring 1.6s ease-in-out infinite',
        'marching-stripes': 'marching-stripes 0.8s linear infinite',
      },
    },
  },
  plugins: [],
}
