"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import {
  Star,
  Share2,
  Copy,
  Check,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { DashboardHeader } from "@/components/dashboard-header";
import { DashboardSidebar } from "@/components/dashboard/DashboardSidebar";
import {
  getRatingCard,
  generateShareToken,
  type TenantRatingCard,
} from "@/lib/ratingCardApi";
import { formatDate } from "@/lib/date";

export default function TenantRatingCardPage() {
  const [card, setCard] = useState<TenantRatingCard | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [shareLink, setShareLink] = useState<string | null>(null);
  const [isCopied, setIsCopied] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);

  // In a real app, get tenantId from auth context
  const tenantId = "current-user";

  useEffect(() => {
    getRatingCard(tenantId)
      .then((res) => setCard(res.data))
      .catch(() => setCard(null))
      .finally(() => setIsLoading(false));
  }, [tenantId]);

  const handleShare = async () => {
    setIsGenerating(true);
    try {
      const result = await generateShareToken(tenantId);
      const link = `${window.location.origin}/rating-card/${result.data.token}`;
      setShareLink(link);
    } catch (error) {
      console.error("Failed to generate share token:", error);
    } finally {
      setIsGenerating(false);
    }
  };

  const handleCopy = async () => {
    if (shareLink) {
      await navigator.clipboard.writeText(shareLink);
      setIsCopied(true);
      setTimeout(() => setIsCopied(false), 2000);
    }
  };

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
            <Card className="border-3 border-foreground p-12 shadow-[4px_4px_0px_0px_rgba(26,26,26,1)] text-center">
              <Star className="mx-auto h-16 w-16 text-muted-foreground" />
              <h3 className="mt-4 font-bold text-lg">No Ratings Yet</h3>
              <p className="mt-2 text-sm text-muted-foreground">
                Your rating card will appear here once landlords rate you after
                completed deals.
              </p>
            </Card>
          ) : (
            <div className="space-y-6">
              {/* Score Overview */}
              <div className="grid gap-6 lg:grid-cols-3">
                {/* Composite Score */}
                <Card className="border-3 border-foreground p-6 shadow-[4px_4px_0px_0px_rgba(26,26,26,1)]">
                  <div className="text-center">
                    <p className="text-sm text-muted-foreground mb-2">
                      Composite Score
                    </p>
                    <div className="flex items-center justify-center gap-1 mb-2">
                      {renderStars(card.compositeScore)}
                    </div>
                    <p className="text-5xl font-mono font-black text-primary">
                      {card.compositeScore}
                    </p>
                    <p className="text-sm text-muted-foreground mt-1">
                      out of 5.0
                    </p>
                  </div>
                </Card>

                {/* Score Breakdown */}
                <Card className="border-3 border-foreground p-6 shadow-[4px_4px_0px_0px_rgba(26,26,26,1)] lg:col-span-2">
                  <h3 className="mb-4 font-bold">Score Breakdown</h3>
                  <div className="space-y-4">
                    {renderScoreBar("Payment History", card.paymentScore)}
                    {renderScoreBar("Property Care", card.propertyCareScore)}
                    {renderScoreBar(
                      "Communication",
                      card.communicationScore,
                    )}
                  </div>
                  <p className="mt-4 text-sm text-muted-foreground">
                    Based on {card.totalRatings} rating
                    {card.totalRatings !== 1 ? "s" : ""} from landlords
                  </p>
                </Card>
              </div>

              {/* Share Card */}
              <Card className="border-3 border-foreground p-6 shadow-[4px_4px_0px_0px_rgba(26,26,26,1)]">
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="font-bold">Share Your Rating Card</h3>
                    <p className="text-sm text-muted-foreground">
                      Generate a shareable link for prospective landlords
                    </p>
                  </div>
                  <Button
                    onClick={handleShare}
                    disabled={isGenerating}
                    className="border-3 border-foreground bg-primary font-bold shadow-[4px_4px_0px_0px_rgba(26,26,26,1)]"
                  >
                    <Share2 className="mr-2 h-4 w-4" />
                    {isGenerating ? "Generating..." : "Generate Link"}
                  </Button>
                </div>

                {shareLink && (
                  <div className="mt-4 flex items-center gap-2 border-3 border-foreground bg-muted p-3">
                    <input
                      type="text"
                      value={shareLink}
                      readOnly
                      aria-label="Shareable rating card link"
                      className="flex-1 bg-transparent text-sm font-mono outline-none"
                    />
                    <Button
                      size="sm"
                      onClick={handleCopy}
                      className="border-2 border-foreground bg-background font-bold"
                    >
                      {isCopied ? (
                        <Check className="h-4 w-4" />
                      ) : (
                        <Copy className="h-4 w-4" />
                      )}
                    </Button>
                  </div>
                )}

                <p className="mt-2 text-xs text-muted-foreground">
                  Share links expire after 48 hours. Generate a new one as
                  needed.
                </p>
              </Card>

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
                              3,
                          )}
                        </div>
                        <span className="text-sm text-muted-foreground">
                          {formatDate(rating.createdAt)}
                        </span>
                      </div>

                      <div className="grid grid-cols-3 gap-4 mb-3">
                        <div>
                          <p className="text-xs text-muted-foreground">
                            Payment
                          </p>
                          <p className="font-mono font-bold">
                            {rating.paymentScore}/5
                          </p>
                        </div>
                        <div>
                          <p className="text-xs text-muted-foreground">
                            Property Care
                          </p>
                          <p className="font-mono font-bold">
                            {rating.propertyCareScore}/5
                          </p>
                        </div>
                        <div>
                          <p className="text-xs text-muted-foreground">
                            Communication
                          </p>
                          <p className="font-mono font-bold">
                            {rating.communicationScore}/5
                          </p>
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
              </Card>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
