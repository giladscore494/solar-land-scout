/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./app/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
    "./lib/**/*.{ts,tsx}"
  ],
  theme: {
    extend: {
      colors: {
        // Premium dark data-viz palette
        bg: {
          900: "#070a10",
          800: "#0b1018",
          700: "#101826",
          600: "#172033"
        },
        line: "#1f2a3d",
        ink: {
          50: "#eef2f8",
          100: "#d7dfec",
          300: "#9aa7bd",
          400: "#7c8aa3",
          500: "#5d6a82"
        },
        accent: {
          solar: "#ffb020",
          solarSoft: "#f5c56b",
          cyan: "#39d0d8",
          magenta: "#c06cff"
        }
      },
      fontFamily: {
        sans: [
          "ui-sans-serif",
          "system-ui",
          "-apple-system",
          "Segoe UI",
          "Roboto",
          "Inter",
          "sans-serif"
        ],
        mono: ["ui-monospace", "SFMono-Regular", "Menlo", "monospace"]
      },
      boxShadow: {
        panel: "0 10px 40px -10px rgba(0,0,0,0.6)",
        glow: "0 0 24px rgba(255, 176, 32, 0.25)"
      }
    }
  },
  plugins: []
};
