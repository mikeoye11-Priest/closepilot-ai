import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Terms of Service | ClosePilot",
  description: "The terms that govern your use of ClosePilot, the review and accounts-production platform for accounting practices and finance teams.",
};

const UPDATED = "22 July 2026";
const ENTITY = "Zequence Digital Ltd";
const CONTACT = "support@closepilot.ai";

function Nav() {
  return (
    <nav className="border-b border-slate-200 bg-white">
      <div className="mx-auto flex max-w-4xl items-center justify-between px-5 py-4">
        <Link href="/login" className="flex items-center gap-3 font-black"><span className="grid h-9 w-9 place-items-center rounded-lg bg-blue-700 text-sm text-white">CP</span>ClosePilot</Link>
        <div className="flex gap-3 text-sm font-bold"><a href="/privacy" className="text-slate-600 hover:text-slate-950">Privacy</a><Link href="/login" className="rounded-lg border border-slate-300 px-4 py-2">Sign in</Link></div>
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

export default function TermsPage() {
  return (
    <main className="min-h-screen bg-slate-50 text-slate-950">
      <Nav />
      <article className="mx-auto max-w-4xl px-5 py-14">
        <p className="text-xs font-black uppercase tracking-wider text-blue-700">Terms of Service</p>
        <h1 className="mt-3 text-4xl font-black tracking-tight">Terms of Service</h1>
        <p className="mt-3 text-sm text-slate-500">Last updated: {UPDATED}</p>

        <Section title="1. Agreement">
          <p>These terms govern your use of ClosePilot, operated by {ENTITY} (&ldquo;ClosePilot&rdquo;, &ldquo;we&rdquo;, &ldquo;us&rdquo;). By creating an account or using the service you agree to these terms. If you use ClosePilot on behalf of an organisation, you confirm you are authorised to accept these terms for it.</p>
        </Section>

        <Section title="2. The service">
          <p>ClosePilot is a review and accounts-production platform. It runs automated checks over accounting data you provide, reconciles and validates figures, and produces outputs such as review findings, VAT assurance, and draft management and financial accounts. It works alongside your existing accounting and accounts-production software; it does not replace your books of account.</p>
        </Section>

        <Section title="3. Outputs are drafts for professional review">
          <p><strong>All accounts, tax computations, corporation-tax returns, iXBRL, VAT figures, narratives and other outputs are drafts, prepared for review by a qualified professional.</strong> They are generated automatically from the data available to ClosePilot and are not accounting, tax, audit, or legal advice. You remain responsible for reviewing and approving any output before it is relied upon, issued, filed or submitted to any authority (including HMRC and Companies House). AI-drafted narrative is grounded in your figures and labelled as such, and must be reviewed before issue.</p>
        </Section>

        <Section title="4. Your responsibilities">
          <p>You are responsible for the accuracy and lawfulness of the data you upload or connect, for having the right to use it, and for the professional judgement applied to ClosePilot&rsquo;s outputs. You must keep your login credentials secure and are responsible for activity under your account.</p>
        </Section>

        <Section title="5. Connected accounting systems">
          <p>Where you connect a third-party system (for example Xero or QuickBooks Online), you authorise ClosePilot to access the data described at the point of connection, on a read-only basis. You may disconnect at any time. Your use of those third-party systems is governed by their own terms.</p>
        </Section>

        <Section title="6. Acceptable use">
          <p>You agree not to misuse the service: no unlawful use, no attempts to breach security or access data that is not yours, no reverse engineering, and no use that infringes the rights of others.</p>
        </Section>

        <Section title="7. Intellectual property">
          <p>ClosePilot and its software remain our property. You retain ownership of the data you provide. You grant us the limited rights needed to process that data to provide the service.</p>
        </Section>

        <Section title="8. Disclaimers">
          <p>The service is provided &ldquo;as is&rdquo; and &ldquo;as available&rdquo;. To the extent permitted by law, we exclude implied warranties. We do not warrant that outputs are complete, accurate or fit for filing without professional review, or that the service will be uninterrupted or error-free.</p>
        </Section>

        <Section title="9. Limitation of liability">
          <p>To the extent permitted by law, we are not liable for indirect or consequential loss, or for loss arising from your reliance on an output without appropriate professional review. Nothing in these terms limits liability that cannot be limited by law.</p>
        </Section>

        <Section title="10. Termination">
          <p>You may stop using ClosePilot and close your account at any time. We may suspend or terminate access for breach of these terms or to protect the service. On termination we handle your data as described in our <a href="/privacy" className="font-semibold text-blue-700">Privacy Policy</a>.</p>
        </Section>

        <Section title="11. Governing law">
          <p>These terms are governed by the laws of England and Wales, and disputes are subject to the exclusive jurisdiction of its courts.</p>
        </Section>

        <Section title="12. Changes">
          <p>We may update these terms from time to time. We will change the date above and, where changes are material, notify you. Continued use after changes take effect constitutes acceptance.</p>
        </Section>

        <Section title="13. Contact">
          <p>Questions about these terms? Email <a className="font-semibold text-blue-700" href={`mailto:${CONTACT}`}>{CONTACT}</a>.</p>
        </Section>
      </article>
    </main>
  );
}
