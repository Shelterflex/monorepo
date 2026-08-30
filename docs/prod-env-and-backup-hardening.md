# Production env enforcement & backup-job hardening

Four related production-safety gaps in the backend. Three are missing
`NODE_ENV === 'production'` guards in [`backend/src/schemas/env.ts`](../backend/src/schemas/env.ts);
the fourth is an automated backup job that does not match the documented
recovery process.

| # | Area | Symptom if shipped as-is |
| --- | --- | --- |
| 1621 | `OTP_DELIVERY_PROVIDER` | OTPs logged to the server console, never delivered — nobody can log in |
| 1622 | `CORS_ORIGINS` | API only accepts `localhost:3000`; the real frontend is blocked |
| 1623 | `METRICS_TOKEN` | `/metrics` fails closed (401) forever; Prometheus scraping silently dead |
| 1620 | automated backup job | Unencrypted `pg_dump` files on local disk; no offsite copy |

---

## 1. `OTP_DELIVERY_PROVIDER` production enforcement (#1621)

`OTP_DELIVERY_PROVIDER: z.enum(['console', 'email']).default('console')`.
`'console'` only logs the OTP to the server console — correct for local dev,
useless in production. The schema already has a `.refine()` pattern for
production-required values (`WEBHOOK_SECRET`, `PAYSTACK_SECRET`,
`MANUAL_ADMIN_SECRET`, custodial keys). Add the same guard:

```ts
.refine((data) => {
  if (data.NODE_ENV !== 'production') return true
  return data.OTP_DELIVERY_PROVIDER === 'email'
}, {
  message:
    'OTP_DELIVERY_PROVIDER must be "email" in production ("console" only logs OTP codes to the server console)',
  path: ['OTP_DELIVERY_PROVIDER'],
})
```

The existing refine that requires `RESEND_API_KEY` + `RESEND_FROM_EMAIL` when
`OTP_DELIVERY_PROVIDER === 'email'` then chains automatically, so production
also requires working Resend credentials.

**Acceptance criteria**

- [ ] `NODE_ENV=production` with `OTP_DELIVERY_PROVIDER` unset or `console` fails validation at boot.
- [ ] Dev/test behaviour unchanged (`console` still the default).
- [ ] Error message names the variable and explains why.

---

## 2. `CORS_ORIGINS` production enforcement (#1622)

`CORS_ORIGINS: z.string().default('http://localhost:3000')` has no
production requirement. Left unset in production, the API rejects the real
frontend origin. Add:

```ts
.refine((data) => {
  if (data.NODE_ENV !== 'production') return true
  return !!data.CORS_ORIGINS && data.CORS_ORIGINS !== 'http://localhost:3000'
}, {
  message:
    'CORS_ORIGINS must be set to the real frontend origin(s) in production, not the localhost default',
  path: ['CORS_ORIGINS'],
})
```

**Acceptance criteria**

- [ ] `NODE_ENV=production` with `CORS_ORIGINS` unset or still the localhost default fails validation at boot.
- [ ] A real value (e.g. `https://app.shelterflex.io`) passes.
- [ ] Dev/test behaviour unchanged.

---

## 3. `METRICS_TOKEN` production enforcement (#1623)

`METRICS_TOKEN: z.string().optional()`. Per
[`docs/MONITORING.md`](MONITORING.md), `GET /metrics` needs it as a bearer
token. The handler in `backend/src/routes/prometheusMetrics.ts` already
fails closed (`!expectedToken` → `401`), so this is not a security hole —
but a production deploy that forgets it boots fine with metrics
permanently unreachable. Add:

```ts
.refine((data) => {
  if (data.NODE_ENV !== 'production') return true
  return !!data.METRICS_TOKEN
}, {
  message:
    'METRICS_TOKEN is required in production so the secured GET /metrics scrape endpoint is reachable',
  path: ['METRICS_TOKEN'],
})
```

**Acceptance criteria**

- [ ] `NODE_ENV=production` without `METRICS_TOKEN` fails validation at boot.
- [ ] Dev/test behaviour unchanged (endpoint stays 401 without a token).

### Tests for #1621–#1623

`backend/src/schemas/env.test.ts` currently has two production cases
(`accepts a valid contract id in production`, `... via USDC_TOKEN_ADDRESS
alias ...`) that do not set these three vars. When the refines above land,
those fixtures must also set:

```ts
CORS_ORIGINS: 'https://app.example.com',
OTP_DELIVERY_PROVIDER: 'email',
RESEND_API_KEY: 'resend',
RESEND_FROM_EMAIL: 'noreply@example.com',
METRICS_TOKEN: 'metrics-token',
```

Add one negative test per new rule (production + missing/default value →
`safeParse` fails with the matching `path`).

---

## 4. Automated backup job does not match the documented process (#1620)

[`docs/disaster-recovery-runbook.md`](disaster-recovery-runbook.md)
describes recovery built on `scripts/db-backup/backup.sh`, which does
`pg_dump | gzip | gpg --symmetric` (key: `BACKUP_ENCRYPTION_KEY`) and ships
to `s3://backup-primary/` and `s3://backup-secondary/`. That script is
correct and tested.

But the job that actually runs on a timer is
`backend/src/jobs/backupJob.ts` → `backend/src/scripts/backup.ts`
(`runBackup()`), which runs a bare `pg_dump -f ./backups/backup-<ts>.sql`:

- **not encrypted** — plaintext DB dump on the app server's local disk;
- **not offsite** — lost with the instance; a region outage takes the
  backups with it;
- **7-day local retention only**, vs. the runbook's 30-day offsite policy.

So the documented recovery process and the running one have diverged, and
`verify-backup.sh` (which expects `.sql.gz.gpg` in S3) has nothing to
verify.

### Remediation

Make the scheduled job run the documented pipeline instead of the toy dump:

- Have `runBackup()` (or `backupJob.ts`) invoke `scripts/db-backup/backup.sh`
  when `BACKUP_ENCRYPTION_KEY` is set, so the automated path produces the
  same encrypted, offsite `.sql.gz.gpg` artifact the runbook and
  `restore.sh` / `verify-backup.sh` expect.
- If `BACKUP_ENCRYPTION_KEY` is **not** set:
  - in production: fail the job loudly (log an error, surface a metric /
    alert) rather than silently writing an unencrypted local file;
  - in dev: keep the local `pg_dump` fallback, clearly logged as
    dev-only.
- After a successful run, log the artifact name and S3 target so
  `verify-backup.sh` can confirm it.
- Add `BACKUP_ENCRYPTION_KEY` (and any S3 target vars) to
  `backend/src/schemas/env.ts` with a production `.refine()`, matching the
  pattern in sections 1–3.
- Delete or clearly deprecate `backend/src/scripts/backup.ts`'s local-only
  path so the two implementations cannot drift again.

### Acceptance criteria

- [ ] The automated backup job produces an encrypted artifact via the
  documented `scripts/db-backup/backup.sh` pipeline.
- [ ] Backups are shipped offsite (S3 primary + secondary), not left only on
  local disk.
- [ ] In production, a missing `BACKUP_ENCRYPTION_KEY` fails the job/boot
  loudly instead of silently downgrading to an unencrypted local dump.
- [ ] `verify-backup.sh` can validate an artifact produced by the automated
  job.
