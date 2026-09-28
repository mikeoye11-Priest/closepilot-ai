"use client";

export const dynamic = "force-dynamic";

import { useEffect, useState } from "react";

type State =
  | { phase: "working" }
  | { phase: "joined" }
  | { phase: "failed"; message: string };

/**
 * Where an invitation link lands after the recovery callback has established a
 * session. Acceptance is a single POST; all the reasoning about who may accept
 * lives server-side in accept_firm_invitation, because the browser is not a
 * place to decide whether someone is entitled to join a firm.
 */
export default function JoinPage() {
  const [state, setState] = useState<State>({ phase: "working" });

  useEffect(() => {
    const invitationId = new URLSearchParams(window.location.search).get("invitation");
    if (!invitationId) {
      setState({ phase: "failed", message: "That link is missing its invitation reference." });
      return;
    }

    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/members/accept", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ invitationId })
        });
        const payload = await res.json().catch(() => ({}));
        if (cancelled) return;
        if (!res.ok) {
          setState({ phase: "failed", message: payload.error ?? "That invitation could not be accepted." });
          return;
        }
        // Supabase generates a password for an invited account; the invitee
        // never chose one. Landing them in the workspace on the invite session
        // leaves them with access they cannot get back once it expires - and
        // no reason to suspect that, since they are plainly signed in. Send
        // them to set one while the session is live.
        window.location.replace("/update-password?invited=1");
        return;
      } catch {
        if (!cancelled) setState({ phase: "failed", message: "Could not reach ClosePilot. Try the link again in a moment." });
      }
    })();

    return () => { cancelled = true; };
  }, []);

  return (
    <div className="flex min-h-screen items-center justify-center bg-[#101827] p-4">
      <div className="w-full max-w-md">
        <div className="mb-8 flex items-center gap-3">
          <div className="grid h-12 w-12 place-items-center rounded-xl bg-gradient-to-br from-cyan-400 to-blue-600 font-bold text-white text-lg">CP</div>
          <div>
            <strong className="block text-white text-xl">ClosePilot</strong>
            <span className="text-sm text-slate-400 font-bold uppercase tracking-wide">System of Review</span>
          </div>
        </div>

        <div className="rounded-2xl bg-white p-8 shadow-2xl">
          {state.phase === "working" && (
            <>
              <h1 className="text-2xl font-bold mb-1">Joining your firm</h1>
              <p className="text-muted text-sm">One moment while we set up your access.</p>
            </>
          )}

          {state.phase === "joined" && (
            <>
              <h1 className="text-2xl font-bold mb-1">You&apos;re in</h1>
              <p className="text-muted text-sm mb-6">Your access is set up. Choose a password so you can sign in again later.</p>
              <a className="inline-flex h-11 items-center rounded-lg bg-brand px-4 font-bold text-white" href="/update-password?invited=1">
                Choose a password
              </a>
            </>
          )}

          {state.phase === "failed" && (
            <>
              <h1 className="text-2xl font-bold mb-1">That invitation didn&apos;t work</h1>
              <p className="text-muted text-sm mb-4">{state.message}</p>
              <p className="text-sm text-muted">
                Invitations last 14 days and can only be used by the address they were sent to. Ask whoever invited you to send a new one.
              </p>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
