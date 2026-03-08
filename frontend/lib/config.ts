import { apiFetch } from "./api";


export interface HealthResponse {
  status: string;
  version: string;
  uptimeSeconds: number;
}

export interface StakingPositionReponse {
  success: boolean;
  position: {
    staked: string;
    claimable: string;
  }
}


export interface TxResponse {
  success: boolean
  outboxId: string
  txId: string
  status: "CONFIRMED" | "QUEUED"
  message: string
}

export function getHealth(): Promise<HealthResponse> {
  return apiFetch<HealthResponse>("/health");
}


export function getStakingPosition(): Promise<StakingPositionReponse> {
  return apiFetch<StakingPositionReponse>("/api/staking/position");
}


export function stakeTokens(amountUsdc: string): Promise<TxResponse> {
  return apiFetch("/api/staking/stake", {
    method: "POST",
    body: JSON.stringify({
      amountUsdc,
      externalRefSource: "web",
      externalRef: crypto.randomUUID()
    })
  })
}

export function unstakeTokens(amountUsdc: string): Promise<TxResponse> {
  return apiFetch("/api/staking/unstake", {
    method: "POST",
    body: JSON.stringify({
      amountUsdc,
      externalRefSource: "web",
      externalRef: crypto.randomUUID()
    })
  })
}

export function claimRewards(): Promise<TxResponse> {
  return apiFetch("/api/staking/claim", {
    method: "POST",
    body: JSON.stringify({
      externalRefSource: "web",
      externalRef: crypto.randomUUID()
    })
  })
}

export interface StakeFromNgnBalanceResponse extends TxResponse {
  conversionId?: string;
  amountUsdc?: string;
  amountNgn?: number;
}

export interface StakingQuote {
  quoteId: string;
  amountNgn: number;
  estimatedAmountUsdc: string;
  fxRateNgnPerUsdc: number;
  feesNgn: number;
  expiresAt: string;
  disclaimer: string;
}

export interface StakeNgnResponse {
  success: boolean;
  conversionId?: string;
  amountUsdc?: string;
  fxRateNgnPerUsdc?: number;
  outboxId?: string;
  txId?: string;
  status?: string;
  message: string;
}

export function stakeFromNgnBalance(amountNgn: number): Promise<StakeFromNgnBalanceResponse> {
  return apiFetch("/api/staking/stake_from_ngn_balance", {
    method: "POST",
    body: JSON.stringify({
      amountNgn
    })
  })
}

export function getStakingQuote(amountNgn: number, paymentRail: string = "bank_transfer"): Promise<StakingQuote> {
  return apiFetch("/api/staking/quote", {
    method: "POST",
    body: JSON.stringify({
      amountNgn,
      paymentRail
    })
  })
}

export function stakeNgn(amountNgn: number, externalRefSource: string = "web", externalRef?: string): Promise<StakeNgnResponse> {
  return apiFetch("/api/staking/stake-ngn", {
    method: "POST",
    body: JSON.stringify({
      amountNgn,
      externalRefSource,
      externalRef: externalRef || crypto.randomUUID()
    })
  })
}