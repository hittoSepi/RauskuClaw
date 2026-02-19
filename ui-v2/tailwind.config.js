n   /** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{vue,ts,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        'bg-0': '#0B0F14',
        'bg-1': '#0F1620',
        'bg-2': '#141E2B',
        'border-0': 'rgba(255,255,255,0.08)',
        'text-0': 'rgba(255,255,255,0.92)',
        'text-1': 'rgba(255,255,255,0.72)',
        'text-2': 'rgba(255,255,255,0.52)',
        'accent': '#5B7CFF',
        'accent-2': '#7C5CFF',
        'success': '#38D996',
        'warn': '#FFB020',
        'danger': '#FF4D6D',
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', '-apple-system', 'Segoe UI', 'Roboto', 'Arial', 'sans-serif'],
        mono: ['JetBrains Mono', 'ui-monospace', 'SFMono-Regular', 'Menlo', 'Consolas', 'monospace'],
      },
      fontSize: {
        'xl': ['22px', { lineHeight: '1.4' }],
        'lg': ['18px', { lineHeight: '1.5' }],
        'md': ['16px', { lineHeight: '1.5' }],
        'sm': ['13px', { lineHeight: '1.5' }],
      },
      borderRadius: {
        'sm': '10px',
        'md': '14px',
        'lg': '18px',
      },
      boxShadow: {
        '1': '0 10px 30px rgba(0,0,0,0.35)',
      },
      spacing: {
        's-1': '8px',
        's-2': '12px',
        's-3': '16px',
        's-4': '24px',
      },
    },
  },
  plugins: [],
}