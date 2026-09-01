"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import {
  Star,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { DashboardHeader } from "@/components/dashboard-header";
import { DashboardSidebar } from "@/components/dashboard/DashboardSidebar";
import RatingCard, { RatingCardEmpty } from "@/components/tenant/RatingCard";
import ShareCardModal from "@/components/tenant/ShareCardModal";
import {
  getRatingCard,
  type TenantRatingCard,
} from "@/lib/ratingCardApi";
import { formatDate } from "@/lib/date";

export default function TenantRatingCardPage() {
  const [card, setCard] = useState<TenantRatingCard | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  // In a real app, get tenantId from auth context
  const tenantId = "current-user";

  useEffect(() => {
    getRatingCard(tenantId)
      .then((res) => setCard(res.data))
      .catch(() => setCard(null))
      .finally(() => setIsLoading(false));
  }, [tenantId]);


  const renderScoreBar = (label: string, score: number) => (
    <div className="flex items-center gap-3">
      <span className="w-32 text-sm font-medium text-muted-foreground">
        {label}
      </span>
      <div className="flex-1 h-3 border-2 border-foreground bg-muted">
        <div
          className="h-full bg-primary transition-all"
          style={{ width: `${(score / 5) * 100}%` }}
        />
      </div>
      <span className="w-8 text-right font-mono font-bold">{score}</span>
    </div>
  );

  const renderStars = (score: number) => {
    return Array.from({ length: 5 }, (_, i) => (
      <Star
        key={i}
        className={`h-4 w-4 ${
          i < Math.round(score)
            ? "fill-primary text-primary"
            : "text-muted-foreground"
        }`}
      />
    ));
  };

  return (
    <div className="min-h-screen bg-background">
      <DashboardHeader />

      <DashboardSidebar
        role="tenant"
        userInfo={{ name: "Tenant", roleLabel: "Tenant" }}
      />

      {/* Main Content */}
      <main className="lg:ml-64 min-h-screen pt-20">
        <div className="p-8">
          {/* Header */}
          <div className="mb-8">
            <h1 className="text-3xl font-bold text-foreground">
              Tenant Rating Card
            </h1>
            <p className="mt-1 text-muted-foreground">
              Your portable reputation profile from past landlords
            </p>
          </div>

          {isLoading ? (
            <div className="grid gap-6 lg:grid-cols-3">
              {[1, 2, 3].map((i) => (
                <Card
                  key={i}
                  className="border-3 border-foreground p-6 shadow-[4px_4px_0px_0px_rgba(26,26,26,1)] animate-pulse"
                >
                  <div className="h-20 bg-muted rounded" />
                </Card>
              ))}
            </div>
          ) : !card || card.totalRatings === 0 ? (
            <RatingCardEmpty />
          ) : (
            <div className="space-y-6">
              {/* Score Overview */}
              <RatingCard card={card} variant="full" />

              {/* Share Card Modal */}
              <ShareCardModal tenantId={tenantId} />

              {/* Individual Ratings */}
              <Card className="border-3 border-foreground p-6 shadow-[4px_4px_0px_0px_rgba(26,26,26,1)]">
                <h3 className="mb-4 font-bold">Rating History</h3>
                <div className="space-y-4">
                  {card.ratings.map((rating) => (
                    <div
                      key={rating.ratingId}
                      className="border-2 border-foreground p-4"
                    >
                      <div className="flex items-center justify-between mb-3">
                        <div className="flex items-center gap-2">
                          {renderStars(
                            (rating.paymentScore +
                              rating.propertyCareScore +
                              rating.communicationScore) /
                              3
                          )}
                          <span className="text-sm font-medium ml-2">
                            Deal #{rating.dealId.slice(0, 8)}
                          </span>
                        </div>
                        <span className="text-sm text-muted-foreground">
                          {formatDate(rating.createdAt)}
                        </span>
                      </div>

                      <div className="space-y-2 mb-4">
                        {renderScoreBar("Payment Timeliness", rating.paymentScore)}
                        {renderScoreBar("Property Care", rating.propertyCareScore)}
                        {renderScoreBar("Communication", rating.communicationScore)}
                      </div>

                      {rating.comment && (
                        <p className="text-sm text-muted-foreground italic bg-muted p-3 border border-foreground">
                          &quot;{rating.comment}&quot;
                        </p>
                      )}
                    </div>
                  ))}
                </div>
              </Card>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
