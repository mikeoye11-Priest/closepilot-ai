import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Integrations and Compatibility | ClosePilot",
  description: "See how ClosePilot works alongside IRIS, CCH, Digita, Xero, Sage and QuickBooks as the review layer for accounting practices.",
};

const systems = [
  { name: "IRIS Accounts Production", route: "Prepared-accounts export", status: "Regression tested", detail: "Representative trial-balance exports are checked automatically against ClosePilot's import rules." },
  { name: "CCH Accounts Production", route: "Prepared-accounts export", status: "Guided import", detail: "Import trial balance and supporting schedules using ClosePilot's guided column confirmation." },
  { name: "Digita Accounts Production", route: "Prepared-accounts export", status: "Guided import", detail: "Import prepared-account exports and confirm the suggested mapping before review." },
  { name: "Xero", route: "Connection or export", status: "Supported", detail: "Use the available connection workflow or import accounting exports into the review." },
  { name: "Sage", route: "Accounting export", status: "Regression tested", detail: "Representative Sage trial-balance exports are covered by automated import tests." },
  { name: "QuickBooks", route: "Accounting export", status: "Regression tested", detail: "Representative QuickBooks reports are covered by automated import tests." },
];

export default function CompatibilityPage() {
  return (
    <main className="min-h-screen bg-slate-50 text-slate-950">
      <nav className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-5 py-4">
          <Link href="/login" className="flex items-center gap-3 font-black"><span className="grid h-9 w-9 place-items-center rounded-lg bg-blue-700 text-sm text-white">CP</span>ClosePilot</Link>
          <div className="flex gap-2"><Link href="/login" className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-bold">Sign in</Link><Link href="/demo" className="rounded-lg bg-blue-700 px-4 py-2 text-sm font-bold text-white">View demo</Link></div>
        </div>
      </nav>

      <section className="mx-auto max-w-6xl px-5 py-16">
        <p className="text-xs font-black uppercase tracking-wider text-blue-700">Integrations and compatibility</p>
        <h1 className="mt-3 max-w-4xl text-4xl font-black tracking-tight sm:text-5xl">Keep your accounts production software. Add a consistent review layer.</h1>
        <p className="mt-5 max-w-3xl text-lg text-slate-600">ClosePilot works alongside the systems your practice already uses. Import prepared accounts, turn exceptions into evidence-backed findings, and produce a consistent partner sign-off pack.</p>

        <div className="mt-10 grid gap-3 rounded-2xl border border-blue-200 bg-blue-50 p-5 text-center font-black md:grid-cols-[1fr_auto_1fr_auto_1fr] md:items-center">
          <span>IRIS · CCH · Digita<br />Xero · Sage · QuickBooks</span><span className="text-blue-700">→</span><span>ClosePilot review</span><span className="text-blue-700">→</span><span>Partner sign-off pack</span>
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-5 pb-16">
        <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div className="border-b border-slate-200 p-6"><h2 className="text-2xl font-black">Compatible source systems</h2><p className="mt-2 text-slate-600">Choose the route that matches how your practice currently prepares accounts.</p></div>
          <div className="grid divide-y divide-slate-200">
            {systems.map((system) => (
              <article key={system.name} className="grid gap-3 p-6 md:grid-cols-[1fr_180px_160px_1.5fr] md:items-center">
                <strong>{system.name}</strong><span className="text-sm text-slate-600">{system.route}</span><span className="w-fit rounded-full bg-emerald-100 px-3 py-1 text-xs font-black text-emerald-800">{system.status}</span><p className="text-sm text-slate-600">{system.detail}</p>
              </article>
            ))}
          </div>
        </div>

        <div className="mt-6 rounded-xl border border-amber-200 bg-amber-50 p-5 text-sm text-amber-950"><strong>Compatibility means import support—not vendor endorsement.</strong> Unless explicitly described as a connection, ClosePilot works from files exported by the source system. CCH and Digita currently use guided import; their vendor-specific regression suites are planned.</div>
      </section>
    </main>
  );
}
