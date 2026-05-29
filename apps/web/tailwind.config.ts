import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}", "./lib/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: "#172033",
        muted: "#647083",
        line: "#d9e0ea",
        page: "#f5f7fb",
        brand: "#1d4ed8",
        cyan: "#0e7490",
        green: "#15803d",
        amber: "#b45309",
        red: "#b91c1c"
      },
      boxShadow: {
        panel: "0 14px 34px rgba(23, 32, 51, 0.08)"
      }
    }
  },
  plugins: []
};

export default config;
