"use client";

import { Card } from "@/components/ui/card";
import RatingDimension, { StarRating } from "@/components/tenant/RatingDimension";
import type {
  TenantRatingCard as TenantRatingCardType,
  PublicRatingCard as PublicRatingCardType,
} from "@/lib/ratingCardApi";

interface RatingCardProps {
  card: TenantRatingCardType | PublicRatingCardType | {
    compositeScore: number;
    paymentScore: number;
    propertyCareScore: number;
    communicationScore: number;
    totalRatings: number;
  };
  variant?: "full" | "compact";
  className?: string;
}

export default function RatingCard({
  card,
  variant = "full",
  className = "",
}: RatingCardProps) {
  if (variant === "compact") {
    return (
      <Card className={`border-3 border-foreground p-4 shadow-[4px_4px_0px_0px_rgba(26,26,26,1)] ${className}`}>
        <div className="flex items-center gap-4">
          <div className="text-center">
            <p className="text-3xl font-mono font-black text-primary">
              {card.compositeScore}
            </p>
            <StarRating score={card.compositeScore} size="sm" />
          </div>
          <div className="flex-1 space-y-1">
            <RatingDimension label="Payment" score={card.paymentScore} />
            <RatingDimension label="Property Care" score={card.propertyCareScore} />
            <RatingDimension label="Communication" score={card.communicationScore} />
          </div>
        </div>
        <p className="mt-2 text-xs text-muted-foreground">
          Based on {card.totalRatings} rating{card.totalRatings !== 1 ? "s" : ""}
        </p>
      </Card>
    );
  }

  return (
    <Card className={`border-3 border-foreground p-6 shadow-[4px_4px_0px_0px_rgba(26,26,26,1)] ${className}`}>
      <div className="text-center mb-6">
        <p className="text-sm text-muted-foreground mb-2">Composite Score</p>
        <div className="flex items-center justify-center gap-1 mb-2">
          <StarRating score={card.compositeScore} size="lg" />
        </div>
        <p className="text-5xl font-mono font-black text-primary">
          {card.compositeScore}
        </p>
        <p className="text-sm text-muted-foreground mt-1">out of 5.0</p>
      </div>

      <div className="space-y-4">
        <h4 className="font-bold text-sm">Score Breakdown</h4>
        <RatingDimension label="Payment History" score={card.paymentScore} />
        <RatingDimension label="Property Care" score={card.propertyCareScore} />
        <RatingDimension label="Communication" score={card.communicationScore} />
      </div>

      {card.totalRatings > 0 && (
        <p className="mt-4 text-sm text-muted-foreground">
          Based on {card.totalRatings} rating{card.totalRatings !== 1 ? "s" : ""} from landlords
        </p>
      )}
    </Card>
  );
}

export function RatingCardEmpty() {
  return (
    <Card className="border-3 border-foreground p-12 shadow-[4px_4px_0px_0px_rgba(26,26,26,1)] text-center">
      <div className="flex justify-center mb-4">
        <StarRating score={0} size="lg" />
      </div>
      <h3 className="font-bold text-lg mb-2">No Ratings Yet</h3>
      <p className="text-sm text-muted-foreground">
        Your rating card will appear here once landlords rate you after
        completed deals.
      </p>
    </Card>
  );
}
