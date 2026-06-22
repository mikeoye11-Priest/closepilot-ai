import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "ClosePilot — AI Financial Assurance Platform",
  description: "Every ledger. Every balance. Every risk. Reviewed before sign-off. 350+ assurance tests across 8 layers."
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
