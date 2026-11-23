"use client";

/**
 * Public share view (#1923). Fetches the public endpoint; expired, revoked
 * or unknown tokens get a friendly "no longer active" screen instead of an
 * error. The token is read from the URL and sent only to the rating-card
 * public endpoint — never to analytics or the console.
 */
import { useEffect, useState } from "react";
import { ShieldCheck } from "lucide-react";
import { Card } from "@/components/ui/card";
import { LoadingState } from "@/components/ui/data-state";
import { formatDecimal } from "@/lib/currency";
import {
  getPublicRatingCard,
  RatingCardUnavailableError,
  type PublicRatingCard,
} from "@/lib/tenantRatingCardApi";

export function PublicRatingCardView() {
  const [state, setState] = useState<
    { phase: "loading" } | { phase: "ready"; card: PublicRatingCard } | { phase: "gone" } | { phase: "error"; message: string }
  >({ phase: "loading" });

  useEffect(() => {
    let cancelled = false;
    const token = window.location.pathname.split("/").pop() ?? "";
    void (async () => {
      try {
        const card = await getPublicRatingCard(token);
        if (!cancelled) setState({ phase: "ready", card });
      } catch (error) {
        if (cancelled) return;
        if (error instanceof RatingCardUnavailableError) {
          setState({ phase: "gone" });
        } else {
          setState({
            phase: "error",
            message: "This rating card could not be loaded right now. Try again later.",
          });
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (state.phase === "loading") {
    return <LoadingState label="Loading rating card" />;
  }

  if (state.phase === "gone") {
    return (
      <Centered>
        <Card className="border-3 border-foreground p-8 text-center shadow-[4px_4px_0px_0px_rgba(26,26,26,1)]">
          <ShieldCheck className="mx-auto h-10 w-10 text-muted-foreground" aria-hidden="true" />
        <h1 className="mt-3 font-mono text-xl font-black">Link no longer active</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          This rating card link has expired or was revoked by the tenant who shared it.
        </p>
        </Card>
      </Centered>
    );
  }

  if (state.phase === "error") {
    return (
      <Centered>
        <Card className="border-3 border-destructive bg-destructive/10 p-8 text-center">
          <h1 className="font-mono text-xl font-black">Something went wrong</h1>
          <p className="mt-2 text-sm text-muted-foreground">{state.message}</p>
        </Card>
      </Centered>
    );
  }

  const { card } = state;
  return (
    <Centered>
      <Card className="w-full max-w-md border-3 border-foreground p-6 shadow-[4px_4px_0px_0px_rgba(26,26,26,1)]">
        <p className="text-sm text-muted-foreground">Tenant rating card</p>
        <h1 className="font-mono text-2xl font-black">{card.displayName ?? "Tenant"}</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {card.count > 0
            ? `${card.count} landlord rating${card.count === 1 ? "" : "s"}`
            : "No landlord ratings yet"}
        </p>

        {card.count > 0 && (
          <>
            <div className="mt-4 border-2 border-foreground/20 p-3">
              <p className="text-sm text-muted-foreground">Overall</p>
              <p className="font-mono text-3xl font-black">
                {card.averages.overall === null ? "—" : formatDecimal(card.averages.overall)}
                <span className="text-base font-normal text-muted-foreground"> / 5</span>
              </p>
            </div>
            <dl className="mt-3 grid grid-cols-3 gap-2 text-sm">
              {(
                [
                  ["paymentTimeliness", "Payments"],
                  ["propertyCare", "Care"],
                  ["communication", "Comms"],
                ] as const
              ).map(([dimension, label]) => (
                <div key={dimension} className="border-2 border-foreground/20 p-2 text-center">
                  <dt className="text-xs text-muted-foreground">{label}</dt>
                  <dd className="font-mono font-black">
                    {card.averages[dimension] === null ? "—" : formatDecimal(card.averages[dimension] as number)}
                  </dd>
                </div>
              ))}
            </dl>
            {card.recentComments.length > 0 && (
              <ul className="mt-4 space-y-2">
                {card.recentComments.map((comment, index) => (
                  <li key={`${index}-${comment.slice(0, 16)}`} className="border-2 border-foreground/20 p-2 text-sm">
                    “{comment}”
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </Card>
    </Centered>
  );
}

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <main id="main-content" className="flex min-h-screen items-center justify-center bg-background px-4 py-10">
      {children}
    </main>
  );
}
