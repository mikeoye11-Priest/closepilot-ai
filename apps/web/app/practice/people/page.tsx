"use client";

export const dynamic = "force-dynamic";

import { useCallback, useEffect, useState } from "react";
import { FIRM_ROLES, roleLabel } from "@/lib/permissions";
import type { FirmRole, OrgUnit, TenantType } from "@/lib/types";
import { orgUnitLabel } from "@/lib/org-units";

type Member = { userId: string; email: string; status: string; roles: FirmRole[]; orgUnitIds: (string | null)[] };
type Invitation = { id: string; email: string; role: FirmRole; orgUnitId: string | null; expiresAt: string };

/**
 * Practice → People.
 *
 * The page reports what the caller may do from the server response rather than
 * inferring it, so the controls shown always match what the API will actually
 * allow. Hiding a button is a courtesy; /api/members/invite is the real gate.
 */
export default function PeoplePage() {
  const [tenant, setTenant] = useState<{ id: string; name: string; type: TenantType } | null>(null);
  const [orgUnits, setOrgUnits] = useState<OrgUnit[]>([]);
  const [members, setMembers] = useState<Member[]>([]);
  const [invitations, setInvitations] = useState<Invitation[]>([]);
  const [canManage, setCanManage] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const [email, setEmail] = useState("");
  const [role, setRole] = useState<FirmRole>("preparer");
  const [orgUnitId, setOrgUnitId] = useState("");
  const [sending, setSending] = useState(false);

  const load = useCallback(async () => {
    setError("");
    try {
      const workspaceRes = await fetch("/api/workspace");
      const workspace = workspaceRes.ok ? (await workspaceRes.json()).workspace : null;
      if (!workspace?.tenant?.id) {
        setError("No firm workspace found for your account.");
        setLoading(false);
        return;
      }
      setTenant(workspace.tenant);
      setOrgUnits(workspace.orgUnits ?? []);

      const res = await fetch(`/api/members?tenantId=${encodeURIComponent(workspace.tenant.id)}`);
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(payload.error ?? "Could not load the people in this firm.");
        setLoading(false);
        return;
      }
      setMembers(payload.members ?? []);
      setInvitations(payload.invitations ?? []);
      setCanManage(Boolean(payload.canManage));
    } catch {
      setError("Could not reach ClosePilot.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const [busy, setBusy] = useState("");

  // Every management action goes through one endpoint, so the UI does not need
  // to know which of them the server treats as privileged.
  const manage = async (payload: Record<string, unknown>, busyKey: string) => {
    if (!tenant) return;
    setError("");
    setNotice("");
    setBusy(busyKey);
    try {
      const res = await fetch("/api/members/manage", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...payload, tenantId: tenant.id })
      });
      const result = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(result.error ?? "That change could not be applied.");
        return;
      }
      await load();
    } catch {
      setError("Could not reach ClosePilot.");
    } finally {
      setBusy("");
    }
  };

  const invite = async () => {
    if (!tenant) return;
    setError("");
    setNotice("");
    setSending(true);
    try {
      const res = await fetch("/api/members/invite", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tenantId: tenant.id, email: email.trim(), role, orgUnitId: orgUnitId || null })
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(payload.error ?? "That invitation could not be sent.");
        return;
      }
      // An invitation that was recorded but not emailed is still usable, so
      // say so plainly rather than reporting a clean success.
      setNotice(payload.emailed
        ? `Invitation sent to ${email.trim()}.`
        : `Invitation created for ${email.trim()}, but the email could not be sent. They can still accept by signing in.`);
      setEmail("");
      await load();
    } finally {
      setSending(false);
    }
  };

  const unitName = (id: string | null) => (id ? orgUnits.find((unit) => unit.id === id)?.name ?? "Unknown" : null);
  const tenantType: TenantType = tenant?.type ?? "accounting_practice";
  const unitWord = orgUnitLabel(tenantType);

  if (loading) return <main className="p-6"><p className="text-sm text-muted">Loading…</p></main>;

  return (
    <main className="mx-auto max-w-4xl p-6">
      <h1 className="text-2xl font-bold">People</h1>
      <p className="mt-1 text-sm text-muted">{tenant?.name ?? "Your firm"} — who has access, and what they can do.</p>

      {error && <p className="mt-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm font-bold text-red-700">{error}</p>}
      {notice && <p className="mt-4 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm font-bold text-emerald-800">{notice}</p>}

      <section className="mt-6 rounded-xl border border-line bg-surface p-5 shadow-card">
        <h2 className="text-lg font-bold">Members</h2>
        {!members.length && <p className="mt-2 text-sm text-muted">No scope-based members yet.</p>}
        <ul className="mt-3 divide-y divide-line">
          {members.map((member) => (
            <li key={member.userId} className="flex flex-wrap items-center justify-between gap-2 py-3">
              <div className="min-w-0">
                <p className="truncate text-sm font-bold">{member.email || member.userId}</p>
                <p className="text-xs text-muted">
                  {member.roles.map((r) => roleLabel(r, tenantType)).join(", ") || "No role"}
                  {member.orgUnitIds.some((id) => id) && (
                    <> · {member.orgUnitIds.filter(Boolean).map((id) => unitName(id)).join(", ")}</>
                  )}
                  {member.orgUnitIds.includes(null) && <> · Whole firm</>}
                </p>
              </div>
              <div className="flex items-center gap-2">
                {member.status !== "active" && <span className="rounded-full bg-slate-100 px-2 py-1 text-xs font-bold text-muted">{member.status}</span>}
                {canManage && (
                  <>
                    <select
                      className="h-9 rounded-lg border border-line bg-white px-2 text-sm font-bold"
                      value={member.roles[0] ?? "preparer"}
                      disabled={busy === member.userId}
                      onChange={(event) => manage({ action: "set_role", userId: member.userId, role: event.target.value }, member.userId)}
                    >
                      {FIRM_ROLES.map((item) => <option key={item} value={item}>{roleLabel(item, tenantType)}</option>)}
                    </select>
                    <button
                      className="h-9 rounded-lg border border-line px-3 text-sm font-bold text-red hover:border-red disabled:opacity-60"
                      disabled={busy === member.userId}
                      onClick={() => {
                        // Removal revokes access and keeps the person's history,
                        // but it still signs somebody out of a live engagement.
                        if (confirm(`Remove ${member.email || "this member"} from ${tenant?.name ?? "the firm"}? Their review history is kept.`)) {
                          manage({ action: "remove_member", userId: member.userId }, member.userId);
                        }
                      }}
                    >
                      Remove
                    </button>
                  </>
                )}
              </div>
            </li>
          ))}
        </ul>
      </section>

      {invitations.length > 0 && (
        <section className="mt-5 rounded-xl border border-line bg-surface p-5 shadow-card">
          <h2 className="text-lg font-bold">Pending invitations</h2>
          <ul className="mt-3 divide-y divide-line">
            {invitations.map((invitation) => (
              <li key={invitation.id} className="flex flex-wrap items-center justify-between gap-2 py-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-bold">{invitation.email}</p>
                  <p className="text-xs text-muted">
                    {roleLabel(invitation.role, tenantType)}
                    {invitation.orgUnitId && <> · {unitName(invitation.orgUnitId)}</>}
                    {" · expires "}{new Date(invitation.expiresAt).toLocaleDateString("en-GB")}
                  </p>
                </div>
                {canManage && (
                  <button
                    className="h-9 rounded-lg border border-line px-3 text-sm font-bold text-red hover:border-red disabled:opacity-60"
                    disabled={busy === invitation.id}
                    onClick={() => manage({ action: "revoke_invitation", invitationId: invitation.id }, invitation.id)}
                  >
                    Revoke
                  </button>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      {canManage && (
        <section className="mt-5 rounded-xl border border-line bg-surface p-5 shadow-card">
          <h2 className="text-lg font-bold">Invite someone</h2>
          <div className="mt-3 grid gap-3 sm:grid-cols-[1fr_auto_auto_auto] sm:items-end">
            <label className="grid gap-1.5">
              <span className="text-sm font-bold text-muted">Email address</span>
              <input
                className="h-11 rounded-lg border border-line px-3 focus:border-brand focus:outline-none"
                type="email"
                placeholder="colleague@firm.com"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
              />
            </label>
            <label className="grid gap-1.5">
              <span className="text-sm font-bold text-muted">Role</span>
              <select
                className="h-11 rounded-lg border border-line bg-white px-3 text-sm font-bold"
                value={role}
                onChange={(event) => setRole(event.target.value as FirmRole)}
              >
                {FIRM_ROLES.map((item) => <option key={item} value={item}>{roleLabel(item, tenantType)}</option>)}
              </select>
            </label>
            <label className="grid gap-1.5">
              <span className="text-sm font-bold text-muted">{unitWord}</span>
              <select
                className="h-11 rounded-lg border border-line bg-white px-3 text-sm font-bold"
                value={orgUnitId}
                onChange={(event) => setOrgUnitId(event.target.value)}
              >
                <option value="">Whole firm</option>
                {orgUnits.map((unit) => <option key={unit.id} value={unit.id}>{unit.name}</option>)}
              </select>
            </label>
            <button
              className="h-11 rounded-lg bg-brand px-4 font-bold text-white disabled:opacity-60"
              onClick={invite}
              disabled={sending || !email.trim()}
            >
              {sending ? "Sending…" : "Send invite"}
            </button>
          </div>
          <p className="mt-3 text-xs text-muted">
            Invitations last 14 days and can only be accepted by the address they were sent to.
            You cannot grant a role above your own.
          </p>
        </section>
      )}
    </main>
  );
}
