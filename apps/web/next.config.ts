import type { NextConfig } from "next";
import { withSentryConfig } from "@sentry/nextjs";

const production = process.env.NODE_ENV === "production";
const scriptSources = ["'self'", "'unsafe-inline'", ...(!production ? ["'unsafe-eval'"] : [])];
const contentSecurityPolicy = [
  "default-src 'self'",
  `script-src ${scriptSources.join(" ")}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "connect-src 'self' https://*.supabase.co wss://*.supabase.co https://*.sentry.io",
  "worker-src 'self' blob:",
  "media-src 'self' blob:",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
  "manifest-src 'self'",
  ...(production ? ["upgrade-insecure-requests"] : []),
].join("; ");
const securityHeaders = [
  { key: "Content-Security-Policy", value: contentSecurityPolicy },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
  ...(production ? [{ key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" }] : []),
];

const nextConfig: NextConfig = {
  // Playwright can run beside a developer's active `.next` dev server without
  // competing for Next's build-directory lock.
  distDir: process.env.CLOSEPILOT_DIST_DIR || ".next",
  allowedDevOrigins: ["127.0.0.1"],
  typedRoutes: true,
  async headers() {
    return [{
      source: "/:path*",
      headers: securityHeaders,
    }];
  },
};

export default withSentryConfig(nextConfig, {
  silent: !process.env.CI,
  telemetry: false,
  // Source-map upload is opt-in: it only runs when a Sentry auth token is set,
  // so local and Vercel builds never require Sentry credentials to succeed.
  sourcemaps: { disable: !process.env.SENTRY_AUTH_TOKEN },
  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT,
  authToken: process.env.SENTRY_AUTH_TOKEN,
});
