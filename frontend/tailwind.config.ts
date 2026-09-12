import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: {
          DEFAULT: "#1B1F24",
          soft: "#333A42",
          faint: "#6B7280",
        },
        paper: {
          DEFAULT: "#EFEAE0",
          dim: "#E4DECD",
          bright: "#FBF9F3",
        },
        rule: {
          DEFAULT: "#D9D2BF",
          dark: "#A9A08A",
        },
        stamp: {
          DEFAULT: "#1F5C46",
          soft: "#E3EEE7",
        },
        ember: {
          DEFAULT: "#A15A22",
          soft: "#F1E4D3",
        },
        slate: {
          DEFAULT: "#3E5468",
          soft: "#E4E9EE",
        },
        danger: {
          DEFAULT: "#8C2F2F",
          soft: "#F1E0DE",
        },
      },
      fontFamily: {
        serif: ["var(--font-fraunces)", "Georgia", "serif"],
        sans: ["var(--font-inter)", "system-ui", "sans-serif"],
        mono: ["var(--font-plex-mono)", "monospace"],
      },
      boxShadow: {
        none: "none",
      },
      keyframes: {
        stampIn: {
          "0%": { opacity: "0", transform: "scale(2.2) rotate(-8deg)" },
          "60%": { opacity: "1", transform: "scale(0.94) rotate(-8deg)" },
          "100%": { opacity: "1", transform: "scale(1) rotate(-8deg)" },
        },
        fadeUp: {
          "0%": { opacity: "0", transform: "translateY(6px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
        blink: {
          "0%, 100%": { opacity: "1" },
          "50%": { opacity: "0" },
        },
      },
      animation: {
        stampIn: "stampIn 0.5s cubic-bezier(.2,.9,.25,1.1) forwards",
        fadeUp: "fadeUp 0.4s ease-out forwards",
        blink: "blink 1s step-end infinite",
      },
    },
  },
  plugins: [],
};
export default config;