// Resilient fetch for outbound provider calls (QuickBooks / Sage token + API).
//
// Adds the transient-failure handling external integrations are expected to have
// but a bare fetch lacks: a request timeout, and bounded exponential backoff with
// jitter on rate limits (429) and transient server errors (5xx), honouring the
// provider's Retry-After header. Deterministic 4xx (bad request, auth) are NOT
// retried — those are surfaced immediately so the reauth flow can act on them.
//
// Returns the final Response un-consumed, so callers keep their existing
// `response.ok` / `.json()` / `.text()` handling — it's a drop-in for `fetch`.

const DEFAULT_TIMEOUT_MS = 20_000;
const DEFAULT_RETRIES = 2; // total attempts = retries + 1
const MAX_BACKOFF_MS = 8_000;
const MAX_RETRY_AFTER_MS = 30_000;
const RETRYABLE_STATUS = new Set([429, 500, 502, 503, 504]);

export type ResilientFetchOptions = { timeoutMs?: number; retries?: number };

export async function resilientFetch(url: string, init: RequestInit = {}, options: ResilientFetchOptions = {}): Promise<Response> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxRetries = options.retries ?? DEFAULT_RETRIES;

  for (let attempt = 0; ; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(url, { ...init, signal: controller.signal });
      clearTimeout(timer);
      if (attempt < maxRetries && RETRYABLE_STATUS.has(response.status)) {
        const delay = retryDelayMs(response, attempt);
        await drain(response);
        await sleep(delay);
        continue;
      }
      return response;
    } catch (error) {
      clearTimeout(timer);
      const aborted = error instanceof Error && error.name === "AbortError";
      if (attempt < maxRetries) {
        await sleep(backoffMs(attempt));
        continue;
      }
      if (aborted) throw new Error(`Request timed out after ${timeoutMs}ms: ${hostOf(url)}`);
      throw error instanceof Error ? error : new Error(String(error));
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, Math.max(0, ms)));
}

// Exponential backoff (500ms, 1s, 2s, …) capped, with ±50% jitter to avoid a
// thundering-herd retry storm.
function backoffMs(attempt: number): number {
  const base = Math.min(MAX_BACKOFF_MS, 500 * 2 ** attempt);
  return base / 2 + Math.random() * (base / 2);
}

// Honour Retry-After (delta-seconds or an HTTP date) when present, else backoff.
function retryDelayMs(response: Response, attempt: number): number {
  const header = response.headers.get("retry-after");
  if (header) {
    const seconds = Number(header);
    if (Number.isFinite(seconds)) return Math.min(MAX_RETRY_AFTER_MS, Math.max(0, seconds * 1000));
    const date = Date.parse(header);
    if (!Number.isNaN(date)) return Math.min(MAX_RETRY_AFTER_MS, Math.max(0, date - Date.now()));
  }
  return backoffMs(attempt);
}

async function drain(response: Response): Promise<void> {
  try {
    await response.body?.cancel();
  } catch {
    /* best-effort — the body is being discarded before a retry */
  }
}

function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}
