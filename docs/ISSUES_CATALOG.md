# Shelterflex Issue Catalog

This catalog lists well-scoped issues contributors can pick up across:

- `frontend/` (Next.js)
- `backend/` (Express API)
- `contracts/` (Soroban)

Each issue includes the goal, suggested labels, and what success looks like.

## How to use this catalog

1. Pick an issue that matches your skill level.
2. Create a GitHub issue using the templates in `.github/ISSUE_TEMPLATE/`.
3. Copy the relevant section from this catalog into the issue description.
4. Add the recommended labels.

---

## Frontend (Next.js) issues

### Good first issues

#### FE-1: Create a reusable `EmptyState` component

- **Type**: Feature
- **Labels**:
  - `area:frontend`
  - `type:feature`
  - `good first issue`
- **Goal**: Introduce a reusable empty-state component for pages with no data.
- **Scope**:
  - Add `components/empty-state.tsx` (or appropriate location)
  - Use it in at least 2 pages that currently show placeholder content
- **Definition of Done**:
  - Component supports title, description, optional action button, optional icon
  - Used in at least 2 routes
  - No visual regressions

#### FE-2: Add skeleton loading UI for a dashboard page

- **Type**: Feature
- **Labels**:
  - `area:frontend`
  - `type:feature`
  - `good first issue`
- **Goal**: Improve perceived performance by adding skeleton components.
- **Scope**:
  - Identify one dashboard route and create a skeleton variant
- **Definition of Done**:
  - Skeleton matches layout spacing of the real UI
  - Toggleable via a local `loading` state

#### FE-3: Fix inconsistent naming: “Shelterflex” vs “Shelterflex”

- **Type**: Chore
- **Labels**:
  - `area:frontend`
  - `type:chore`
  - `good first issue`
- **Goal**: Ensure consistent product naming across the UI.
- **Definition of Done**:
  - All user-facing strings use the agreed spelling
  - No broken links/routes introduced

### Intermediate issues

#### FE-4: Add API client wrapper for backend endpoints

- **Type**: Feature
- **Labels**:
  - `area:frontend`
  - `type:feature`
- **Goal**: Centralize backend calls (starting with `/health` and `/soroban/config`).
- **Scope**:
  - Add `lib/api/client.ts` with `fetchJson` wrapper
  - Add `lib/api/backend.ts` with typed functions
  - Add a small UI panel/page to display backend + soroban config
- **Definition of Done**:
  - Errors handled with user-friendly messages
  - Functions are typed
  - No direct `fetch("http://...")` scattered in components

#### FE-5: Introduce environment-based configuration

- **Type**: Chore/Feature
- **Labels**:
  - `area:frontend`
  - `type:feature`
- **Goal**: Add `NEXT_PUBLIC_BACKEND_URL` and document it.
- **Definition of Done**:
  - FE reads backend base URL from env
  - `.env.example` added to `frontend/`
  - README updated

### Advanced issues

#### FE-6: Soroban wallet connect flow (UI + state)

- **Type**: Feature
- **Labels**:
  - `area:frontend`
  - `type:feature`
- **Goal**: Implement a wallet connect UX for Stellar/Soroban.
- **Notes**: Final choice of wallet provider (e.g., Freighter) should be agreed in the issue.
- **Definition of Done**:
  - Connect/disconnect supported
  - Connected address displayed in UI
  - State persists on refresh (if appropriate)
  - Clear error handling (wallet not installed, user rejected, wrong network)

---

## Backend (Express) issues

### Good first issues

#### BE-1: Add request validation + consistent error responses

- **Type**: Feature
- **Labels**:
  - `area:backend`
  - `type:feature`
  - `good first issue`
- **Goal**: Add a helper for consistent API errors.
- **Scope**:
  - Create a `src/http/errors.ts`
  - Ensure routes return a consistent JSON shape
- **Definition of Done**:
  - Errors include `code`, `message`, and optional `details`
  - Example used by at least one endpoint

#### BE-2: Add a `/version` endpoint

- **Type**: Feature
- **Labels**:
  - `area:backend`
  - `type:feature`
  - `good first issue`
- **Goal**: Expose service metadata.
- **Definition of Done**:
  - Returns service name, version, git sha (if available), environment

### Intermediate issues

#### BE-3: Add Soroban RPC “ping” endpoint

- **Type**: Feature
- **Labels**:
  - `area:backend`
  - `type:feature`
- **Goal**: Add an endpoint that verifies Soroban RPC reachability.
- **Definition of Done**:
  - `GET /soroban/ping` checks RPC URL and returns latency and network passphrase
  - Timeouts handled gracefully

#### BE-4: Add a typed config module and startup validation

- **Type**: Chore
- **Labels**:
  - `area:backend`
  - `type:chore`
- **Goal**: Fail fast on misconfigured env.
- **Definition of Done**:
  - Config module returns a typed config object
  - Server fails to start if required variables are missing

### Advanced issues

#### BE-5: Build a Soroban transaction submission service

- **Type**: Feature
- **Labels**:
  - `area:backend`
  - `type:feature`
- **Goal**: Provide a backend endpoint that builds/submits transactions.
- **Definition of Done**:
  - Clear separation between HTTP route and tx builder
  - Logs include tx hash and failure reasons
  - Includes test strategy (unit tests or reproducible manual test plan)

---

## Contracts (Soroban) issues

### Good first issues

#### SC-1: Add tests for `rent_wallet` credit/debit behavior

- **Type**: Feature
- **Labels**:
  - `area:contracts`
  - `type:feature`
  - `good first issue`
- **Goal**: Add Soroban unit tests.
- **Definition of Done**:
  - Tests cover:
    - init once
    - credit increases balance
    - debit decreases balance
    - debit fails if insufficient
    - admin auth required

#### SC-2: Emit consistent events for all state transitions

- **Type**: Chore/Feature
- **Labels**:
  - `area:contracts`
  - `type:chore`
  - `good first issue`
- **Goal**: Standardize event topics and payloads.
- **Definition of Done**:
  - Event topics documented in `contracts/README.md`
  - All methods that mutate state emit an event

### Intermediate issues

#### SC-3: Add “pause” mechanism to prevent credit/debit

- **Type**: Feature
- **Labels**:
  - `area:contracts`
  - `type:feature`
- **Goal**: Add a pausability control for emergency stops.
- **Definition of Done**:
  - `pause()` and `unpause()` admin-auth
  - `credit` and `debit` fail when paused
  - Tests cover pause/unpause

#### SC-4: Add per-user monthly spending cap

- **Type**: Feature
- **Labels**:
  - `area:contracts`
  - `type:feature`
- **Goal**: Restrict debit amount per user per period.
- **Definition of Done**:
  - New storage key(s) for caps and accounting
  - Clear behavior when cap exceeded
  - Tests included

### Advanced issues

#### SC-5: Design a rent payment schedule contract

- **Type**: Feature
- **Labels**:
  - `area:contracts`
  - `type:feature`
- **Goal**: Model rent schedules, due dates, and payment status on-chain.
- **Definition of Done**:
  - Contract methods documented
  - Access control defined
  - Events for schedule creation and payment updates
  - Tests cover core flows

---

## Cross-cutting issues

### DX-1: Add a root-level setup checker script

- **Type**: Chore
- **Labels**:
  - `type:chore`
- **Goal**: Provide a script that checks Node/Rust/Soroban CLI versions and prints next steps.
- **Definition of Done**:
  - Script runs on macOS
  - Clear output for missing prerequisites
