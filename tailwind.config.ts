import type { Config } from "tailwindcss";

/**
 * HackrLife Agent Lab — Tailwind theme.
 * Aesthetic: polished, credible, research-lab. Deep ink base, warm paper,
 * a single confident accent (signal lime/amber blend) and a cool data-blue.
 */
const config: Config = {
  // Class-based dark mode: toggled by `class="dark"` on <html>.
  darkMode: "class",
  content: [
    "./src/app/**/*.{ts,tsx}",
    "./src/components/**/*.{ts,tsx}",
    "./src/lib/**/*.{ts,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        ink: {
          DEFAULT: "#0b0f14",
          900: "#0b0f14",
          800: "#11161d",
          700: "#1a212b",
          600: "#28323f",
          500: "#3a4757",
        },
        paper: {
          DEFAULT: "#f7f5f0",
          200: "#efece4",
          300: "#e4e0d6",
        },
        // BLAUGRANA claret is now the single accent across the site.
        // (Named `signal` so the existing references recolor automatically.)
        signal: {
          DEFAULT: "#a50044", // primary accent — blaugrana claret
          600: "#8a0039",
          700: "#6e002d",
        },
        // Explicit brand alias + a lighter tint for legible accents on dark surfaces.
        brand: {
          DEFAULT: "#a50044",
          600: "#8a0039",
          700: "#6e002d",
          light: "#ff5c93", // use on dark backgrounds (CTA band, dark-mode pills)
        },
        data: {
          DEFAULT: "#5eb1ef", // cool data-blue secondary
          600: "#3d97dd",
        },
        ember: {
          DEFAULT: "#f0913e", // warm preview accent
        },
      },
      fontFamily: {
        display: ["var(--font-display)", "Georgia", "serif"],
        sans: ["var(--font-sans)", "system-ui", "sans-serif"],
        mono: ["var(--font-mono)", "ui-monospace", "monospace"],
      },
      borderRadius: {
        xl: "0.875rem",
        "2xl": "1.25rem",
      },
      boxShadow: {
        lift: "0 1px 0 0 rgba(11,15,20,0.04), 0 12px 32px -12px rgba(11,15,20,0.25)",
        liftlg: "0 2px 0 0 rgba(11,15,20,0.05), 0 30px 60px -24px rgba(11,15,20,0.35)",
      },
      keyframes: {
        "fade-up": {
          "0%": { opacity: "0", transform: "translateY(14px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
        "fade-in": {
          "0%": { opacity: "0" },
          "100%": { opacity: "1" },
        },
        pulseline: {
          "0%, 100%": { opacity: "0.35" },
          "50%": { opacity: "1" },
        },
      },
      animation: {
        "fade-up": "fade-up 0.7s cubic-bezier(0.16,1,0.3,1) both",
        "fade-in": "fade-in 0.9s ease both",
        pulseline: "pulseline 2.4s ease-in-out infinite",
      },
    },
  },
  plugins: [],
};

export default config;
