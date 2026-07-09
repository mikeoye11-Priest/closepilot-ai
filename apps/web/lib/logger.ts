import * as Sentry from "@sentry/nextjs";

/**
 * Structured, JSON-line logging with Sentry error reporting.
 *
 * Logs are emitted as single-line JSON so they are queryable in Vercel logs
 * and any log drain. `reportError` additionally forwards to Sentry, which is a
 * no-op until a DSN is configured, so this is safe to adopt everywhere now.
 */

type Level = "debug" | "info" | "warn" | "error";
type Context = Record<string, unknown>;

function emit(level: Level, message: string, context?: Context): void {
  const entry = { level, message, ts: new Date().toISOString(), ...context };
  const line = JSON.stringify(entry);
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.log(line);
}

export const logger = {
  debug: (message: string, context?: Context) => emit("debug", message, context),
  info: (message: string, context?: Context) => emit("info", message, context),
  warn: (message: string, context?: Context) => emit("warn", message, context),
  error: (message: string, context?: Context) => emit("error", message, context),
};

/**
 * Log an error and report it to Sentry with optional context (e.g. tenantId,
 * route, uploadId). Use inside catch blocks on the finance pipeline so failures
 * on real client data are never silent.
 */
export function reportError(error: unknown, context?: Context): void {
  const message = error instanceof Error ? error.message : String(error);
  emit("error", message, context);
  Sentry.captureException(error, context ? { extra: context } : undefined);
}
