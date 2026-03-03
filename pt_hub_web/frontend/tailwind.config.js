/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        dark: {
          bg: '#070B10',
          bg2: '#0B1220',
          panel: '#0E1626',
          panel2: '#121C2F',
          border: '#243044',
          fg: '#C7D1DB',
          muted: '#8B949E',
          accent: '#00FF66',
          accent2: '#00E5FF',
          select: '#17324A',
        },
      },
      fontFamily: {
        mono: ['JetBrains Mono', 'Consolas', 'Monaco', 'monospace'],
      },
    },
  },
  plugins: [],
}
