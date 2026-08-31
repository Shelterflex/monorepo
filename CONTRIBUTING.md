# Contributing to Shelterflex

Thanks for contributing. Shelterflex is a **Rent Now, Pay Later (RNPL)** platform for rental markets — tenants pay a deposit upfront and repay the balance in installments, while landlords list properties directly. The platform relies on smart contracts for payments, escrow, staking, and a whistleblower rewards programme.

This repo is intentionally split into **3 projects** (`frontend/`, `backend/`, `contracts/`) so you can contribute to one area without needing to touch the others.

If you're looking for tasks to pick up, start with `docs/ISSUES_CATALOG.md`.

## Ways to contribute

- Frontend: UI, UX, routing, components, state management, integration with backend and Soroban
- Backend: API design, validation, auth, persistence, Soroban RPC integration, monitoring
- Contracts: Soroban smart contracts, tests, deployment scripts, security hardening
- Whistleblower programme: reward allocation logic, earnings dashboard, reporting flows

## Ground rules

- Keep PRs small and focused (1 issue per PR).
- Write clear commit messages.
- Add/adjust tests where it makes sense.
- Don’t commit secrets (`.env` files, private keys, seed phrases).

## Repo layout

- `frontend/` - Next.js app
- `backend/` - Express API
- `contracts/` - Soroban contracts (Rust)

## Development setup

This repository has three independently tool-chained projects. Use the package manager and version below that matches CI.

### Prerequisites

- Node.js 22.x (CI uses Node 22)
- pnpm 9.15.5 for the frontend
- npm for the backend (CI uses `npm ci`)
- Rust stable with `rustfmt` and `clippy` for the contracts workspace
- Docker Desktop (optional, but useful for PostgreSQL and the full-stack compose setup)

### Frontend setup (pnpm, Node 22)

```bash
cd frontend
corepack enable
pnpm install --frozen-lockfile
pnpm run lint
pnpm run build
```

- The frontend uses pnpm, not npm.
- `frontend/pnpm-lock.yaml` is the only lockfile. Do not run `npm install` in this
  directory; it would create a `package-lock.json` that drifts from what CI validates.

### Backend setup (npm, Node 22)

```bash
cd backend
npm ci
cp .env.example .env
# Optional but recommended for local API development:
docker compose up postgres -d
npm run lint
npm run test:ci
npm run openapi:validate
```

The backend uses npm, not pnpm. The CI job runs `npm ci` and then the lint/test/OpenAPI checks below.

Required environment variables for local backend work:

- `cp .env.example .env` to create a local environment file.
- `DATABASE_URL` is required for the API server. The default example points at a local PostgreSQL instance.
- `ENCRYPTION_KEY` is required for local encryption helpers; the example value is fine for local development.
- `CUSTODIAL_WALLET_MASTER_KEY_V1` and `CUSTODIAL_WALLET_MASTER_KEY_V2` can be left empty for basic local development, but wallet-related flows will need real values.
- `RESEND_API_KEY` can stay empty; OTP delivery defaults to the console provider.

For local development, the easiest path is to start PostgreSQL and then run the API:

```bash
cd backend
cp .env.example .env
docker compose up postgres -d
npm run dev
```

The CI test command (`npm run test:ci`) excludes the network-dependent suites, so it does not require external Soroban or webhook services to pass.

### Contracts setup (Rust stable + fmt/clippy)

```bash
cd contracts
rustup toolchain install stable
rustup component add rustfmt clippy
cargo fmt --all -- --check
cargo clippy --workspace --all-targets --all-features
cargo test --workspace
```

For Soroban CLI deployment instructions see `contracts/README.md`.

## Before opening a PR (required checks)

Run the CI-equivalent commands from the matching directory before you push:

### Frontend checks

```bash
cd frontend
pnpm install --frozen-lockfile
pnpm run lint
pnpm run build
```

### Backend checks

```bash
cd backend
npm ci
npm run lint
npm run test:ci
npm run openapi:validate
```

### Contracts checks

```bash
cd contracts
cargo fmt --all -- --check
cargo clippy --workspace --all-targets --all-features
cargo test --workspace
```

If your PR changes UI, include screenshots or a short screen recording in the PR description.

## Creating an issue

Before opening a new issue:

- Search existing issues (open + closed).
- Confirm whether it’s FE, BE, or contract scope.
- Provide acceptance criteria and a clear definition of done.

