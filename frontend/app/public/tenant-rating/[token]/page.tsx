"use client";

import { useState, useEffect } from "react";
import { Home, ShieldCheck, AlertCircle } from "lucide-react";
import { Card } from "@/components/ui/card";
import { getSharedRatingCard, type PublicRatingCard } from "@/lib/ratingCardApi";
import { StarRating } from "@/components/tenant/RatingDimension";
import { formatDate } from "@/lib/date";
import RatingCard from "@/components/tenant/RatingCard";

export default function SharedRatingCardPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const [card, setCard] = useState<PublicRatingCard | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [token, setToken] = useState<string | null>(null);

  useEffect(() => {
    params.then((p) => setToken(p.token));
  }, [params]);

  useEffect(() => {
    if (!token) return;
    getSharedRatingCard(token)
      .then((res) => setCard(res.data))
      .catch((err) => {
        setError(err?.message || "This rating card link is invalid or has expired.");
      })
      .finally(() => setIsLoading(false));
  }, [token]);

  if (isLoading) {
    return (
      <main className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-center">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-foreground border-t-transparent mx-auto" />
          <p className="mt-4 text-muted-foreground">Loading rating card...</p>
        </div>
      </main>
    );
  }

  if (error || !card) {
    return (
      <main className="min-h-screen bg-background flex items-center justify-center p-4">
        <Card className="border-3 border-foreground p-12 shadow-[6px_6px_0px_0px_rgba(26,26,26,1)] text-center max-w-md">
          <AlertCircle className="mx-auto h-16 w-16 text-destructive mb-4" />
          <h1 className="font-mono text-2xl font-black mb-2">Link Expired or Invalid</h1>
          <p className="text-muted-foreground">
            {error || "This rating card link is invalid or has expired. Ask the tenant to generate a new share link."}
          </p>
        </Card>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-background">
      <section className="py-8">
        <div className="container mx-auto px-4 max-w-2xl">
          <RatingCard card={card as any} variant="full" className="mb-8" />

          <Card className="border-3 border-foreground p-6 shadow-[6px_6px_0px_0px_rgba(26,26,26,1)]">
            <h2 className="font-mono text-lg font-bold mb-6">Tenant Reputation Profile</h2>

            {card.ratings.length > 0 ? (
              <div className="space-y-4">
                {card.ratings.map((rating, i) => (
                  <div key={i} className="border-3 border-foreground p-4">
                    <div className="flex items-center justify-between mb-3">
                      <div className="flex items-center gap-2">
                        <StarRating
                          score={
                            (rating.paymentScore +
                              rating.propertyCareScore +
                              rating.communicationScore) /
                            3
                          }
                          size="sm"
                        />
                      </div>
                      <span className="text-sm text-muted-foreground">
                        {formatDate(rating.createdAt)}
                      </span>
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
                      <p className="text-sm text-muted-foreground italic">
                        &quot;{rating.comment}&quot;
                      </p>
                    )}
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-center py-12">
                <Home className="mx-auto h-16 w-16 text-muted-foreground" />
                <p className="mt-2 text-muted-foreground">
                  No individual ratings yet.
                </p>
              </div>
            )}
          </Card>

          <p className="mt-6 text-center text-xs text-muted-foreground">
            Powered by ShelterFlex &middot; Tenant Rating Card
          </p>
        </div>
      </section>
    </main>
  );
}
