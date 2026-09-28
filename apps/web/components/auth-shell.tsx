import type { ReactNode } from "react";

export function AuthShell({
  title,
  subtitle,
  children,
  footer
}: {
  title: string;
  subtitle: string;
  children: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-[#101827] p-4">
      <div className="w-full max-w-md">
        <div className="mb-8 flex items-center gap-3">
          <div className="grid h-12 w-12 place-items-center rounded-xl bg-gradient-to-br from-cyan-400 to-blue-600 font-black text-white text-lg">CP</div>
          <div>
            <strong className="block text-white text-xl">ClosePilot</strong>
            <span className="text-sm text-slate-400 font-semibold uppercase tracking-wide">System of Review</span>
          </div>
        </div>

        <div className="rounded-2xl bg-white p-8 shadow-2xl">
          <h1 className="text-2xl font-black mb-1">{title}</h1>
          <p className="text-muted text-sm mb-6">{subtitle}</p>
          {children}
          {footer && <p className="mt-6 text-center text-sm text-muted">{footer}</p>}
        </div>

        <p className="mt-6 text-center text-xs text-slate-400">Standardise review and partner sign-off without replacing your accounts production software.</p>
        <p className="mt-2 text-center text-xs text-slate-500"><a className="underline hover:text-slate-300" href="/compatibility">View integrations and compatibility</a></p>
        <p className="mt-2 text-center text-xs text-slate-500"><a className="underline hover:text-slate-300" href="/terms">Terms</a> · <a className="underline hover:text-slate-300" href="/privacy">Privacy</a></p>
      </div>
    </div>
  );
}
