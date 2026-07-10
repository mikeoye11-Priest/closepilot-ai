/**
 * Pure authorisation for the background upload worker.
 *
 * The worker endpoint is triggered on a schedule by an external caller (an
 * external cron service posting every minute), so its auth boundary is
 * security-critical and kept here as a framework-free, unit-tested function.
 */

export type WorkerAuthResult =
  | { ok: true }
  | { ok: false; status: 401 | 503; error: string };

export function authoriseWorkerRequest(
  authorizationHeader: string | null,
  secret: string | undefined,
): WorkerAuthResult {
  if (!secret) {
    return { ok: false, status: 503, error: "Worker authentication is not configured." };
  }
  if (authorizationHeader !== `Bearer ${secret}`) {
    return { ok: false, status: 401, error: "Unauthorised worker request." };
  }
  return { ok: true };
}
