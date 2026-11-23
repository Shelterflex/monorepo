/**
 * Tenant rating card API (#1923).
 *
 * Backend issue #1905 routes:
 *   GET    /api/v1/tenant/rating-card          own aggregate
 *   POST   /api/v1/tenant/rating-card/share    { ttlDays? } — raw token returned once
 *   DELETE /api/v1/tenant/rating-card/share/:id
 *   GET    /api/v1/public/rating-card/:token   public aggregate (no-store)
 *
 * Share tokens are secrets: they are shown once on creation and must never be
 * logged or forwarded to analytics from here (#1923 acceptance criteria).
 */
import { apiDelete, apiGet, apiPost, withQuery } from "./apiClient";
import { ApiError } from "./api";

export type RatingDimension =
  | "paymentTimeliness"
  | "propertyCare"
  | "communication";

export interface RatingAggregate {
  count: number;
  averages: Record<
    RatingDimension | "overall",
    number | null
  >;
  recentComments: string[];
}

function emptyAverages(): RatingAggregate["averages"] {
  return {
    paymentTimeliness: null,
    propertyCare: null,
    communication: null,
    overall: null,
  };
}

export function emptyRatingAggregate(): RatingAggregate {
  return { count: 0, averages: emptyAverages(), recentComments: [] };
}

interface ApiEnvelope<T> {
  success: boolean;
  data: T;
}

export const SHARE_TTL_CHOICES = [1, 7, 14, 30] as const;
export const SHARE_TTL_MAX_DAYS = 30;

export interface RatingCardShare {
  id: string;
  /** Raw share token — returned only once, on creation. */
  token: string;
  url: string;
  expiresAt: string;
}

/** The backend keeps only a token hash and exposes no share-list endpoint, so
 * the dashboard lists the links created in this session with their expiries.
 * Expiry and revocation are enforced server-side regardless of this list. */
const createdShares = new Map<string, RatingCardShare>();

export function getCreatedShares(): RatingCardShare[] {
  const now = Date.now();
  for (const [id, share] of createdShares) {
    if (new Date(share.expiresAt).getTime() <= now) createdShares.delete(id);
  }
  return [...createdShares.values()].sort(
    (a, b) => new Date(b.expiresAt).getTime() - new Date(a.expiresAt).getTime(),
  );
}

export function forgetCreatedShares(): void {
  createdShares.clear();
}

export async function getTenantRatingCard(): Promise<RatingAggregate> {
  const res = await apiGet<ApiEnvelope<RatingAggregate>>(
    "/api/v1/tenant/rating-card",
  );
  return res.data;
}

export async function createShareLink(ttlDays: number): Promise<RatingCardShare> {
  const res = await apiPost<ApiEnvelope<RatingCardShare>>(
    "/api/v1/tenant/rating-card/share",
    { ttlDays },
  );
  const share = res.data;
  createdShares.set(share.id, share);
  return share;
}

export async function revokeShareLink(shareId: string): Promise<void> {
  const res = await apiDelete<ApiEnvelope<{ id: string; revoked: boolean }>>(
    `/api/v1/tenant/rating-card/share/${encodeURIComponent(shareId)}`,
  );
  createdShares.delete(res.data.id);
}

export interface PublicRatingCard extends RatingAggregate {
  /** First name and last initial only (never the full name or email). */
  displayName: string;
}

export class RatingCardUnavailableError extends Error {
  constructor() {
    super("This rating card link is no longer active.");
    this.name = "RatingCardUnavailableError";
  }
}

export async function getPublicRatingCard(token: string): Promise<PublicRatingCard> {
  try {
    const res = await apiGet<ApiEnvelope<PublicRatingCard>>(
      `/api/v1/public/rating-card/${encodeURIComponent(token)}`,
    );
    return res.data;
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) {
      throw new RatingCardUnavailableError();
    }
    throw error;
  }
}
