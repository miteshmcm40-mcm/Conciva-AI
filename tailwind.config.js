import typography from '@tailwindcss/typography';

/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  // Light-theme only. We keep the class strategy (not media) so existing
  // `dark:xxx` utility classes scattered across components never fire —
  // nothing in the app adds the `.dark` class to <html> anymore.
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        ink: { 950: '#0b1220', 900: '#0b1220', 800: '#28324a', 700: '#28324a' },
        line: '#d9d9db',
        // KallUS brand accent — signature lime/green. Named `lime` so every
        // `teal-*` / `sky-*` utility across the app maps onto this one ramp;
        // the five canonical brand stops are 100/200/300/500/700/800, the
        // rest are interpolated to fill out the full Tailwind shade range.
        lime: {
          50:  '#f6f8f1',
          100: '#eef8d4',
          200: '#d1f792',
          300: '#c2ee6f',
          400: '#a3d94f',
          500: '#6fa524',
          600: '#5c8a1e',
          700: '#4d7c0f',
          800: '#3a5a0c',
          900: '#2c4509',
          950: '#1d2e06',
        },
        mute: '#586379',
      },
      // Resolve Tailwind's font-sans (the default applied via Preflight) so
      // utility-styled components match the global CSS.
      fontFamily: {
        sans: ['Inter', 'Geist', 'system-ui', '-apple-system', 'sans-serif'],
        display: ['Outfit', 'Manrope', 'system-ui', 'sans-serif'],
        mono: ['Fragment Mono', 'ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace'],
      },
    },
  },
  plugins: [
    // @tailwindcss/typography — the `prose` class used on /terms and /privacy.
    typography,
  ],
};
