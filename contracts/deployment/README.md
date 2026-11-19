# Multi-Chain Deployment Configuration

> **EVM + Soroban** deployment scripts for the Shelterflex contract suite.

> **Doing a real deployment?** This README documents the scripts and their
> configuration. The ordered procedure around them — WASM hash verification,
> transferring admin authority to the multisig, the timelock, rollback limits,
> and the testnet/mainnet gate — is in
> [`docs/contracts/RUNBOOK.md`](../../docs/contracts/RUNBOOK.md).

---

## Overview

This directory contains network configurations and deployment scripts for
shipping Soroban (Stellar) and EVM (Base) smart contracts across testnets and
mainnet.  The system is **idempotent** — running the deploy script twice will
skip contracts that have already been deployed.

## Directory Structure

```
contracts/deployment/
├── config/
│   ├── testnet.json          # Stellar Soroban testnet settings
│   ├── mainnet.json          # Stellar Soroban mainnet settings
│   └── evm-testnet.json      # Base Sepolia EVM testnet settings
├── scripts/
│   ├── deploy-soroban.sh     # Soroban deploy + init (idempotent)
│   └── deploy-evm.sh         # EVM deploy stub (placeholder)
├── deployed/
│   ├── .gitkeep
│   └── {network}.json        # Auto-generated — deployed contract IDs
└── README.md                 # ← you are here
```

## Prerequisites

| Tool             | Version   | Install                                                    |
| ---------------- | --------- | ---------------------------------------------------------- |
| **Rust**         | stable    | `curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs \| sh` |
| **Stellar CLI**  | latest    | `cargo install --locked stellar-cli --features opt`        |
| **jq**           | ≥ 1.6     | `sudo apt-get install jq` / `brew install jq`              |

## Quick Start — Soroban Deployment

```bash
# 1. Set required secrets
export STELLAR_SECRET_KEY="S..."
export STELLAR_DEPLOYER_ADDRESS="G..."

# 2. Deploy to testnet (default)
bash contracts/deployment/scripts/deploy-soroban.sh --network testnet

# 3. Deploy to mainnet
bash contracts/deployment/scripts/deploy-soroban.sh --network mainnet
```

The script will:

1. Read the network configuration from `config/{network}.json`.
2. Build all workspace WASM artifacts via `stellar contract build`.
3. For each contract in the workspace:
   - **Skip** if the contract ID already exists in `deployed/{network}.json`.
   - **Deploy** the WASM and record the contract ID.
   - **Initialise** the contract with the deployer address as admin (best-effort).
4. Write all contract IDs to `deployed/{network}.json`.

### Re-running (Idempotency)

The deploy script tracks every successfully deployed contract ID in
`deployed/{network}.json`.  If the script is interrupted or re-run, it will
automatically skip contracts that already have an ID recorded.

To force a fresh deployment of a specific contract, remove its entry from the
JSON file:

```bash
# Remove a single entry
jq 'del(.rent_wallet)' contracts/deployment/deployed/testnet.json > tmp.json \
  && mv tmp.json contracts/deployment/deployed/testnet.json
```

## EVM Deployment (Placeholder)

The `deploy-evm.sh` script is a **placeholder** documenting the future EVM
deployment path.  When Solidity contracts are added to the monorepo, this script
will be updated to support Base Sepolia and mainnet deployments using Hardhat or
Foundry.

See `config/evm-testnet.json` for the Base Sepolia network details.

## Environment Variables

| Variable                     | Required | Used By          | Description                                  |
| ---------------------------- | -------- | ---------------- | -------------------------------------------- |
| `STELLAR_SECRET_KEY`         | **Yes**  | deploy-soroban   | Stellar account secret key for signing txns  |
| `STELLAR_DEPLOYER_ADDRESS`   | Recommended | deploy-soroban | Public key of the deployer account           |
| `EVM_DEPLOYER_PRIVATE_KEY`   | Future   | deploy-evm       | EVM wallet private key                       |
| `EVM_DEPLOYER_ADDRESS`       | Future   | deploy-evm       | EVM wallet public address                    |
| `EVM_RPC_URL`                | Future   | deploy-evm       | JSON-RPC endpoint override                   |

> **⚠️ Never hardcode secrets.** Use CI/CD secrets, environment variables, or a
> secrets vault.

## CI/CD Integration

A GitHub Actions workflow is provided at
`.github/workflows/contract-deploy-testnet.yml`.  It triggers on **tag pushes**
matching `v*` and runs the Soroban testnet deployment automatically.

The workflow expects the following **GitHub Secrets** to be configured:

- `STELLAR_SECRET_KEY`
- `STELLAR_DEPLOYER_ADDRESS`

### Manual Trigger

You can also run the deployment locally:

```bash
export STELLAR_SECRET_KEY="$YOUR_SECRET"
export STELLAR_DEPLOYER_ADDRESS="$YOUR_ADDRESS"
bash contracts/deployment/scripts/deploy-soroban.sh --network testnet
```

## Contracts Deployed

The full workspace includes these contracts:

| Contract                      | Type    |
| ----------------------------- | ------- |
| rent_wallet                   | Soroban |
| rent_payments                 | Soroban |
| transaction-receipt-contract  | Soroban |
| staking_rewards               | Soroban |
| staking_pool                  | Soroban |
| mvp_staking_pool              | Soroban |
| whistleblower_rewards         | Soroban |
| soroban_pausable              | Soroban |
| soroban_access_control        | Soroban |
| deal_escrow                   | Soroban |
| contract_access               | Soroban |
| timelock                      | Soroban |
