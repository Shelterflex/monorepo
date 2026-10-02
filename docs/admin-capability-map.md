# Admin capability map: backend ↔ frontend (#1448)

Audit of every backend admin route module against the frontend surface that consumes
it. Method: enumerate `backend/src/routes/admin*.ts` + `settlementAdmin.ts` and their
mounts in `backend/src/app.ts`, then grep the frontend (`app/`, `lib/`, `components/`)
for the paths each one serves.

Snapshot date: 2026-07-30.

## 1. The map

| Backend module | Mounted at | Frontend surface | Status |
| --- | --- | --- | --- |
| `adminAnalytics.ts` | `/api/admin/analytics` | `app/admin/analytics`, `lib/adminAnalyticsApi.ts` | ✅ covered |
| `adminAuditLogs.ts` | `/api/v1/admin/audit-logs` | `app/admin/audit-logs`, `lib/auditLogsApi.ts` | ✅ covered |
| `adminOutbox.ts` | `/api/admin/outbox` | `app/dashboard/admin/outbox`, `lib/outboxAdminApi.ts` | ✅ covered |
| `admin-timelock.ts` | `/api/v1/admin/timelock` | `app/admin/timelock`, `lib/timelockApi.ts` | ✅ covered |
| `adminWhistleblowerApplications.ts` | `/api/admin/whistleblower-applications` | `app/admin/whistleblower-verification` | ✅ covered |
| `landlordVerification.ts` (admin half) | `/api/v1/admin/landlords/:id/verify` | `app/admin/landlords/[id]` | ✅ covered |
| `kyc.ts` (admin half) | `/api/kyc/admin` | `app/admin/kyc`, `app/admin/kyc/[submissionId]` | ✅ covered |
| `adminReconciliation.ts` | `/api/admin/reconciliation` | `app/admin/reconciliation`, `lib/reconciliationApi.ts` | ⚠️ partial — page exists; ledger-reconciliation endpoints unconsumed |
| `adminJobs.ts` | `/api/admin/jobs` | **`app/admin/health` → `components/admin/JobHealthPanel.tsx` (added in this PR)** | ✅ covered (health only; queue admin actions still API-only) |
| `adminFraud.ts` | `/api/admin/fraud` | — | ❌ no interface |
| `adminWithdrawals.ts` | `/api/admin` | — | ❌ no interface |
| `adminRisk.ts` | `/api/admin/risk` | — | ❌ no interface |
| `adminQuota.ts` | *(not mounted in `app.ts`)* | — | ❌ no interface, no mount |
| `adminSessions.ts` | `/api/admin/sessions` | — | ❌ no interface |
| `adminRoles.ts` | `/api/admin` | — | ❌ no interface |
| `adminUnderwriting.ts` | `/api/admin/underwriting` | — | ❌ no interface |
| `adminDataRetention.ts` | `/api/v1` | — | ❌ no interface |
| `adminErasure.ts` | `/api/admin/erasure` | — | ❌ no interface |
| `adminTransactionLedger.ts` | `/api/admin/transaction-ledger` | — | ❌ no interface |
| `adminAudit.ts` (chain verify) | `/api/admin/audit/verify` | — | ❌ no interface |
| `adminCreditScore.ts` / `adminTenantCreditScore.ts` | `/api/admin/credit-score`, `/api/admin` | — | ❌ no interface |
| `settlementAdmin.ts` | `/api/admin` | — | ❌ no interface |
| `admin.ts` (receipts, health-snapshot, alerts) | `/api/admin` | `app/admin/health` (snapshot + alerts) | ⚠️ partial — receipts unconsumed |

Frontend admin routes with **no** matching backend admin module: none. Every page under
`app/admin/` resolves to a live endpoint (see §3).

## 2. Missing surfaces, ranked by operational urgency

Ranking question: *what does an operator need during a live incident, at 2am, when
calling the API by hand is slowest and most error-prone?*

1. **Job / worker health** — "is scheduled work actually running?" is the first question
   in any staleness incident, and its failure mode is silence. **Implemented in this PR**
   (`GET /api/admin/jobs/health` + the Background jobs panel on `/admin/health`).
2. **`adminFraud`** — fraud review is time-critical: a flagged account left un-actioned is
   money leaving the platform. Highest remaining gap.
3. **`adminWithdrawals`** — approving or holding a withdrawal is the emergency stop for
   funds movement. Endpoints exist and are tested; there is no button.
4. **`adminSessions`** — revoking sessions is the containment step for a compromised
   account. Urgent but rarer.
