import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}", "./lib/**/*.{ts,tsx}"],
  theme: {
    extend: {
      fontFamily: {
        sans: ["var(--font-sans)", "ui-sans-serif", "system-ui", "-apple-system", "Segoe UI", "Roboto", "Helvetica Neue", "Arial", "sans-serif"]
      },
      colors: {
        ink: "#172033",
        muted: "#647083",
        line: "#e2e8f1",
        page: "#f5f7fb",
        surface: "#ffffff",
        brand: "#1d4ed8",
        cyan: "#0e7490",
        green: "#15803d",
        amber: "#b45309",
        red: "#b91c1c"
      },
      boxShadow: {
        // Softer, more modern elevation than the old flat drop shadow.
        panel: "0 10px 30px -14px rgba(23, 32, 51, 0.12)",
        card: "0 1px 2px rgba(23, 32, 51, 0.04), 0 12px 26px -16px rgba(23, 32, 51, 0.16)"
      }
    }
  },
  plugins: []
};

export default config;
