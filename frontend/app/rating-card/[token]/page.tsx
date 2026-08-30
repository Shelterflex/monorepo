"use client";

import { useState, useEffect } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { Star, Home, Shield, Clock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import RatingCard from "@/components/tenant/RatingCard";
import {
  Empty,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
  EmptyDescription,
} from "@/components/ui/empty";
import { Alert, AlertTitle, AlertDescription } from "@/components/ui/alert";
import { ApiError } from "@/lib/api";
import {
  getSharedRatingCard,
  type PublicRatingCard,
} from "@/lib/ratingCardApi";
import { formatDate } from "@/lib/date";

// "success" covers both populated and empty-ratings cases (empty state is rendered inside SuccessPage)
type PageState =
  | { status: "loading" }
  | { status: "success"; card: PublicRatingCard }
  | { status: "expired" }
  | { status: "rate-limited" };

function LoadingSkeleton() {
  return (
    <main
      className="min-h-screen bg-background"
      aria-label="Loading tenant rating card"
      aria-busy="true"
    >
      <section className="border-b-3 border-foreground bg-muted py-8">
        <div className="container mx-auto px-4">
          <Skeleton className="h-4 w-40 mb-2" />
          <Skeleton className="h-8 w-64 mb-2" />
          <Skeleton className="h-4 w-48" />
        </div>
      </section>
      <section className="py-12">
        <div className="container mx-auto px-4 max-w-3xl space-y-8">
          <Card className="border-3 border-foreground p-8 shadow-[8px_8px_0px_0px_rgba(26,26,26,1)]">
            <div className="flex flex-col items-center gap-4">
              <Skeleton className="h-4 w-24" />
              <Skeleton className="h-12 w-32" />
              <Skeleton className="h-4 w-20" />
            </div>
          </Card>
          <Card className="border-3 border-foreground p-6 shadow-[4px_4px_0px_0px_rgba(26,26,26,1)]">
            <Skeleton className="h-5 w-36 mb-4" />
            <div className="space-y-4">
              {[1, 2, 3].map((i) => (
                <div key={i} className="flex items-center gap-3">
                  <Skeleton className="h-4 w-36" />
                  <Skeleton className="h-3 flex-1" />
                  <Skeleton className="h-4 w-8" />
                </div>
              ))}
            </div>
          </Card>
        </div>
      </section>
    </main>
  );
}

function ExpiredState({ rateLimited }: { rateLimited?: boolean }) {
  return (
    <main className="min-h-screen bg-background flex items-center justify-center px-4">
      <Card
        className="border-3 border-foreground p-8 sm:p-12 shadow-[4px_4px_0px_0px_rgba(26,26,26,1)] text-center max-w-md w-full"
        role="main"
      >
        {rateLimited ? (
          <Clock className="mx-auto h-16 w-16 text-muted-foreground" aria-hidden="true" />
        ) : (
          <Shield className="mx-auto h-16 w-16 text-muted-foreground" aria-hidden="true" />
        )}
        <h1 className="mt-4 font-mono text-xl font-bold">
          {rateLimited ? "Too Many Requests" : "Link Unavailable"}
        </h1>
        {rateLimited ? (
          <Alert className="mt-4 text-left">
            <AlertTitle>Slow down a bit</AlertTitle>
            <AlertDescription>
              This page has been viewed too many times recently. Please wait a
              minute and try again.
            </AlertDescription>
          </Alert>
        ) : (
          <p className="mt-2 text-muted-foreground">
            This share link has expired or is no longer valid. Ask the tenant
            to generate a new link from their Shelterflex profile.
          </p>
        )}
        <Link href="/">
          <Button className="mt-6 border-3 border-foreground bg-primary font-bold shadow-[4px_4px_0px_0px_rgba(26,26,26,1)]">
            <Home className="mr-2 h-4 w-4" aria-hidden="true" />
            Go to Shelterflex
          </Button>
        </Link>
      </Card>
    </main>
  );
}

function renderStars(score: number) {
  return (
    <span className="flex items-center gap-0.5" aria-label={`${score} out of 5 stars`}>
      {Array.from({ length: 5 }, (_, i) => (
        <Star
          key={i}
          aria-hidden="true"
          className={`h-5 w-5 ${
            i < Math.round(score)
              ? "fill-primary text-primary"
              : "text-muted-foreground"
          }`}
        />
      ))}
    </span>
  );
}

function ScoreBar({ label, score }: { label: string; score: number }) {
  const pct = Math.round((score / 5) * 100);
  return (
    <div className="flex items-center gap-3">
      <span className="w-36 text-sm font-medium text-muted-foreground shrink-0">
        {label}
      </span>
      <div
        className="flex-1 h-3 border-2 border-foreground bg-muted"
        role="progressbar"
        aria-label={`${label}: ${score} out of 5`}
        aria-valuenow={score}
        aria-valuemin={0}
        aria-valuemax={5}
      >
        <div
          className="h-full bg-primary transition-all"
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className="w-8 text-right font-mono font-bold" aria-hidden="true">
        {score}
      </span>
    </div>
  );
}

function SuccessPage({ card }: { card: PublicRatingCard }) {
  const hasRatings = card.ratings.length > 0;

  return (
    <main className="min-h-screen bg-background">
      <section className="border-b-3 border-foreground bg-muted py-8">
        <div className="container mx-auto px-4">
          <div className="flex items-center gap-2 text-sm text-muted-foreground mb-2">
            <Shield className="h-4 w-4" aria-hidden="true" />
            <span>Verified Tenant Rating Card</span>
          </div>
          <h1 className="font-mono text-2xl font-black md:text-3xl">
            Tenant <span className="text-primary">Reputation</span>
          </h1>
          <p className="text-muted-foreground">
            Shared via Shelterflex —{" "}
            {card.totalRatings} landlord rating
            {card.totalRatings !== 1 ? "s" : ""}
          </p>
        </div>
      </section>

      <section className="py-12">
        <div className="container mx-auto px-4 max-w-3xl">
          {/* Composite Score & Score Breakdown */}
          <RatingCard card={card as any} variant="full" className="mb-8" />

          {/* Individual Ratings or Empty State */}
          <Card className="border-3 border-foreground p-6 shadow-[4px_4px_0px_0px_rgba(26,26,26,1)]">
            <h2 className="mb-4 font-bold">Rating History</h2>
            {hasRatings ? (
              <ol className="space-y-4 list-none">
                {card.ratings.map((rating, index) => {
                  const avg =
                    (rating.paymentScore +
                      rating.propertyCareScore +
                      rating.communicationScore) /
                    3;
                  return (
                    <li key={index} className="border-2 border-foreground p-4">
                      <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
                        {renderStars(avg)}
                        <time
                          dateTime={rating.createdAt}
                          className="text-sm text-muted-foreground"
                        >
                          {formatDate(rating.createdAt)}
                        </time>
                      </div>
                      <div className="grid grid-cols-3 gap-4 mb-3">
                        <div>
                          <p className="text-xs text-muted-foreground">Payment</p>
                          <p className="font-mono font-bold">{rating.paymentScore}/5</p>
                        </div>
                        <div>
                          <p className="text-xs text-muted-foreground">Property Care</p>
                          <p className="font-mono font-bold">{rating.propertyCareScore}/5</p>
                        </div>
                        <div>
                          <p className="text-xs text-muted-foreground">Communication</p>
                          <p className="font-mono font-bold">{rating.communicationScore}/5</p>
                        </div>
                      </div>
                      {rating.comment && (
                        <blockquote className="text-sm text-muted-foreground italic border-l-2 border-muted pl-3">
                          {rating.comment}
                        </blockquote>
                      )}
                    </li>
                  );
                })}
              </ol>
            ) : (
              <Empty className="border-0 py-8">
                <EmptyHeader>
                  <EmptyMedia variant="icon">
                    <Star aria-hidden="true" />
                  </EmptyMedia>
                  <EmptyTitle>No ratings yet</EmptyTitle>
                  <EmptyDescription>
                    This tenant hasn&apos;t received any landlord ratings yet.
                    Their overall score will appear once a landlord submits a
                    review.
                  </EmptyDescription>
                </EmptyHeader>
              </Empty>
            )}
          </Card>

          <div className="mt-8 text-center text-sm text-muted-foreground">
            <p>
              Powered by{" "}
              <Link href="/" className="font-bold text-primary underline underline-offset-4">
                Shelterflex
              </Link>
            </p>
          </div>
        </div>
      </section>
    </main>
  );
}

export default function SharedRatingCardPage() {
  const params = useParams();
  const token = params.token as string | undefined;

  // derive initial state from token to avoid synchronous setState inside the effect
  const [state, setState] = useState<PageState>(() =>
    token ? { status: "loading" } : { status: "expired" }
  );

  useEffect(() => {
    if (!token) return; // nothing to do when token is missing

    let mounted = true;

    getSharedRatingCard(token)
      .then((res) => {
        if (!mounted) return;
        setState({ status: "success", card: res.data });
      })
      .catch((err: unknown) => {
        if (!mounted) return;
        if (err instanceof ApiError) {
          if (err.status === 429) {
            setState({ status: "rate-limited" });
            return;
          }
          if (err.status === 404 || err.status === 410) {
            setState({ status: "expired" });
            return;
          }
        }
        setState({ status: "expired" });
      });

    return () => {
      mounted = false;
    };
  }, [token]);

  if (state.status === "loading") return <LoadingSkeleton />;
  if (state.status === "rate-limited") return <ExpiredState rateLimited />;
  if (state.status === "expired") return <ExpiredState />;
  return <SuccessPage card={state.card} />;
}
