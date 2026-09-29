#!/usr/bin/env node
import { readFileSync, writeFileSync } from "node:fs";
import { spawn } from "node:child_process";
import { join } from "node:path";

const root = join(import.meta.dirname, "..");
const generatedFiles = [
  join(root, "apps", "web", "next-env.d.ts"),
  join(root, "apps", "web", "tsconfig.json"),
];
const snapshots = new Map(generatedFiles.map((file) => [file, readFileSync(file)]));
const port = process.argv[2] ?? "3210";
let restored = false;

function restoreGeneratedFiles() {
  if (restored) return;
  restored = true;
  for (const [file, contents] of snapshots) writeFileSync(file, contents);
}

const child = spawn(process.execPath, [
  join(root, "node_modules", "next", "dist", "bin", "next"),
  "dev", "apps/web", "-H", "127.0.0.1", "-p", port,
], {
  cwd: root,
  env: {
    ...process.env,
    CLOSEPILOT_AUTH_DISABLED: "1",
    CLOSEPILOT_DIST_DIR: ".next-playwright",
  },
  stdio: "inherit",
});

let stopping = false;
function stop(signal) {
  if (stopping) return;
  stopping = true;
  child.kill(signal);
  setTimeout(() => child.kill("SIGKILL"), 8_000).unref();
}

process.on("SIGTERM", () => stop("SIGTERM"));
process.on("SIGINT", () => stop("SIGINT"));
process.on("exit", restoreGeneratedFiles);
child.on("error", (error) => {
  console.error(error);
  restoreGeneratedFiles();
  process.exitCode = 1;
});
child.on("exit", (code, signal) => {
  restoreGeneratedFiles();
  process.exitCode = code ?? (signal ? 1 : 0);
});
