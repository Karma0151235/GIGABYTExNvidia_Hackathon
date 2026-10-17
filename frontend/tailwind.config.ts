import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./hooks/**/*.{js,ts,jsx,tsx,mdx}",
    "./lib/**/*.{js,ts,jsx,tsx,mdx}",
    "./modules/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        command: {
          950: "#071016",
          900: "#091923",
          800: "#0d2632",
          700: "#113545",
        },
        civic: {
          cyan: "#35e7ff",
          blue: "#3f8cff",
          amber: "#ffbe5c",
          red: "#ff4d6d",
          green: "#5cffb1",
        },
      },
      fontFamily: {
        display: ["var(--font-display)", "serif"],
        body: ["var(--font-body)", "sans-serif"],
      },
      boxShadow: {
        glow: "0 0 36px rgba(53, 231, 255, 0.28)",
        alert: "0 0 36px rgba(255, 77, 109, 0.28)",
      },
      backgroundImage: {
        "radial-grid":
          "radial-gradient(circle at top left, rgba(53,231,255,.18), transparent 28%), radial-gradient(circle at 80% 10%, rgba(255,190,92,.14), transparent 22%), linear-gradient(135deg, #071016 0%, #0b1d29 48%, #061018 100%)",
      },
      keyframes: {
        scan: {
          "0%": { transform: "translateY(-120%)" },
          "100%": { transform: "translateY(120%)" },
        },
        pulseRing: {
          "0%": { transform: "scale(0.82)", opacity: "0.85" },
          "100%": { transform: "scale(1.55)", opacity: "0" },
        },
        routeDraw: {
          "0%": { strokeDashoffset: "1000" },
          "100%": { strokeDashoffset: "0" },
        },
        earthRotate: {
          "0%": { backgroundPosition: "0% 50%" },
          "100%": { backgroundPosition: "200% 50%" },
        },
        cloudDrift: {
          "0%": { transform: "translateX(-8%) rotate(-8deg)" },
          "100%": { transform: "translateX(8%) rotate(-8deg)" },
        },
      },
      animation: {
        scan: "scan 5s linear infinite",
        pulseRing: "pulseRing 1.8s ease-out infinite",
        routeDraw: "routeDraw 2s ease-out forwards",
        earthRotate: "earthRotate 16s linear infinite",
        cloudDrift: "cloudDrift 8s ease-in-out infinite alternate",
      },
    },
  },
  plugins: [],
};

export default config;
