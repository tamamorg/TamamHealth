import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/modules/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        tamamhealth: {
          navy: 'var(--color-brand-700)',
          teal: 'var(--color-brand-500)',
          sage: 'var(--color-success)',
          earth: 'var(--color-warning)',
          gold: 'var(--color-warning)',
          green: 'var(--color-success)',
          red: 'var(--color-danger)',
          cream: 'var(--bg-card-solid)',
        },
        ss: {
          black: 'var(--text-primary)',
          red: 'var(--color-danger)',
          green: 'var(--color-success)',
          teal: 'var(--color-brand-500)',
          yellow: 'var(--color-warning)',
        },
        glass: {
          white: 'var(--glass-bg)',
          light: 'var(--overlay-light)',
          medium: 'var(--overlay-medium)',
          dark: 'var(--overlay-backdrop)',
        },
        accent: {
          DEFAULT: 'var(--accent-primary)',
          light: 'var(--accent-light)',
          dark: 'var(--accent-hover)',
          glow: 'transparent',
        },
      },
      fontFamily: {
        sans: ['DM Sans', 'system-ui', '-apple-system', 'BlinkMacSystemFont', 'Segoe UI', 'sans-serif'],
        display: ['DM Sans', 'system-ui', '-apple-system', 'BlinkMacSystemFont', 'Segoe UI', 'sans-serif'],
        mono: ['JetBrains Mono', 'SFMono-Regular', 'Menlo', 'Consolas', 'monospace'],
      },
      borderRadius: {
        'none': '0px',
        'sm': '2px',
        DEFAULT: '3px',
        'md': '3px',
        'lg': '4px',
        'xl': '5px',
        '2xl': '6px',
        '3xl': '8px',
        'glass': '6px',
        // `full` kept fully round for pills, avatars, and circular badges.
        'full': '9999px',
      },
      backdropBlur: {
        'glass': '24px',
      },
      boxShadow: {
        'glass': 'none',
        'glass-lg': 'none',
        'soft': 'none',
        'soft-lg': 'none',
        'accent': 'none',
      },
      animation: {
        'fade-in': 'fadeIn 0.5s ease-out both',
        'fade-in-up': 'fadeInUp 0.5s ease-out both',
        'fade-in-down': 'fadeInDown 0.4s ease-out both',
        'slide-in-left': 'slideInLeft 0.5s ease-out both',
        'slide-in-right': 'slideInRight 0.5s ease-out both',
        'scale-in': 'scaleIn 0.4s ease-out both',
        'float': 'float 6s ease-in-out infinite',
      },
      keyframes: {
        fadeIn: {
          from: { opacity: '0' },
          to: { opacity: '1' },
        },
        fadeInUp: {
          from: { opacity: '0', transform: 'translateY(12px)' },
          to: { opacity: '1', transform: 'translateY(0)' },
        },
        fadeInDown: {
          from: { opacity: '0', transform: 'translateY(-12px)' },
          to: { opacity: '1', transform: 'translateY(0)' },
        },
        slideInLeft: {
          from: { opacity: '0', transform: 'translateX(-16px)' },
          to: { opacity: '1', transform: 'translateX(0)' },
        },
        slideInRight: {
          from: { opacity: '0', transform: 'translateX(16px)' },
          to: { opacity: '1', transform: 'translateX(0)' },
        },
        scaleIn: {
          from: { opacity: '0', transform: 'scale(0.95)' },
          to: { opacity: '1', transform: 'scale(1)' },
        },
        float: {
          '0%, 100%': { transform: 'translateY(0)' },
          '50%': { transform: 'translateY(-6px)' },
        },
      },
    },
  },
  plugins: [],
};
export default config;
