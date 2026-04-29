# Shelterflex

Shelterflex is a **Rent Now, Pay Later (RNPL)** platform that enables tenants to secure rental properties with an initial deposit and pay the remaining balance in monthly installments — while allowing landlords to list properties directly, reducing reliance on traditional agents.

The platform combines three layers:

- **Property Marketplace** — Verified listings tenants can browse, filter, and secure
- **Financing Engine** — Installment-based rent with tiered interest plans (3, 6, or 12 months)
- **Risk & Credit Assessment** — Tenant screening via income verification, bank statements, and alternative data

### Platform Stakeholders

| Role | Description |
|---|---|
| **Tenant** | Browses listings, pays a 20–40% deposit upfront, repays the balance over time |
| **Landlord** | Lists properties directly, receives guaranteed/partial payments, avoids agent fees |
| **Whistleblower** | Reports fraudulent or inaccurate listings and earns on-chain rewards — functioning as a decentralized trust layer and organic quality-signal for the platform |
| **Freelance Inspector** | Physically verifies property conditions and submits structured inspection reports |

Whistleblowers are a first-class participant in the Shelterflex ecosystem. By surfacing fake listings and bad actors, they improve the overall listing quality, protect tenants from fraud, and make Shelterflex more attractive to both sides of the market. In this sense they serve an **advertising function**: every verified listing they help maintain increases platform credibility and drives organic adoption.

**Wallet Authentication** - Users can connect their Stellar wallet (e.g., Freighter) for secure, self-custody authentication alongside traditional email/OTP login.

**Security Scanning** - Automated security scanning runs on all pull requests to detect vulnerabilities in dependencies, code, and commits. See [Security Scanning](#security-scanning) for details.

This repository is organized as **three independent projects**:

- `frontend/` - Next.js (React) web app
- `backend/` - Node.js (TypeScript + Express) API
- `contracts/` - Smart contracts (currently prototyped on Soroban/Rust; target chain TBD)

## Business Model

Revenue is generated through:

- **Interest on installments** — tiered rates based on repayment term and tenant risk profile
- **Service fees** — optional listing fees and per-transaction fees
- **Premium features** — featured listings, tenant verification badges

### Payment Plan Reference

| Plan | Deposit | Interest | Monthly Payment (on ₦840k balance) |
|---|---|---|---|
| 3 months | 30% | 8% | ≈ ₦302,400 |
| 6 months | 30% | 12% | ≈ ₦156,800 |
| 12 months | 30% | 15% | ≈ ₦80,500 |

## Risk Management

The platform's viability depends on its risk controls:

- **Tenant screening** — income verification, employment checks, bank statement analysis, alternative data (mobile money, utility payments)
- **Tenant Rating Card** — portable reputation profile accumulated across tenancies; accessible to landlords during applicant vetting
- **Landlord protection** — partial upfront payout, optional rent guarantee insurance, escrow smart contracts
- **Late payment controls** — grace periods, penalties, automated reminders, escalation workflows
- **Whistleblower rewards** — on-chain incentive program that crowdsources detection of fraudulent listings and bad-faith actors
- **Staking / liquidity programme** — planned for a future phase to back the financing float

## Quickstart (Pick One)

New contributors can run **just one** component without setting up the others.

## Option A: Frontend Only

**Prerequisites:** Node.js 20+

```bash
cd frontend
npm install
npm run dev
```

- Runs on: `http://localhost:3000`
- Uses mock data (no backend required)
- See [`frontend/README.md`](frontend/README.md) for details

### Option B: Backend Only

**Prerequisites:** Node.js 20+

```bash
cd backend
npm install
cp .env.example .env
npm run dev
```

- Runs on: `http://localhost:4000`
- Verify: `GET http://localhost:4000/health`
- See [`backend/README.md`](backend/README.md) for API documentation

### Option C: Contracts Only

**Prerequisites:** Rust (stable), Soroban CLI (`stellar`)

```bash
cd contracts

# Run tests
cargo test

# Build contract WASM
stellar contract build
```

- See [`contracts/README.md`](contracts/README.md) for deployment instructions

## Contributing to Contracts

For details on proposing and approving contract upgrades, see **[Contract Upgrade Process](docs/contracts/UPGRADE_PROCESS.md)**.

## Troubleshooting

### Node version issues

```bash
node --version  # Should be 20+
```

If you have an older version, upgrade via [nodejs.org](https://nodejs.org/) or use a version manager like `nvm`.

### Missing environment variables (backend)

If the backend fails to start with errors about missing env vars:

```bash
cd backend
cp .env.example .env  # Creates a working .env with defaults
```

The defaults in `.env.example` are sufficient for local development.

### Port already in use

- **Frontend (3000):** If port 3000 is busy, Next.js will prompt to use another port
- **Backend (4000):** Set a different port in `backend/.env`:
  ```
  PORT=4001
  ```

### npm install failures

- Clear npm cache: `npm cache clean --force`
- Delete `node_modules` and `package-lock.json`, then retry
- Ensure you're in the correct project directory (`frontend/` or `backend/`)

### Soroban CLI not found

```bash
stellar --version
```

If missing, install the [Stellar CLI](https://github.com/stellar/stellar-cli) with Soroban support.

### cargo test fails (contracts)

Ensure you have the WASM target installed:

```bash
rustup target add wasm32-unknown-unknown
```

## Contributing

See [`CONTRIBUTING.md`](CONTRIBUTING.md) for:

- Local setup for FE/BE/contracts
- How to create issues and pick up tasks
- Issue types (frontend/backend/contract) and **Definition of Done**
- PR process and review checklist

Contributions are made via **Fork -> Branch -> Pull Request**.

If you want a curated list of issues (including good first issues), see [`docs/ISSUES_CATALOG.md`](docs/ISSUES_CATALOG.md).

For monorepo navigation and where to put new code, see [`docs/REPO_STRUCTURE.md`](docs/REPO_STRUCTURE.md).

## Security Scanning

All pull requests are automatically scanned for security vulnerabilities:

- **Dependency Scanning**: Checks npm and cargo dependencies for known CVEs
- **Static Code Analysis**: Detects security issues like SQL injection, XSS, insecure crypto
- **Secret Detection**: Scans commits for exposed API keys, passwords, and credentials

### How It Works

1. When you open a PR, the security scanner runs automatically
2. Results appear as a PR check and comment
3. Critical or high severity vulnerabilities block the merge
4. Medium and low severity issues are warnings only

### Local Testing

You can run the security scanner locally before pushing:

```bash
cd security-scan
npm install
npm run build
npm run scan
```

See [`security-scan/README.md`](security-scan/README.md) for detailed documentation.
# CI check
