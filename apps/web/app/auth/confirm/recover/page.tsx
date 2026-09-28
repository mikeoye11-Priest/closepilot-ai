"use client";

export const dynamic = "force-dynamic";

import { useEffect, useState } from "react";
import { createBrowserClient } from "@supabase/ssr";
import { authErrorMessage } from "@/lib/auth-errors";

/**
 * Completes a recovery link whose token arrived in the URL fragment.
 *
 * Supabase's stock {{ .ConfirmationURL }} template returns an implicit-flow
 * session as #access_token=...&refresh_token=..., and a fragment is never sent
 * to the server. /auth/confirm therefore sees a bare path and cannot act, so it
 * forwards here, where the fragment is readable.
 *
 * This is a compatibility path, not the intended one. The token-hash template
 * is what makes recovery work across devices; this exists so recovery does not
 * break when that template is missing, wrong, or silently reverted — which is
 * exactly what happened in practice.
 *
 * It also closes the original bug: the fragment used to be consumed by whatever
 * page happened to load, quietly establishing a session and skipping the
 * password form entirely, so a "reset" left the old password in place.
 */
export default function RecoverFromFragmentPage() {
  const [error, setError] = useState("");

  useEffect(() => {
    const run = async () => {
      const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
      const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
      if (!url || !key) {
        setError("Supabase is not configured.");
        return;
      }

      // Strip the leading '#'. Nothing here is logged or sent anywhere: the
      // tokens go straight into the Supabase client.
      const hash = new URLSearchParams(window.location.hash.replace(/^#/, ""));
      const accessToken = hash.get("access_token");
      const refreshToken = hash.get("refresh_token");
      const hashError = hash.get("error_description") ?? hash.get("error");

      const params = new URLSearchParams(window.location.search);
      const requestedNext = params.get("next") ?? "/update-password";
      // Relative paths only, as on the server side.
      const safeNext = requestedNext.startsWith("/") && !requestedNext.startsWith("//")
        ? requestedNext
        : "/update-password";

      // Supabase puts the link's purpose in the fragment too. A recovery link
      // MUST end at the password form: the stock template sends no `next`, so
      // this would otherwise fall back to "/" and drop the user straight into
      // the workspace — signed in, password unchanged. That is the original
      // bug this whole flow exists to fix, so recovery overrides `next`.
      const linkType = hash.get("type");
      const next = linkType === "recovery" ? "/update-password" : safeNext;

      if (hashError) {
        setError(authErrorMessage("link_invalid") ?? "That link could not be verified.");
        return;
      }
      if (!accessToken || !refreshToken) {
        setError(authErrorMessage("link_missing") ?? "That link was incomplete.");
        return;
      }

      const supabase = createBrowserClient(url, key);
      const { error: sessionError } = await supabase.auth.setSession({
        access_token: accessToken,
        refresh_token: refreshToken
      });

      if (sessionError) {
        setError(authErrorMessage("link_expired") ?? "That link has expired.");
        return;
      }

      // Replace rather than push, so Back cannot return to a URL still
      // carrying the tokens in its fragment.
      window.location.replace(next);
    };

    run();
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
          {error ? (
            <>
              <h1 className="text-2xl font-bold mb-1">That link didn&apos;t work</h1>
              <p className="text-muted text-sm mb-4">{error}</p>
              <a className="font-bold text-brand" href="/forgot-password">Request a new link</a>
            </>
          ) : (
            <>
              <h1 className="text-2xl font-bold mb-1">Checking your link</h1>
              <p className="text-muted text-sm">One moment.</p>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
