/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        canvas: '#F4F6FB', // page background
        card: '#FFFFFF',
        line: '#E3E8F1',
        soft: '#EEF1F8', // quiet fills
        accent: '#4F46E5', // indigo
        ok: '#16A34A',
        warn: '#D97706',
        crit: '#DC2626',
        ink: '#0F172A',
        muted: '#64748B',
      },
      fontFamily: {
        sans: ['"Plus Jakarta Sans Variable"', '"Plus Jakarta Sans"', 'system-ui', 'Segoe UI', 'sans-serif'],
      },
      keyframes: {
        pulseRing: { '0%,100%': { opacity: '1' }, '50%': { opacity: '0.4' } },
      },
      animation: { pulseRing: 'pulseRing 1.3s ease-in-out infinite' },
    },
  },
  plugins: [],
};
