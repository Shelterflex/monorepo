import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../api", () => ({ apiFetch: vi.fn() }));

import { apiFetch } from "../api";
import {
  claimRewards,
  getHealth,
  getStakingHistory,
  getStakingPosition,
  getStakingQuote,
  stakeFromNgnBalance,
  stakeNgn,
  stakeTokens,
  unstakeTokens,
} from "../config";

const fetchMock = vi.mocked(apiFetch);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

beforeEach(() => {
  fetchMock.mockReset();
  fetchMock.mockResolvedValue({} as never);
});

describe("config API requests", () => {
  it("getHealth GETs /health", async () => {
    await getHealth();
    expect(fetchMock).toHaveBeenCalledWith("/health");
  });

  it("sends the wallet address header only when one is given", async () => {
    await getStakingPosition("GABC");
    expect(fetchMock).toHaveBeenLastCalledWith("/api/staking/position", {
      headers: { "x-wallet-address": "GABC" },
    });

    await getStakingPosition(null);
    expect(fetchMock).toHaveBeenLastCalledWith("/api/staking/position", { headers: {} });
  });

  it("GETs the MVP staking position with the wallet header", async () => {
    await getStakingHistory("GABC");
    expect(fetchMock).toHaveBeenLastCalledWith("/api/staking/history", {
      headers: { "x-wallet-address": "GABC" },
    });
  });

  it("stakeTokens POSTs the amount with a fresh externalRef", async () => {
    await stakeTokens("10", "GABC");

    const [path, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(path).toBe("/api/staking/stake");
    expect(init.method).toBe("POST");
    expect(init.headers).toEqual({ "x-wallet-address": "GABC" });

    const body = JSON.parse(init.body as string);
    expect(body).toMatchObject({ amountUsdc: "10", externalRefSource: "web" });
    expect(body.externalRef).toMatch(UUID);
  });

  it("unstakeTokens POSTs to /api/staking/unstake", async () => {
    await unstakeTokens("3");
    const [path, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(path).toBe("/api/staking/unstake");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body as string)).toMatchObject({ amountUsdc: "3" });
  });

  it("claimRewards POSTs without an amount", async () => {
    await claimRewards();
    const [path, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(path).toBe("/api/staking/claim");
    const body = JSON.parse(init.body as string);
    expect(body).not.toHaveProperty("amountUsdc");
    expect(body.externalRefSource).toBe("web");
  });

  it("stakeNgn POSTs a generated externalRef unless one is supplied", async () => {
    await stakeNgn(5000);
    const generated = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string);
    expect(generated.amountNgn).toBe(5000);
    expect(generated.externalRef).toMatch(UUID);

    await stakeNgn(5000, "mobile", "ref-1");
    const explicit = JSON.parse((fetchMock.mock.calls[1][1] as RequestInit).body as string);
    expect(explicit).toEqual({ amountNgn: 5000, externalRefSource: "mobile", externalRef: "ref-1" });
  });

  it("stakeFromNgnBalance POSTs the NGN amount", async () => {
    await stakeFromNgnBalance(2000);
    expect(fetchMock).toHaveBeenCalledWith("/api/staking/stake_from_ngn_balance", {
      method: "POST",
      body: JSON.stringify({ amountNgn: 2000 }),
    });
  });

  it("getStakingQuote defaults the payment rail to bank_transfer", async () => {
    await getStakingQuote(1000);
    expect(JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string)).toEqual({
      amountNgn: 1000,
      paymentRail: "bank_transfer",
    });
  });

  it("propagates API failures to the caller", async () => {
    const failure = new Error("Insufficient balance");
    fetchMock.mockRejectedValueOnce(failure);
    await expect(stakeFromNgnBalance(1)).rejects.toBe(failure);
  });
});