5. **`adminRisk`** / **`adminUnderwriting`** — decisioning surfaces; important but they
   have a working manual path and are not incident-time.
6. **`adminRoles`** — privilege changes are deliberate, planned work.
7. **`adminQuota`** — *not mounted at all* in `app.ts`. A no-op today; the fix is a backend
   mount, which is out of scope here.
8. **`adminDataRetention` / `adminErasure` / `adminTransactionLedger` / `settlementAdmin` /
   credit-score** — compliance and back-office work with acceptable API-driven workflows.

This is more than one Wave cycle of frontend work. Per the issue's own guidance, this PR
delivers **the map plus the single highest-priority surface**, and proposes the rest as
follow-up issues (§5) rather than half-building six pages.

## 3. Broken admin pages

Checked every `fetch`/`api*` call under `app/admin/` against the mounted routes:

- No admin page was found calling an endpoint that no longer exists.
- `app/admin/health` calls `/api/admin/health-snapshot` and `/api/admin/alerts`, both live
  in `admin.ts`. Note it authenticates with `NEXT_PUBLIC_ADMIN_SECRET` — a secret shipped
  to the browser. It works, but see §4.
- `app/admin/reconciliation` consumes only part of the reconciliation surface;
  `/api/admin/ledger-reconciliation` has no consumer.

## 4. Server-side authorization, verified directly

Every module was read for its own guard rather than trusting the UI:

| Guard | Modules |
| --- | --- |
| Session + role/permission (`authenticateToken`, `requirePermission`, `requireRole`) | `adminAnalytics`, `adminAuditLogs`, `adminRisk`, `adminRoles`, `adminUnderwriting`, `adminWithdrawals`, `adminQuota`, `adminTenantCreditScore`, `adminDataRetention`, `adminOutbox`, `landlordVerification` (admin half), `kyc` (admin half) |
| Shared operator secret (`x-admin-secret` vs `MANUAL_ADMIN_SECRET`) | `admin`, `adminAudit`, `adminAuditLogs`, `adminErasure`, `adminFraud`, `adminJobs`, `adminReconciliation`, `adminSessions`, `adminTransactionLedger`, `settlementAdmin` |

Two findings worth acting on, both **backend** changes and therefore out of scope here:

- **The secret-guarded routes are unguarded when `MANUAL_ADMIN_SECRET` is unset.** The
  check is `if (env.MANUAL_ADMIN_SECRET && header !== ...) throw` — with no secret
  configured, every one of those routes is open. Safe in production only by configuration.
- **`GET /api/admin/receipts` requires only an ordinary authenticated session**, despite the
  `/admin` prefix. Already documented as such in `openapi.yml`; flagged here so it is not
  mistaken for an admin-gated route.

E2E coverage added in this PR asserts the session-guarded case directly — a non-admin
session is refused by the API, not merely shown a page without buttons
(`e2e/landlord/verification.spec.ts`).

## 5. Proposed follow-up issues

1. **Fraud review surface** for `adminFraud` — queue, case detail, action with confirmation.
2. **Withdrawal approval surface** for `adminWithdrawals` — approve/reject with a typed
   confirmation step, since it is irreversible and moves money.
3. **Session revocation surface** for `adminSessions`.
4. **Fail closed when `MANUAL_ADMIN_SECRET` is unset**, and move the browser-side
   `NEXT_PUBLIC_ADMIN_SECRET` behind a server route.
5. **Mount `adminQuota`** in `app.ts`, then build its surface.
6. **Add confirmation steps** to `/admin/timelock` cancel and `/admin/landlords/[id]`
   verification decisions, and make the decision reason mandatory.
7. **Enforce landlord verification**: nothing on the server currently reads
   `landlord_profiles.verification_level` as a gate (found while writing the #1432 spec,
   encoded there as a `test.fixme`).

## 6. Destructive actions: confirmation and audit

- Confirmed today: `/admin/kyc/[submissionId]` (approve/reject) and
  `/dashboard/admin/outbox` (retry / dead-letter) both gate the action behind an explicit
  confirmation step. The new job-health panel is read-only, so it needs none.
- **Not confirmed today, and they should be:** `/admin/timelock` cancels a queued
  operation with a single click, and `/admin/landlords/[id]` submits a verification
  decision without a confirmation step and with an optional rather than required reason.
  Both are state-changing and hard to undo. Added to the follow-ups (§5, item 6).
- Audit: destructive admin decisions route through `utils/auditLogger.ts` into the
  append-only `audit_log` table (update/delete rules in migration 008).
  `e2e/landlord/verification.spec.ts` asserts a decision reaches that table with the
  acting admin recorded.
