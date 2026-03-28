import { heroui } from '@heroui/theme';

/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
    "./node_modules/@heroui/theme/dist/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        background: '#000000',
        foreground: '#ECEDEE',
        surface: {
          DEFAULT: '#18181b',
          secondary: '#27272a',
          tertiary: '#3f3f46',
        },
        muted: '#a1a1aa',
        accent: {
          DEFAULT: '#006FEE',
          foreground: '#ffffff',
          100: '#001731',
          500: '#006FEE',
        },
        secondary: {
          DEFAULT: '#7828c8',
          foreground: '#ffffff',
        },
        success: {
          DEFAULT: '#17c964',
          foreground: '#000000',
          600: '#12a150',
        },
        warning: {
          DEFAULT: '#f5a524',
          foreground: '#000000',
        },
        danger: {
          DEFAULT: '#f31260',
          foreground: '#ffffff',
        },
        border: 'rgba(255, 255, 255, 0.15)',
        separator: 'rgba(255, 255, 255, 0.15)',
        field: '#18181b',
        // Legacy aliases (dark-* tokens used in some components)
        dark: {
          bg: '#000000',
          bg2: '#18181b',
          panel: '#18181b',
          panel2: '#27272a',
          border: 'rgba(255, 255, 255, 0.15)',
          fg: '#ECEDEE',
          muted: '#a1a1aa',
          accent: '#006FEE',
          accent2: '#338ef7',
          select: 'rgba(0, 111, 238, 0.15)',
        },
      },
      fontFamily: {
        sans: ['Inter', '-apple-system', 'BlinkMacSystemFont', 'Segoe UI', 'sans-serif'],
        mono: ['JetBrains Mono', 'Consolas', 'Monaco', 'monospace'],
      },
      borderRadius: {
        'glass': '0.75rem',
        'glass-sm': '0.5rem',
        'glass-pill': '9999px',
      },
    },
  },
  darkMode: 'class',
  plugins: [heroui({
    defaultTheme: 'dark',
    themes: {
      dark: {
        colors: {
          background: '#000000',
          foreground: '#ECEDEE',
          default: {
            50: '#18181b',
            100: '#27272a',
            200: '#3f3f46',
            300: '#52525b',
            400: '#71717a',
            500: '#a1a1aa',
            foreground: '#ECEDEE',
            DEFAULT: '#3f3f46',
          },
          content1: '#18181b',
          content2: '#27272a',
          content3: '#3f3f46',
          content4: '#52525b',
          primary: {
            DEFAULT: '#006FEE',
            foreground: '#ffffff',
          },
        },
      },
    },
  })],
}
