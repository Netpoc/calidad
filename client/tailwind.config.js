/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{vue,ts}'],
  // Preflight is ON: Ant Design used to supply the reset, and its own styles
  // fought Preflight. With antd removed, Tailwind owns the base layer.
  theme: {
    extend: {
      fontFamily: {
        sans: ['Inter', 'system-ui', '-apple-system', 'Segoe UI', 'sans-serif'],
      },
      colors: {
        brand: {
          50: 'var(--brand-50)',
          100: 'var(--brand-100)',
          500: 'var(--brand-500)',
          600: 'var(--brand-600)',
          700: 'var(--brand-700)',
          800: 'var(--brand-800)',
        },
        money: {
          collected: 'var(--money-collected)',
          pending: 'var(--money-pending)',
          billed: 'var(--money-billed)',
        },
      },
      minHeight: { tap: 'var(--tap-min)' },
      minWidth: { tap: 'var(--tap-min)' },
    },
  },
  plugins: [],
}
