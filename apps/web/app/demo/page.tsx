import type { Metadata } from "next";
import { AppShell } from "@/components/app-shell";

export const metadata: Metadata = {
  title: "ClosePilot Interactive Demo",
  description: "See how prepared accounts become a consistent, evidence-backed partner review using fictional Brightlane Manufacturing data.",
};

export default function DemoPage() {
  return <AppShell userEmail="" presentationMode />;
}
