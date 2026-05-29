import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "ClosePilot AI",
  description: "Upload finance exports and get a board-ready finance health review"
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
