import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Privacy Policy | ClosePilot",
  description: "How ClosePilot collects, uses, stores and protects your data, including accounting data connected via Xero and QuickBooks Online.",
};

const UPDATED = "22 July 2026";
// Placeholders to confirm before this is treated as final: the operating legal
// entity, registered address, and contact addresses.
const ENTITY = "Zequence Digital Ltd";
const CONTACT = "privacy@closepilot.ai";

function Nav() {
  return (
    <nav className="border-b border-slate-200 bg-white">
      <div className="mx-auto flex max-w-4xl items-center justify-between px-5 py-4">
        <Link href="/login" className="flex items-center gap-3 font-black"><span className="grid h-9 w-9 place-items-center rounded-lg bg-blue-700 text-sm text-white">CP</span>ClosePilot</Link>
        <div className="flex gap-3 text-sm font-bold"><a href="/terms" className="text-slate-600 hover:text-slate-950">Terms</a><Link href="/login" className="rounded-lg border border-slate-300 px-4 py-2">Sign in</Link></div>
      </div>
    </nav>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-8">
      <h2 className="text-xl font-black text-slate-950">{title}</h2>
      <div className="mt-3 space-y-3 text-slate-700">{children}</div>
    </section>
  );
}

export default function PrivacyPage() {
  return (
    <main className="min-h-screen bg-slate-50 text-slate-950">
      <Nav />
      <article className="mx-auto max-w-4xl px-5 py-14">
        <p className="text-xs font-black uppercase tracking-wider text-blue-700">Privacy Policy</p>
        <h1 className="mt-3 text-4xl font-black tracking-tight">Your data, and how we protect it</h1>
        <p className="mt-3 text-sm text-slate-500">Last updated: {UPDATED}</p>

        <Section title="1. Who we are">
          <p>ClosePilot is a review and accounts-production platform for accounting practices and finance teams, operated by {ENTITY} (&ldquo;ClosePilot&rdquo;, &ldquo;we&rdquo;, &ldquo;us&rdquo;). We are the data controller for the personal data described in this policy. You can contact us at <a className="font-semibold text-blue-700" href={`mailto:${CONTACT}`}>{CONTACT}</a>.</p>
        </Section>

        <Section title="2. What data we collect">
          <p><strong>Account data</strong> — your name, email and workspace/company details when you register.</p>
          <p><strong>Accounting data</strong> — the financial records you connect or upload for review, such as the trial balance, profit &amp; loss, balance sheet, aged debtors and creditors, bank data, and VAT/tax transactions. This data is drawn from files you upload or from accounting systems you connect (for example Xero or QuickBooks Online).</p>
          <p><strong>Technical data</strong> — log, device and usage information generated when you use the service, used to keep it secure and reliable.</p>
        </Section>

        <Section title="3. How we use your data">
          <p>We use your data solely to provide the service: to run automated review checks, reconcile and validate your figures, produce management and financial accounts and related outputs, and let you and your colleagues collaborate on findings. We do <strong>not</strong> sell your data or use it for advertising.</p>
        </Section>

        <Section title="4. Legal basis (UK GDPR)">
          <p>We process personal data to perform our contract with you, on the basis of your consent where you connect a third-party accounting system, and for our legitimate interests in securing and improving the service.</p>
        </Section>

        <Section title="5. Connected accounting systems">
          <p>When you connect Xero or QuickBooks Online, you authorise ClosePilot to read the accounting data needed for the review. We request <strong>read-only</strong> access and only the scopes required. Access and refresh tokens are <strong>encrypted at rest</strong> and used only to fetch your data when you run a sync. You can <strong>disconnect at any time</strong> from Settings, which stops further access; we do not modify your accounting records.</p>
        </Section>

        <Section title="6. How we store and protect your data">
          <p>Data is stored in a managed PostgreSQL database (Supabase) with <strong>row-level security</strong> scoping records to your workspace. All data is encrypted <strong>in transit</strong> (TLS/HTTPS) and <strong>at rest</strong>, and OAuth tokens are additionally encrypted at the application layer. Access is restricted and authenticated. We do not store payment-card data.</p>
        </Section>

        <Section title="7. Service providers (sub-processors)">
          <p>We share data only with providers that help us run the service, under appropriate agreements: <strong>Supabase</strong> (database &amp; authentication), <strong>Vercel</strong> (application hosting), <strong>Sentry</strong> (error monitoring), and <strong>Google</strong> (the Gemini model, used only to draft narrative commentary that is grounded strictly in your figures — it does not source or invent numbers). Your accounting data comes from <strong>Xero</strong> and <strong>Intuit (QuickBooks Online)</strong> when you connect them. AI-drafted narrative is always labelled and intended for your review before issue.</p>
        </Section>

        <Section title="8. Data retention">
          <p>We retain your data for as long as your account is active or as needed to provide the service. You can ask us to delete your data, and disconnecting an accounting system removes our ability to access it. On account closure we delete or anonymise your data within a reasonable period, unless we must retain it to meet a legal obligation.</p>
        </Section>

        <Section title="9. Your rights">
          <p>Under UK data-protection law you have the right to access, correct, delete, port or object to the processing of your personal data, and to withdraw consent. To exercise these rights, contact us at <a className="font-semibold text-blue-700" href={`mailto:${CONTACT}`}>{CONTACT}</a>. You also have the right to complain to the Information Commissioner&rsquo;s Office (ICO).</p>
        </Section>

        <Section title="10. International transfers">
          <p>Where a service provider processes data outside the UK/EEA, we rely on appropriate safeguards (such as UK/EU standard contractual clauses) to protect it.</p>
        </Section>

        <Section title="11. Cookies">
          <p>We use only the cookies necessary to keep you signed in and the service secure. We do not use advertising or third-party tracking cookies.</p>
        </Section>

        <Section title="12. Changes to this policy">
          <p>We may update this policy from time to time. We will change the date above and, where changes are material, notify you.</p>
        </Section>

        <Section title="13. Contact">
          <p>Questions about this policy or your data? Email <a className="font-semibold text-blue-700" href={`mailto:${CONTACT}`}>{CONTACT}</a>.</p>
        </Section>
      </article>
    </main>
  );
}
