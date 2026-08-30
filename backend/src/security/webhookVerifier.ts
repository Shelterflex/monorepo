import crypto from "crypto";
import { env } from "../schemas/env.js";

export interface WebhookStrategy {
  verify(payload: string, signature: string, timestamp: string): boolean;
}

export function verifyHmac(payload: string, signature: string, secret: string) {
  const expected = crypto
    .createHmac("sha256", secret)
    .update(payload)
    .digest("hex");

  return crypto.timingSafeEqual(
    Buffer.from(expected),
    Buffer.from(signature)
  );
}

const replayStore = new Map(); // replace with Redis

export function checkReplay(eventId: string) {
  if (replayStore.has(eventId)) throw new Error("Replay detected");

  replayStore.set(eventId, Date.now());

  setTimeout(() => replayStore.delete(eventId), 5 * 60 * 1000);
}

const keys = {
  current: env.WEBHOOK_KEY,
  previous: process.env.WEBHOOK_OLD_KEY || "",
};

export function verifyWithRotation(payload: string, sig: string) {
  return (
    verifyHmac(payload, sig, keys.current) ||
    (keys.previous ? verifyHmac(payload, sig, keys.previous) : false)
  );
}

export async function verifyWebhook(req: any, res: any, next: any) {
  try {
    const sig = req.headers["x-signature"];
    const eventId = req.headers["x-event-id"];

    checkReplay(eventId);

    if (!verifyWithRotation(req.rawBody || JSON.stringify(req.body), sig)) {
      return res.status(401).send("Invalid signature");
    }

    next();
  } catch (err) {
    return res.status(400).send("Webhook rejected");
  }
}
