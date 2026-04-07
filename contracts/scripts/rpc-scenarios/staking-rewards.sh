#!/usr/bin/env bash
set -euo pipefail

: "${SOROBAN_STAKING_REWARDS_ID:?SOROBAN_STAKING_REWARDS_ID is required}"
: "${SF_ADMIN_IDENTITY:?SF_ADMIN_IDENTITY is required}"
: "${SF_OPERATOR_IDENTITY:?SF_OPERATOR_IDENTITY is required}"
: "${SF_USER1_IDENTITY:?SF_USER1_IDENTITY is required}"

USER_ADDR="$(stellar keys address "${SF_USER1_IDENTITY}")"
OP_ADDR="$(stellar keys address "${SF_OPERATOR_IDENTITY}")"

# Ensure operator is set
stellar contract invoke \
  --id "${SOROBAN_STAKING_REWARDS_ID}" \
  --source-account "${SF_ADMIN_IDENTITY}" \
  --network local \
  --send=yes \
  -- \
  add_operator \
  --operator "${OP_ADDR}" > /dev/null

# Stake some amount (creates user stake entry)
stellar contract invoke \
  --id "${SOROBAN_STAKING_REWARDS_ID}" \
  --source-account "${SF_USER1_IDENTITY}" \
  --network local \
  --send=yes \
  -- \
  stake \
  --user "${USER_ADDR}" \
  --amount 1000000 > /dev/null

# Fund rewards as operator
stellar contract invoke \
  --id "${SOROBAN_STAKING_REWARDS_ID}" \
  --source-account "${SF_OPERATOR_IDENTITY}" \
  --network local \
  --send=yes \
  -- \
  fund_rewards \
  --amount 500000 > /dev/null

# Distribute rewards as admin
stellar contract invoke \
  --id "${SOROBAN_STAKING_REWARDS_ID}" \
  --source-account "${SF_ADMIN_IDENTITY}" \
  --network local \
  --send=yes \
  -- \
  distribute_rewards \
  --amount 500000 > /dev/null

# Claim as user - this is the tx we benchmark
OUT=$(stellar contract invoke \
  --id "${SOROBAN_STAKING_REWARDS_ID}" \
  --source-account "${SF_USER1_IDENTITY}" \
  --network local \
  --send=yes \
  -- \
  claim \
  --user "${USER_ADDR}" 2>&1)

echo "$OUT"
