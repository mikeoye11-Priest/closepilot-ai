import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "ClosePilot — The System of Review for Accounting Practices",
  description: "Standardise findings, evidence, resolution and partner sign-off without replacing your accounts production software."
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
