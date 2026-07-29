import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import "./globals.css";

// Product typeface. Exposed as a CSS variable that globals.css applies to <body>,
// so it flows to every screen without touching component markup.
const inter = Inter({ subsets: ["latin"], variable: "--font-sans", display: "swap" });

export const metadata: Metadata = {
  title: "ClosePilot — The System of Review for Accounting Practices",
  description: "Standardise findings, evidence, resolution and partner sign-off without replacing your accounts production software."
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={inter.variable}>
      <body>{children}</body>
    </html>
  );
}
