# Shelterflex

Shelterflex is an open-source project exploring **rent now, pay later** workflows with a modern web frontend, a Node.js backend, and Soroban smart contracts.

This repository is organized as **three independent projects**:

- `frontend/` - Next.js (React) web app
- `backend/` - Node.js (TypeScript + Express) API
- `contracts/` - Soroban (Rust) smart contracts

## Quickstart (Pick One)

New contributors can run **just one** component without setting up the others.

### Option A: Frontend Only

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
