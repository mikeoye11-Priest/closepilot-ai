import { NextResponse } from "next/server";
import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";
import { reportError } from "@/lib/logger";

/**
 * Per-caller rate limiting for cost-sensitive endpoints (AI + uploads).
 *
 * Fail-open by design: when Upstash is not configured the limiter is disabled,
 * so local dev, CI and unconfigured deployments behave exactly as before. Set
 * UPSTASH_REDIS_REST_URL + UPSTASH_REDIS_REST_TOKEN to switch it on.
 */

const url = process.env.UPSTASH_REDIS_REST_URL;
const token = process.env.UPSTASH_REDIS_REST_TOKEN;
const redis = url && token ? new Redis({ url, token }) : null;

export type RateLimitBucket = "ai" | "upload";

const RULES: Record<RateLimitBucket, { tokens: number; window: `${number} ${"s" | "m" | "h"}` }> = {
  ai: { tokens: 20, window: "1 m" },
  upload: { tokens: 10, window: "1 m" },
};

const limiters: Record<RateLimitBucket, Ratelimit> | null = redis
  ? {
      ai: new Ratelimit({
        redis,
        limiter: Ratelimit.slidingWindow(RULES.ai.tokens, RULES.ai.window),
        prefix: "closepilot:rl:ai",
        analytics: false,
      }),
      upload: new Ratelimit({
        redis,
        limiter: Ratelimit.slidingWindow(RULES.upload.tokens, RULES.upload.window),
        prefix: "closepilot:rl:upload",
        analytics: false,
      }),
    }
  : null;

/** Stable per-caller key: the authenticated user when available, else client IP. */
export function rateLimitKey(userId: string | null, request: Request): string {
  if (userId) return `user:${userId}`;
  const forwarded = request.headers.get("x-forwarded-for");
  const ip = forwarded?.split(",")[0]?.trim() || request.headers.get("x-real-ip") || "unknown";
  return `ip:${ip}`;
}

/**
 * Returns a 429 response when the caller has exceeded the bucket, otherwise
 * null (allowed). Never throws — a limiter/Redis outage fails open so real work
 * is never blocked by an infrastructure blip.
 */
export async function enforceRateLimit(bucket: RateLimitBucket, key: string): Promise<NextResponse | null> {
  if (!limiters) return null;
  try {
    const { success, limit, remaining, reset } = await limiters[bucket].limit(key);
    if (success) return null;
    const retryAfter = Math.max(1, Math.ceil((reset - Date.now()) / 1000));
    return NextResponse.json(
      { error: "Too many requests — please slow down and try again in a moment." },
      {
        status: 429,
        headers: {
          "Retry-After": String(retryAfter),
          "X-RateLimit-Limit": String(limit),
          "X-RateLimit-Remaining": String(Math.max(0, remaining)),
        },
      },
    );
  } catch (error) {
    reportError(error, { step: "rate-limit", bucket });
    return null;
  }
}
