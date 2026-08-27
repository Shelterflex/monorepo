"use client";

import { useState, useEffect, useCallback } from "react";
import { useSearchParams, useRouter, usePathname } from "next/navigation";
import {
  Star,
  Filter,
  ArrowUpDown,
  CheckCircle2,
  AlertCircle,
  Loader2,
  MessageSquare,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { formatDate } from "@/lib/date";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { useTranslations } from "next-intl";
import { getApartmentReviews } from "@/lib/reviewApi";
import type { Review } from "@/lib/types/reviews";
import { sanitizeText } from "@/lib/sanitize";
import { cn } from "@/lib/utils";

interface ApartmentReviewsProps {
  propertyId: string;
}

export function ApartmentReviews({ propertyId }: ApartmentReviewsProps) {
  const t = useTranslations("reviews");
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const ratingFilter = searchParams.get("rating") || "all";
  const sortBy = searchParams.get("sort") || "newest";
  const verifiedOnly = searchParams.get("verified") === "true";
  const page = Number(searchParams.get("page")) || 1;

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reviews, setReviews] = useState<Review[]>([]);
  const [totalPages, setTotalPages] = useState(1);
  const [total, setTotal] = useState(0);
  const [aggregateRating, setAggregateRating] = useState<number | null>(null);

  const fetchReviews = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await getApartmentReviews({
        apartmentId: propertyId,
        rating: ratingFilter !== "all" ? Number(ratingFilter) : undefined,
        verifiedStay: verifiedOnly || undefined,
        sortBy: sortBy as "newest" | "oldest" | "rating_desc" | "rating_asc",
        page,
        pageSize: 10,
      });
      setReviews(result.reviews);
      setTotalPages(result.totalPages);
      setTotal(result.total);
      setAggregateRating(result.aggregateRating ?? null);
    } catch {
      setError(t("errorTitle"));
    } finally {
      setLoading(false);
    }
  }, [propertyId, ratingFilter, sortBy, verifiedOnly, page, t]);

  useEffect(() => {
    fetchReviews();
  }, [fetchReviews]);

  const updateFilters = (key: string, value: string | boolean) => {
    const params = new URLSearchParams(searchParams.toString());
    if (value === "all" || value === false || value === "") {
      params.delete(key);
    } else {
      params.set(key, String(value));
    }
    params.delete("page");
    router.replace(`${pathname}?${params.toString()}`, { scroll: false });
  };

  const goToPage = (newPage: number) => {
    const params = new URLSearchParams(searchParams.toString());
    if (newPage <= 1) {
      params.delete("page");
    } else {
      params.set("page", String(newPage));
    }
    router.replace(`${pathname}?${params.toString()}`, { scroll: false });
  };

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center py-12">
        <Loader2 className="h-8 w-8 animate-spin text-primary mb-4" />
        <p className="text-muted-foreground font-mono">{t("loading")}</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="border-3 border-destructive bg-destructive/10 p-6 text-center shadow-[4px_4px_0px_0px_rgba(26,26,26,1)]">
        <AlertCircle className="mx-auto h-12 w-12 text-destructive mb-4" />
        <h3 className="font-bold text-destructive mb-2">{t("errorTitle")}</h3>
        <p className="text-sm text-destructive/80 mb-4">{error}</p>
        <Button
          variant="outline"
          className="border-2 border-destructive text-destructive hover:bg-destructive/20"
          onClick={() => void fetchReviews()}
        >
          {t("tryAgain")}
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {aggregateRating !== null && total > 0 && (
        <div className="flex items-center gap-4 border-3 border-foreground bg-card p-4 shadow-[4px_4px_0px_0px_rgba(26,26,26,1)]">
          <div className="flex items-center gap-2">
            <Star className="h-6 w-6 fill-primary text-primary" />
            <span className="font-mono text-2xl font-black">
              {aggregateRating.toFixed(1)}
            </span>
          </div>
          <p className="text-sm text-muted-foreground">
            {total} {total === 1 ? "review" : "reviews"}
          </p>
        </div>
      )}

      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between border-3 border-foreground bg-card p-4 shadow-[4px_4px_0px_0px_rgba(26,26,26,1)]">
        <div className="flex items-center gap-2">
          <Filter className="h-5 w-5" />
          <h2 className="font-mono text-lg font-bold">{t("filters")}</h2>
        </div>

        <div className="flex flex-wrap gap-4 items-center">
          <div className="flex items-center gap-2">
            <Label htmlFor="rating-filter" className="text-sm font-bold">
              {t("rating")}:
            </Label>
            <Select
              value={ratingFilter}
              onValueChange={(v) => void updateFilters("rating", v)}
            >
              <SelectTrigger
                id="rating-filter"
                className="w-[120px] border-2 border-foreground"
              >
                <SelectValue placeholder={t("allStars")} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t("allStars")}</SelectItem>
                <SelectItem value="5">{t("stars5")}</SelectItem>
                <SelectItem value="4">{t("stars4")}</SelectItem>
                <SelectItem value="3">{t("stars3")}</SelectItem>
                <SelectItem value="2">{t("stars2")}</SelectItem>
                <SelectItem value="1">{t("stars1")}</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="flex items-center gap-2">
            <Label htmlFor="sort-order" className="text-sm font-bold">
              {t("sort")}:
            </Label>
            <Select
              value={sortBy}
              onValueChange={(v) => void updateFilters("sort", v)}
            >
              <SelectTrigger
                id="sort-order"
                className="w-[150px] border-2 border-foreground"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="newest">{t("newest")}</SelectItem>
                <SelectItem value="highest">{t("highest")}</SelectItem>
                <SelectItem value="lowest">{t("lowest")}</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="flex items-center gap-2 border-2 border-foreground px-3 py-1.5 bg-background">
            <Checkbox
              id="verified-only"
              checked={verifiedOnly}
              onCheckedChange={(v) => void updateFilters("verified", !!v)}
              className="border-2 border-foreground"
            />
            <Label htmlFor="verified-only" className="text-sm font-bold cursor-pointer">
              {t("verifiedStay")}
            </Label>
          </div>
        </div>
      </div>

      {reviews.length === 0 ? (
        <div className="border-3 border-foreground border-dashed p-12 text-center bg-muted/30">
          <MessageSquare className="mx-auto h-12 w-12 text-muted-foreground mb-4 opacity-50" />
          <p className="font-mono text-lg font-bold">{t("noReviews")}</p>
          <p className="text-muted-foreground mt-2">{t("adjustFilters")}</p>
          {(ratingFilter !== "all" || verifiedOnly) && (
            <Button
              variant="link"
              className="mt-2 text-primary font-bold"
              onClick={() => {
                const params = new URLSearchParams(searchParams.toString());
                params.delete("rating");
                params.delete("verified");
                router.replace(`${pathname}?${params.toString()}`, {
                  scroll: false,
                });
              }}
            >
              {t("clearFilters")}
            </Button>
          )}
        </div>
      ) : (
        <>
          <div className="grid gap-4">
            {reviews.map((review) => {
              const safeUserName = sanitizeText(review.userName ?? "Anonymous");
              const safeComment = sanitizeText(review.content);
              return (
                <Card
                  key={review.id}
                  className="border-3 border-foreground shadow-[4px_4px_0px_0px_rgba(26,26,26,1)] overflow-hidden"
                >
                  <CardContent className="p-6">
                    <div className="flex justify-between items-start mb-4">
                      <div className="flex items-center gap-3">
                        <div className="h-10 w-10 border-2 border-foreground bg-secondary flex items-center justify-center font-bold">
                          {safeUserName.charAt(0)}
                        </div>
                        <div>
                          <p className="font-bold">{safeUserName}</p>
                          <p className="text-xs text-muted-foreground">
                            {formatDate(review.date, {
                              dateStyle: "medium",
                            })}
                          </p>
                        </div>
                      </div>
                      <div className="flex items-center gap-1 bg-primary/10 border-2 border-primary px-2 py-0.5">
                        <Star className="h-3 w-3 fill-primary text-primary" />
                        <span className="text-xs font-black">
                          {review.rating}
                        </span>
                      </div>
                    </div>

                    <div className="space-y-3">
                      {review.verifiedStay && (
                        <div className="inline-flex items-center gap-1 bg-secondary/20 text-secondary border border-secondary px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider">
                          <CheckCircle2 className="h-3 w-3" />
                          Verified Stay
                        </div>
                      )}
                      <p className="text-sm leading-relaxed text-foreground">
                        {safeComment}
                      </p>
                    </div>

                    <div className="mt-4 flex items-center gap-4 border-t-2 border-dashed border-foreground/10 pt-4">
                      <button className="text-xs font-bold text-muted-foreground hover:text-foreground transition-colors flex items-center gap-1">
                        {t("helpful")} ({review.helpfulCount})
                      </button>
                      <button className="text-xs font-bold text-muted-foreground hover:text-foreground transition-colors">
                        {t("report")}
                      </button>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>

          {totalPages > 1 && (
            <div className="flex items-center justify-center gap-4 border-3 border-foreground bg-card p-4 shadow-[4px_4px_0px_0px_rgba(26,26,26,1)]">
              <Button
                variant="outline"
                className="border-2 border-foreground"
                disabled={page <= 1}
                onClick={() => void goToPage(page - 1)}
              >
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <span className="font-mono text-sm font-bold">
                {page} / {totalPages}
              </span>
              <Button
                variant="outline"
                className="border-2 border-foreground"
                disabled={page >= totalPages}
                onClick={() => void goToPage(page + 1)}
              >
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