### Issue labels (recommended)

- `area:frontend`
- `area:backend`
- `area:contracts`
- `type:bug`
- `type:feature`
- `type:chore`
- `type:security`
- `good first issue`
- `help wanted`

## Picking up an issue

- Comment on the issue saying you’re working on it.
- Ask clarifying questions early.
- If you’re blocked for >24h, leave an update.

## If the repository is renamed on GitHub

If the organization renames this repository, GitHub will usually redirect the old URL to the new one.

If your local pushes start failing, update your `origin` remote URL:

```bash
git remote -v
git remote set-url origin https://github.com/Shelterflex/monorepo.git
git remote -v
```

## Definitions of Done (per issue type)

### Frontend issues

**Bug**

- Repro steps documented in the issue.
- Fix verified locally.
- No UI regressions in the affected flows.
- If the bug is user-facing, screenshots/video before & after.

**Feature**

- UI matches the acceptance criteria.
- Routing and error states are handled.
- Any new components are reusable and placed appropriately.
- If the feature talks to the backend/contract, the integration is behind a well-defined `lib/` module.

**Chore/Refactor**

- No behavior change unless explicitly intended.
- Affected screens still render correctly.

### Backend issues

**Bug**

- Failing scenario is described.
- Fix includes validation and clear error responses.
- No breaking changes to existing endpoints unless versioned.

**Feature**

- Endpoint contract is specified (request/response schema).
- Input validation is done (zod).
- Error handling is consistent.
- CORS and env vars documented.

**Soroban integration**

- RPC URL/passphrase configurable via env.
- Clear separation between HTTP layer and Soroban client code (`src/soroban/*`).
- Logging for tx submission + failure diagnostics.

### Contract issues (Soroban)

**Bug**

- Regression test added.
- Fix is covered by unit/integration tests.

**Feature**

- Contract interface documented (methods + expected behavior).
- Events emitted for state transitions.
- Tests cover happy path and at least one failure path.

**Security hardening**

- Threat model described in the issue.
- Access control is explicit (`require_auth`).
- No panics on user-controlled inputs unless the behavior is intentional and documented.

## PR process

## PR description requirements (to pass CI)

This repo runs a **PR Validation** check on every Pull Request. Your PR will fail if the PR description is empty or missing required sections.

Minimum requirements:

- The PR description must not be empty.
- The PR description must include these headings (exact text):
  - `## Summary`
  - `## Changes`
  - `## Checklist`

Strongly recommended:

- Link an issue in the PR description (example: `Closes #123`).

If your PR is a **contract upgrade / deploy**, the validator will also require these headings:

- `### Network`
- `### New Contract`
- `### Upgrade Governance`
- `### Verification Steps`

Copy/paste PR description example (passes validation):

```md
## Summary

What does this PR do and why?

## Linked issue

Closes #123

## Changes

- Change 1
- Change 2

## Checklist

- [ ] I tested locally
- [ ] I did not commit secrets
- [ ] I updated docs if needed
- [ ] If UI changes: I included before/after screenshots
- [ ] If images added/changed: I verified they are optimized and accessible
```

### 0) Fork the repo (recommended for public contributions)

- Click **Fork** on GitHub to create your own copy of the repo.
- Clone your fork locally.

### 1) Create your branch

- Create a new branch from `main`.
- Branch naming:
  - `feat/<short>`
  - `fix/<short>`
  - `chore/<short>`

### 2) Make changes (scoped)

- Keep PRs focused (ideally one issue per PR).
- If you only change one area, keep changes inside that folder:
  - `frontend/` changes should not require touching `backend/` or `contracts/`.
  - `contracts/` changes should include tests.

### 3) Commit

- Write clear commit messages.
- Don’t commit secrets (`.env`, private keys, seed phrases).

### 4) Push and open a PR

- Push your branch to your fork.
- Open a Pull Request from your fork into the organization repo’s `main` branch.
- Fill out `.github/PULL_REQUEST_TEMPLATE.md`.
- Link the issue in the PR description:
  - Example: `Closes #123`

### 5) Respond to review

- Address comments by pushing new commits to the same branch.
- If requested, rebase on the latest `main`.
- Keep discussion in the PR for transparency.

## Code review checklist (what we’ll look for)

- Correctness and edge cases
- Security (especially auth and contract access control)
- Tests and/or reproducible verification steps
- Clear naming and minimal complexity
- No secrets committed
