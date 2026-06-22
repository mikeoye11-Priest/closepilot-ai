"use client";

export const dynamic = "force-dynamic";

import { useState } from "react";
import { createBrowserClient } from "@supabase/ssr";

function getSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return null;
  return createBrowserClient(url, key);
}

export default function LoginPage() {
  const [mode, setMode] = useState<"login" | "signup">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [firmName, setFirmName] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState("");

  const submit = async () => {
    setError("");
    const supabase = getSupabase();
    if (!supabase) {
      setError("Supabase is not configured. Add NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY to .env.local.");
      return;
    }
    setLoading(true);
    try {
      if (mode === "login") {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
        window.location.href = "/";
      } else {
        const { error } = await supabase.auth.signUp({
          email,
          password,
          options: { data: { firm_name: firmName } }
        });
        if (error) throw error;
        setDone("Check your email to confirm your account, then sign in.");
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-[#101827] p-4">
      <div className="w-full max-w-md">
        <div className="mb-8 flex items-center gap-3">
          <div className="grid h-12 w-12 place-items-center rounded-xl bg-gradient-to-br from-cyan-400 to-blue-600 font-black text-white text-lg">CP</div>
          <div>
            <strong className="block text-white text-xl">ClosePilot</strong>
            <span className="text-sm text-slate-400 font-semibold uppercase tracking-wide">Assurance Platform</span>
          </div>
        </div>

        <div className="rounded-2xl bg-white p-8 shadow-2xl">
          <h1 className="text-2xl font-black mb-1">{mode === "login" ? "Welcome back" : "Create your account"}</h1>
          <p className="text-muted text-sm mb-6">{mode === "login" ? "Sign in to your practice workspace." : "Set up your ClosePilot practice workspace."}</p>

          {done ? (
            <div className="rounded-lg bg-emerald-50 border border-emerald-200 p-4 text-emerald-800 text-sm font-semibold">{done}</div>
          ) : (
            <div className="grid gap-4">
              {mode === "signup" && (
                <label className="grid gap-1.5">
                  <span className="text-sm font-bold text-muted">Firm or company name</span>
                  <input className="h-11 rounded-lg border border-line px-3 focus:border-brand focus:outline-none" placeholder="Northbridge Advisory LLP" value={firmName} onChange={(e) => setFirmName(e.target.value)} />
                </label>
              )}
              <label className="grid gap-1.5">
                <span className="text-sm font-bold text-muted">Email address</span>
                <input className="h-11 rounded-lg border border-line px-3 focus:border-brand focus:outline-none" type="email" placeholder="you@firm.com" value={email} onChange={(e) => setEmail(e.target.value)} />
              </label>
              <label className="grid gap-1.5">
                <span className="text-sm font-bold text-muted">Password</span>
                <input className="h-11 rounded-lg border border-line px-3 focus:border-brand focus:outline-none" type="password" placeholder="••••••••" value={password} onChange={(e) => setPassword(e.target.value)} onKeyDown={(e) => e.key === "Enter" && submit()} />
              </label>

              {error && <p className="rounded-lg bg-red-50 border border-red-200 p-3 text-sm text-red-700 font-semibold">{error}</p>}

              <button className="h-11 rounded-lg bg-brand font-bold text-white disabled:opacity-60" onClick={submit} disabled={loading}>
                {loading ? "Please wait..." : mode === "login" ? "Sign in" : "Create account"}
              </button>
            </div>
          )}

          <p className="mt-6 text-center text-sm text-muted">
            {mode === "login" ? "Don't have an account?" : "Already have an account?"}{" "}
            <button className="font-bold text-brand" onClick={() => { setMode(mode === "login" ? "signup" : "login"); setError(""); setDone(""); }}>
              {mode === "login" ? "Sign up" : "Sign in"}
            </button>
          </p>
        </div>

        <p className="mt-6 text-center text-xs text-slate-500">Secure · Multi-tenant · Evidence-linked finance review</p>
      </div>
    </div>
  );
}
