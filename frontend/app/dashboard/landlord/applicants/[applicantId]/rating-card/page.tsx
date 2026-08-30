"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { ArrowLeft, Home, ShieldAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { getRatingCard, type PublicRatingCard } from "@/lib/ratingCardApi";
import { StarRating } from "@/components/tenant/RatingDimension";
import { formatDate } from "@/lib/date";
import RatingCard from "@/components/tenant/RatingCard";

export default function LandlordRatingCardPage() {
  const params = useParams();
  const applicantId = params.applicantId as string;
  const [card, setCard] = useState<PublicRatingCard | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [hasAccess, setHasAccess] = useState(false);

  useEffect(() => {
    getRatingCard(applicantId)
      .then((res) => {
        setCard(res.data);
        setHasAccess(true);
      })
      .catch(() => {
        setHasAccess(false);
      })
      .finally(() => setIsLoading(false));
  }, [applicantId]);

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

  if (!hasAccess || !card) {
    return (
      <main className="min-h-screen bg-background flex items-center justify-center">
        <Card className="border-3 border-foreground p-12 shadow-[6px_6px_0px_0px_rgba(26,26,26,1)] text-center max-w-md">
          <ShieldAlert className="mx-auto h-16 w-16 text-muted-foreground mb-4" />
          <h1 className="font-mono text-2xl font-black mb-2">Access Denied</h1>
          <p className="text-muted-foreground mb-6">
            You don&apos;t have permission to view this tenant&apos;s rating card, or
            the applicant does not have a rating card yet.
          </p>
          <Link href="/dashboard/landlord">
            <Button className="border-3 border-foreground bg-primary px-6 py-3 font-bold shadow-[4px_4px_0px_0px_rgba(26,26,26,1)]">
              Back to Dashboard
            </Button>
          </Link>
        </Card>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-background">
      <div className="border-b-3 border-foreground bg-muted">
        <div className="container mx-auto px-4 py-4">
          <Link
            href="/dashboard/landlord"
            className="flex items-center gap-2 font-mono font-bold text-foreground hover:text-primary transition-colors"
          >
            <ArrowLeft className="h-5 w-5" />
            Back to Dashboard
          </Link>
        </div>
      </div>

      <section className="py-8">
        <div className="container mx-auto px-4 max-w-2xl">
          <div className="mb-8">
            <h1 className="font-mono text-2xl font-black md:text-3xl">Tenant Rating Card</h1>
            <p className="text-muted-foreground mt-1">
              Reputation profile for applicant #{applicantId.slice(0, 8)}
            </p>
          </div>

          <div className="space-y-6">
            <RatingCard card={card as any} variant="full" />

            <Card className="border-3 border-foreground p-6 shadow-[6px_6px_0px_0px_rgba(26,26,26,1)]">
              <div className="space-y-4">
                {card.ratings.length > 0 ? (
                  <>
                    <h4 className="font-bold">Rating Details</h4>
                    {card.ratings.map((rating, i) => (
                      <div key={i} className="border-2 border-foreground p-4">
                        <div className="flex items-center justify-between mb-3">
                          <StarRating
                            score={
                              (rating.paymentScore +
                                rating.propertyCareScore +
                                rating.communicationScore) /
                              3
                            }
                            size="sm"
                          />
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
                  </>
                ) : (
                  <div className="text-center py-8">
                    <Home className="mx-auto h-12 w-12 text-muted-foreground" />
                    <p className="mt-2 text-muted-foreground">
                      No individual ratings available yet.
                    </p>
                  </div>
                )}
              </div>

              <p className="mt-4 text-sm text-muted-foreground">
                Based on {card.totalRatings} rating{card.totalRatings !== 1 ? "s" : ""}
              </p>
            </Card>
          </div>
        </div>
      </section>
    </main>
  );
}
