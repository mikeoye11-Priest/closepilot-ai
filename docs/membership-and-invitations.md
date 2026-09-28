# Membership and invitations — design

**Status:** proposal, no code written. Written to be argued with before implementation.

## The problem

ClosePilot is single-login-per-firm today.

`bootstrap_workspace` inserts a `user_company_access` row for the calling user
and nobody else, and there is no invite UI or API anywhere in the app. So there
is no way for a second person to reach a firm's workspace.

That matters now for two reasons:

- `docs/pilot-1/01-staging-access.md` asks for a **partner, manager and
  preparer** to be named and their access tested. The pilot assumes multi-user.
- A practice of 15 branches with 100+ clients each is by definition many
  people. One login is not a small limitation at that size.

## The bigger problem underneath

`user_company_access` grants **one row per user per company**.

That model cannot express what a firm actually wants to say:

- "Priya manages the Manchester branch" becomes 100 rows, and breaks the moment
  Manchester takes on its 101st client — the new client is invisible to her
  until someone backfills a row.
- "Tom is a partner and sees everything" becomes 1,500 rows, and is wrong again
  tomorrow.

Per-company grants are the right shape for a *client-side* user (an SME seeing
only their own entity) and the wrong shape for staff. Adding invitations on top
of the current model would bake the wrong thing in, so the access model should
change first.

## Proposal

### 1. Scope-based access

Add grants at the level a firm thinks in, keeping per-company grants for the
cases that genuinely need them.

```sql
create table user_scope_access (
  user_id     uuid not null references users(id) on delete cascade,
  tenant_id   uuid not null references tenants(id) on delete cascade,
  -- null = the whole tenant; set = one branch or division
  org_unit_id uuid null,
  role        text not null,
  primary key (user_id, tenant_id, coalesce(org_unit_id, '00000000-0000-0000-0000-000000000000'))
);
```

Then widen the existing helper rather than replacing it, so every RLS policy
already written keeps working unchanged:

```sql
create or replace function has_company_access(p_tenant_id uuid, p_company_id uuid)
-- true when the user has EITHER
--   a) the existing per-company row, OR
--   b) a tenant-wide scope grant, OR
--   c) a scope grant on the org unit this company belongs to
```

This is why the org-unit layer in #133 comes first: it is what "the Manchester
branch" resolves to. A new client added to Manchester is visible to Manchester's
manager immediately, with nothing to backfill.

### 2. Roles

Reconcile two vocabularies that already disagree. `lib/types.ts` says
`practice_admin | manager | reviewer | client_user`; the pilot pack says
Partner, Manager, Preparer.

Proposed set, with the pilot's words as the labels:

| Role | Label (practice) | Can |
|---|---|---|
| `practice_admin` | Partner | Everything, including invite and sign off |
| `manager` | Manager | Review, approve, return; not invite |
| `preparer` | Preparer | Upload, prepare, request evidence; not approve |
| `client_user` | Client | See only their own entity |

`reviewer` is renamed `preparer` to match what the pilot pack and the review
workflow already call that person. For a company tenant the same roles read as
Owner / Finance lead / Analyst — a labelling concern, as with org units.

Only `practice_admin` may invite. Nobody may grant a role above their own.

### 3. Invitations

```sql
create table firm_invitations (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references tenants(id) on delete cascade,
  email       text not null,
  role        text not null,
  org_unit_id uuid null,          -- scope the invite to one branch
  invited_by  uuid not null references users(id),
  status      text not null default 'pending',  -- pending | accepted | revoked
  expires_at  timestamptz not null default now() + interval '14 days',
  created_at  timestamptz not null default now(),
  accepted_at timestamptz
);

create unique index firm_invitations_pending_email_idx
  on firm_invitations (tenant_id, lower(email)) where status = 'pending';
```

**Flow**

1. A partner enters an email, picks a role, and optionally scopes it to a branch.
2. The server writes a `pending` row and calls Supabase
   `auth.admin.inviteUserByEmail` (needs `SUPABASE_SERVICE_ROLE_KEY`, which
   production already has — `backgroundWorker: true` in `/api/health` depends
   on it).
3. Supabase emails the invitee, who sets a password and lands in the app.
4. On first load the server matches their **verified** auth email to a pending
   invitation, then creates the `users` row and the `user_scope_access` grant,
   and marks the invitation accepted.

Matching on the auth email is only safe because Supabase's invite link proves
control of that address. The invitation must never be redeemable by a
self-registered account that merely claims the email.

Acceptance must be idempotent — a double-click on the link must not produce two
grants — and expiry is checked at acceptance, not only at send.

### 4. Where it surfaces

A **Practice → People** page: list members with role and scope, invite, revoke a
pending invitation, change a role, remove a member. Reachable only by
`practice_admin`.

Once #133's shared shell is in, an invited user who signs in already loads the
firm rather than being pushed into onboarding — that part is done.

## Consequences and open questions

**One tenant per user.** `users.tenant_id` is a single column and `users.email`
is globally unique, so a person cannot belong to two firms. That is probably
fine for a practice, but it blocks an accountant who consults for two of them,
and it blocks a ClosePilot facilitator holding access to several pilot firms —
which the pilot pack's "ClosePilot facilitator" row implies. **Decision needed:**
accept the limit for now, or make membership many-to-many from the start. Making
it many-to-many later is a painful migration.

**Removing a member** must not delete their audit trail. Findings, comments and
sign-offs reference users; removal should revoke access and mark the user
inactive, never cascade-delete. The existing `users.status` column supports
this.

**Client users** are the one case where per-company grants stay right, so both
paths need to coexist rather than one replacing the other.

**Email deliverability** becomes a support surface the moment invitations exist.
The Supabase default sender is rate-limited and lands in spam more often than a
configured domain; worth checking before a firm's staff depend on it.

## Suggested order

1. `user_scope_access` + widened `has_company_access` (no UI) — the foundation,
   and independently useful.
2. `firm_invitations` + send/accept endpoints.
3. Practice → People UI.
4. Role enforcement in the review workflow — worth auditing separately, since
   approve/sign-off currently trusts the single user.

Steps 1 and 2 are what the pilot needs. Step 4 is the one most likely to hide
surprises, because the workflow was written when there was only ever one user.
