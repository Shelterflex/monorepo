"use client";

/**
 * Tenant rating card (#1923): per-dimension averages, rating count, recent
 * comments and share-link management (create with TTL, copy, list with
 * expiry, revoke). Share tokens are secrets — they are displayed once and
 * never logged or forwarded to analytics.
 */
import { useCallback, useEffect, useState } from "react";
import { Copy, Link2, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState, ErrorState, LoadingState } from "@/components/ui/data-state";
import { Label } from "@/components/ui/label";
import { formatDecimal } from "@/lib/currency";
import {
  createShareLink,
  forgetCreatedShares,
  getCreatedShares,
  getTenantRatingCard,
  revokeShareLink,
  SHARE_TTL_CHOICES,
  type RatingAggregate,
  type RatingCardShare,
  type RatingDimension,
} from "@/lib/tenantRatingCardApi";

const DIMENSION_LABELS: Record<RatingDimension, string> = {
  paymentTimeliness: "Payment timeliness",
  propertyCare: "Property care",
  communication: "Communication",
};

export function RatingCardClient() {
  const [aggregate, setAggregate] = useState<RatingAggregate | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [shares, setShares] = useState<RatingCardShare[]>([]);
  const [ttlDays, setTtlDays] = useState<number>(7);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [copiedShareId, setCopiedShareId] = useState<string | null>(null);
  const [justCreated, setJustCreated] = useState<RatingCardShare | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      setAggregate(await getTenantRatingCard());
      setShares(getCreatedShares());
    } catch (loadError) {
      setError(
        loadError instanceof Error ? loadError.message : "Unable to load your rating card.",
      );
    }
  }, []);

  useEffect(() => {
    void load();
    return () => forgetCreatedShares();
  }, [load]);

  async function createShare() {
    setCreating(true);
    setCreateError(null);
    try {
      const share = await createShareLink(ttlDays);
      setJustCreated(share);
      setShares(getCreatedShares());
    } catch (error) {
      setCreateError(
        error instanceof Error ? error.message : "Could not create a share link.",
      );
    } finally {
      setCreating(false);
    }
  }

  async function revoke(shareId: string) {
    try {
      await revokeShareLink(shareId);
      setShares(getCreatedShares());
      if (justCreated?.id === shareId) setJustCreated(null);
    } catch {
      setCreateError("Could not revoke this link. It may have already been revoked.");
      setShares(getCreatedShares());
    }
  }

  if (error) {
    return <ErrorState title="Could not load your rating card" description={error} onRetry={() => void load()} />;
  }

  if (aggregate === null) {
    return <LoadingState label="Loading your rating card" />;
  }

  const hasRatings = aggregate.count > 0;

  return (
    <div className="space-y-6">
      <Card className="border-3 border-foreground p-6 shadow-[4px_4px_0px_0px_rgba(26,26,26,1)]">
        {hasRatings ? (
          <div className="space-y-4">
            <div className="flex flex-wrap items-baseline gap-2">
              <h2 className="font-mono text-xl font-black">Overall</h2>
              <span className="font-mono text-3xl font-black">
                {formatDecimal(aggregate.averages.overall ?? 0)}
              </span>
              <span className="text-sm text-muted-foreground">
                of 5 · {aggregate.count} rating{aggregate.count === 1 ? "" : "s"}
              </span>
            </div>
            <dl className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              {(Object.keys(DIMENSION_LABELS) as RatingDimension[]).map((dimension) => (
                <div key={dimension} className="border-2 border-foreground/20 p-3">
                  <dt className="text-sm text-muted-foreground">{DIMENSION_LABELS[dimension]}</dt>
                  <dd className="font-mono text-2xl font-black">
                    {aggregate.averages[dimension] === null
                      ? "—"
                      : formatDecimal(aggregate.averages[dimension] as number)}
                  </dd>
                </div>
              ))}
            </dl>
            {aggregate.recentComments.length > 0 && (
              <div>
                <h3 className="font-mono text-sm font-bold">Recent comments</h3>
                <ul className="mt-2 space-y-2">
                  {aggregate.recentComments.map((comment, index) => (
                    <li
                      key={`${index}-${comment.slice(0, 16)}`}
                      className="border-2 border-foreground/20 p-3 text-sm"
                    >
                      “{comment}”
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        ) : (
          <EmptyState
            title="No ratings yet"
            description="Landlords can rate you once you have a completed or active deal. Your card fills up as deals get rated."
          />
        )}
      </Card>

      <Card className="border-3 border-foreground p-6 shadow-[4px_4px_0px_0px_rgba(26,26,26,1)]">
        <h2 className="font-mono text-lg font-black">Share links</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Create an expiring, read-only link to your card. The link only reveals your
          first name, last initial and ratings. Copy it before leaving this page —
          the secret part of the link is never shown again.
        </p>

        <div className="mt-4 flex flex-wrap items-end gap-3">
          <div>
            <Label htmlFor="share-ttl" className="text-sm font-bold">
              Valid for
            </Label>
            <select
              id="share-ttl"
              value={ttlDays}
              disabled={creating}
              onChange={(event) => setTtlDays(Number(event.target.value))}
              className="mt-1 border-3 border-foreground bg-card p-2 font-bold"
            >
              {SHARE_TTL_CHOICES.map((days) => (
                <option key={days} value={days}>
                  {days} day{days === 1 ? "" : "s"}
                </option>
              ))}
            </select>
          </div>
          <Button
            type="button"
            onClick={() => void createShare()}
            disabled={creating}
            className="border-3 border-foreground font-bold shadow-[4px_4px_0px_0px_rgba(26,26,26,1)]"
          >
            <Link2 className="mr-2 h-4 w-4" aria-hidden="true" />
            {creating ? "Creating…" : "Create link"}
          </Button>
        </div>
        {createError && (
          <div role="alert" className="mt-3 border-3 border-destructive bg-destructive/10 p-3 text-sm font-bold text-destructive">
            {createError}
          </div>
        )}

        {justCreated && !copiedShareId && (
          <div role="status" className="mt-4 border-3 border-foreground bg-primary/10 p-3 text-sm">
            <p className="font-bold">Copy your link now — it is shown once:</p>
            <code className="mt-1 block max-w-full overflow-x-auto whitespace-nowrap bg-card p-2 text-xs">
              {shareUrl(justCreated.token)}
            </code>
            <Button
              type="button"
              size="sm"
              className="mt-2 border-2 border-foreground font-bold"
              onClick={() => {
                void navigator.clipboard.writeText(shareUrl(justCreated.token));
                setCopiedShareId(justCreated.id);
              }}
            >
              <Copy className="mr-1 h-3.5 w-3.5" aria-hidden="true" />
              Copy link
            </Button>
          </div>
        )}

        {shares.length > 0 && (
          <ul className="mt-4 space-y-2">
            {shares.map((share) => (
              <li
                key={share.id}
                className="flex flex-wrap items-center justify-between gap-2 border-2 border-foreground/20 p-3 text-sm"
              >
                <div className="min-w-0">
                  <p className="font-bold">
                    {shareUrl(share.token).replace(/\/[a-f0-9]{32}$/, "/•••••")}
                  </p>
                  <p className="text-muted-foreground">
                    Expires {new Date(share.expiresAt).toLocaleDateString()}
                  </p>
                </div>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={share.id === justCreated?.id && !copiedShareId}
                  onClick={() => void revoke(share.id)}
                  className="border-2 border-foreground font-bold"
                >
                  <Trash2 className="mr-1 h-3.5 w-3.5" aria-hidden="true" />
                  Revoke
                </Button>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

/** The browser-visible URL for a share token. Token-free label rendering keeps
 * the raw token out of DOM-free surfaces (see analytics rule in #1923). */
function shareUrl(token: string): string {
  if (typeof window === "undefined") return `/rating-card/${token}`;
  return `${window.location.origin}/rating-card/${token}`;
}
