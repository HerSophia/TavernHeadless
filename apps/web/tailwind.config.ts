import type { Config } from "tailwindcss";

export default {
  darkMode: ["class"],
  content: ["./index.html", "./src/**/*.{vue,ts}"],
  theme: {
    extend: {
      colors: {
        bg: "#09090b",
        panel: "#121215",
        surface: "#18181b",
        signal: {
          success: "#4ade80",
          warn: "#fbbf24",
          error: "#f87171",
          info: "#60a5fa",
          accent: "#2dd4bf"
        }
      },
      fontFamily: {
        sans: ["Inter", "Noto Sans SC", "sans-serif"],
        mono: ["JetBrains Mono", "monospace"]
      }
    }
  }
} satisfies Config;
