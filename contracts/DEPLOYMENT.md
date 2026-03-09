# Contracts Deployment (Local Sandbox + Testnet)

This repo contains multiple Soroban smart contracts under `contracts/`.

This document provides a reproducible workflow to:

- build WASM
- deploy contracts
- initialize contracts with the correct admin/operator/token configuration
- capture deployed contract IDs and wire them into the backend `.env`

## Prerequisites

- Rust (stable)
- Stellar CLI with Soroban support (`stellar`)
- Docker (for local sandbox)

Verify:

```bash
rustc --version
stellar --version
docker --version
```

## Contracts and init parameters

These are the `init(...)` entrypoints that scripts/docs assume:

- `transaction-receipt-contract`: `init(admin: Address, operator: Address)`
- `staking_pool`: `init(admin: Address, token: Address)`
- `staking_rewards`: `init(admin: Address)`
- `deal_escrow`: `init(admin: Address, operator: Address, token: Address, receipt_contract: Address)`
- `whistleblower_rewards`: `init(admin: Address, operator: Address, token: Address)`
- `rent_wallet`: `init(admin: Address)`
- `rent_payments`: `init(admin: Address)`

## Required environment variables (backend)

The backend reads Soroban config from environment variables.

Minimum required for on-chain receipt recording in real mode:

- `SOROBAN_RPC_URL`
- `SOROBAN_NETWORK_PASSPHRASE`
- `SOROBAN_CONTRACT_ID` (Transaction Receipt contract)
- `SOROBAN_ADMIN_SECRET` (secret key of an admin/operator identity used to sign transactions)

Additional IDs used by other endpoints:

- `SOROBAN_USDC_TOKEN_ID`
- `SOROBAN_STAKING_POOL_ID`
- `SOROBAN_STAKING_REWARDS_ID`

## Scripts

Scripts live in `contracts/scripts/`:

- `build-wasm.sh`: builds all contract WASM artifacts into `contracts/artifacts/`
- `deploy-all.sh`: deploys + initializes all contracts and prints an env snippet

All scripts are **bash**. On Windows, run them from Git Bash or WSL.

---

# Local sandbox deployment

## 1) Start a local sandbox

This starts a local network container (RPC + friendbot):

```bash
stellar container start local
```

Expected output includes a running container. The CLI exposes RPC via the container’s port mapping (default `8000:8000`).

## 2) Configure the local network in `stellar`

```bash
stellar network add local \
  --rpc-url http://localhost:8000/soroban/rpc \
  --network-passphrase "Standalone Network ; February 2017"
```

Expected output: no output on success.

(Optional) Make it the default:

```bash
stellar network use local
```

## 3) Create funded identities

Create admin/operator/issuer identities and fund them using local friendbot:

```bash
stellar keys generate shelter_admin --network local --fund
stellar keys generate shelter_operator --network local --fund
stellar keys generate shelter_issuer --network local --fund
```

Expected output: key generation confirmation. (The exact formatting depends on CLI version.)

Get their public keys:

```bash
stellar keys address shelter_admin
stellar keys address shelter_operator
stellar keys address shelter_issuer
```

Each prints a public key starting with `G`.

## 4) Build WASM

From repo root:

```bash
bash contracts/scripts/build-wasm.sh
```

Expected output includes `stellar contract build ...` and generated `.wasm` files under:

- `contracts/artifacts/`

## 5) Deploy + initialize all contracts

```bash
bash contracts/scripts/deploy-all.sh local shelter_admin shelter_operator shelter_issuer
```

Expected output includes multiple lines like:

```text
Deploying transaction-receipt-contract...
<CONTRACT_ID_STARTING_WITH_C>
Initializing transaction-receipt-contract...
...
```

At the end, it prints a backend env snippet:

```text
# backend/.env
SOROBAN_RPC_URL=http://localhost:8000/soroban/rpc
SOROBAN_NETWORK_PASSPHRASE=Standalone Network ; February 2017
SOROBAN_CONTRACT_ID=C...
SOROBAN_USDC_TOKEN_ID=C...
SOROBAN_STAKING_POOL_ID=C...
SOROBAN_STAKING_REWARDS_ID=C...
```

---

# Testnet deployment

## 1) Ensure testnet network is configured

You can rely on the built-in `testnet` network:

```bash
stellar network ls --long
```

If you need to (re)add testnet explicitly:

```bash
stellar network add testnet \
  --rpc-url https://soroban-testnet.stellar.org \
  --network-passphrase "Test SDF Network ; September 2015"
```

## 2) Create funded identities (Friendbot)

```bash
stellar keys generate shelter_admin --network testnet --fund --overwrite
stellar keys generate shelter_operator --network testnet --fund --overwrite
stellar keys generate shelter_issuer --network testnet --fund --overwrite
```

Expected output: generation confirmation.

Confirm addresses:

```bash
stellar keys address shelter_admin
stellar keys address shelter_operator
stellar keys address shelter_issuer
```

## 3) Build WASM

```bash
bash contracts/scripts/build-wasm.sh
```

## 4) Deploy + initialize all contracts

```bash
bash contracts/scripts/deploy-all.sh testnet shelter_admin shelter_operator shelter_issuer
```

Expected output:

- Each `stellar contract deploy` prints a contract ID starting with `C`.
- Initialization calls will submit transactions (state-changing), so the CLI may simulate first then send.

If you see simulation-only output, rerun with `--send=yes` (the scripts already do this for init).

## 5) Copy contract IDs into backend env

The script prints a snippet for `backend/.env`.

At minimum, set:

- `SOROBAN_RPC_URL=https://soroban-testnet.stellar.org`
- `SOROBAN_NETWORK_PASSPHRASE=Test SDF Network ; September 2015`
- `SOROBAN_CONTRACT_ID=<transaction-receipt-contract-id>`
- `SOROBAN_ADMIN_SECRET=<secret key for shelter_operator or shelter_admin>`

To point the backend at your operator key, you can export:

```bash
stellar keys secret shelter_operator
```

Copy the printed secret (starts with `S...`) into `SOROBAN_ADMIN_SECRET`.
