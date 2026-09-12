import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        canvas: {
          DEFAULT: "#2B2622",
          soft: "#383330",
        },
        line: {
          DEFAULT: "#3F3A36",
        },
        ink: {
          DEFAULT: "#F7F5F0",
          strong: "#DAD2C1",
          body: "#C9C0AD",
          mute: "#AEA69C",
        },
        accent: {
          DEFAULT: "#2DD4BF",
          bright: "#5EEAD4",
          dim: "#134E4A",
        },
        danger: {
          DEFAULT: "#E0654F",
          dim: "#4A2320",
        },
        warn: {
          DEFAULT: "#D9A441",
          dim: "#4A3A1C",
        },
      },
      fontFamily: {
        serif: ["var(--font-instrument)", "Georgia", "serif"],
        sans: ["var(--font-inter)", "system-ui", "sans-serif"],
        mono: ["var(--font-dm-mono)", "ui-monospace", "monospace"],
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
