import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import request from "supertest";
import { Keypair, Networks, Transaction, xdr } from "@stellar/stellar-sdk";
import { createApp } from "../app.js";
import { depositStore } from "../models/depositStore.js";
import { conversionStore } from "../models/conversionStore.js";
import { outboxStore } from "../outbox/store.js";
import { OutboxStatus, TxType } from "../outbox/types.js";
import {
  sessionStore,
  userStore,
  walletChallengeStore,
} from "../models/authStore.js";
import { StubSorobanAdapter } from "../soroban/stub-adapter.js";

function deterministicKeypair(): Keypair {
  return Keypair.fromRawEd25519Seed(
    Buffer.from(Array.from({ length: 32 }, (_, i) => i + 1)),
  );
}

async function signChallengeXdr(
  keypair: Keypair,
  challengeXdr: string,
): Promise<string> {
  const envelope = xdr.TransactionEnvelope.fromXDR(challengeXdr, "base64");
  const tx = new Transaction(envelope, Networks.TESTNET);
  tx.sign(keypair);
  return tx.toEnvelope().toXDR("base64");
}

describe("Critical user journey e2e", () => {
  const previousAdapterMode = process.env.SOROBAN_ADAPTER_MODE;

  beforeEach(async () => {
    process.env.SOROBAN_ADAPTER_MODE = "stub";
    sessionStore.clear();
    userStore.clear();
    walletChallengeStore.clear();
    await depositStore.clear();
    await conversionStore.clear();
    await outboxStore.clear();
    vi.restoreAllMocks();
  });

  afterEach(() => {
    if (previousAdapterMode === undefined) {
      delete process.env.SOROBAN_ADAPTER_MODE;
      return;
    }
    process.env.SOROBAN_ADAPTER_MODE = previousAdapterMode;
  });

  it("completes wallet auth -> deposit conversion -> stake receipt recording", async () => {
    const recordReceiptSpy = vi.spyOn(
      StubSorobanAdapter.prototype,
      "recordReceipt",
    );
    const app = createApp();
    const keypair = deterministicKeypair();
    const address = keypair.publicKey();

    const challengeRes = await request(app)
      .post("/api/auth/wallet/challenge")
      .send({ address })
      .expect(200);

    const signedChallengeXdr = await signChallengeXdr(
      keypair,
      challengeRes.body.challengeXdr,
    );

    const verifyRes = await request(app)
      .post("/api/auth/wallet/verify")
      .send({ address, signedChallengeXdr })
      .expect(200);

    expect(typeof verifyRes.body.token).toBe("string");
    expect(verifyRes.body.user).toBeDefined();

    const meRes = await request(app)
      .get("/api/auth/me")
      .set("Authorization", `Bearer ${verifyRes.body.token}`)
      .expect(200);

    expect(meRes.body.user.email).toBe(verifyRes.body.user.email);

    const depositId = "e2e-deposit-001";
    const providerRef = "e2e-provider-ref-001";
    const confirmRes = await request(app)
      .post("/api/deposits/confirm")
      .set('x-idempotency-key', depositId)
      .send({
        depositId,
        userId: verifyRes.body.user.id,
        amountNgn: 160000,
        provider: "onramp",
        providerRef,
      })
      .expect(200);

    expect(confirmRes.body.success).toBe(true);
    expect(confirmRes.body.deposit.status).toBe("confirmed");
    expect(confirmRes.body.conversion.status).toBe("completed");

    const conversionId = confirmRes.body.conversion.conversionId;
    const stakeRes = await request(app)
      .post("/api/staking/stake_from_deposit")
      .send({ conversionId })
      .expect((res) => {
        expect([200, 202]).toContain(res.status);
      });

    const outboxItem = await outboxStore.getById(stakeRes.body.outboxId);
    expect(outboxItem).toBeDefined();
    expect(outboxItem?.txType).toBe(TxType.STAKE);
    expect(outboxItem?.status).toBe(OutboxStatus.SENT);

    const storedDeposit = await depositStore.getById(depositId);
    expect(storedDeposit?.status).toBe("consumed");
    expect(storedDeposit?.consumedAt).not.toBeNull();

    const storedConversion =
      await conversionStore.getByConversionId(conversionId);
    expect(storedConversion?.status).toBe("completed");
    expect(outboxItem?.payload.amountUsdc).toBe(storedConversion?.amountUsdc);

    expect(recordReceiptSpy).toHaveBeenCalledTimes(1);
    expect(recordReceiptSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        txType: TxType.STAKE,
        dealId: "staking-transaction",
        amountUsdc: storedConversion?.amountUsdc,
      }),
    );
  });
});
