"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowLeft, Star, CheckCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { getRateableWhistleblowers, submitWhistleblowerRating, type RateableWhistleblower } from "@/lib/api/whistleblowerRatingsApi";
import { useEffect, useCallback } from "react";
import { showErrorToast } from "@/lib/toast";

export default function RateWhistleblowerPage() {
  const [step, setStep] = useState<"select" | "rate" | "confirmation" | "loading">(
    "loading",
  );
  const [selectedWhistleblowerId, setSelectedWhistleblowerId] = useState<
    string | null
  >(null);
  const [rating, setRating] = useState<number>(0);
  const [hoverRating, setHoverRating] = useState<number>(0);
  const [review, setReview] = useState("");
  const [rateables, setRateables] = useState<RateableWhistleblower[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const fetchRateables = useCallback(async () => {
    try {
      const data = await getRateableWhistleblowers();
      setRateables(data);
      setStep("select");
    } catch (error) {
      showErrorToast(error, "Failed to load rateable whistleblowers");
      setStep("select");
    }
  }, []);

  useEffect(() => {
    fetchRateables();
  }, [fetchRateables]);

  const currentWhistleblower = rateables.find(
    (w) => w.id === selectedWhistleblowerId,
  );

  const handleSubmitRating = async () => {
    if (rating > 0 && currentWhistleblower) {
      try {
        setIsSubmitting(true);
        await submitWhistleblowerRating({
          whistleblowerId: currentWhistleblower.id,
          dealId: currentWhistleblower.dealId,
          rating,
          reviewText: review
        });
        setStep("confirmation");
        fetchRateables(); // refresh for next time
      } catch (err) {
        showErrorToast(err, "Failed to submit rating. You might have already rated this deal.");
      } finally {
        setIsSubmitting(false);
      }
    }
  };

  return (
    <div className="min-h-screen bg-background pt-20">
      <div className="container mx-auto px-4 py-8">
        <Link
          href="/dashboard/tenant"
          className="inline-flex items-center gap-2 mb-8 text-sm font-bold border-b-2 border-foreground hover:text-primary"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to Dashboard
        </Link>

        <div className="max-w-2xl mx-auto">
          {step === "loading" && (
            <div className="flex justify-center p-12">
              <span className="font-bold">Loading rateable whistleblowers...</span>
            </div>
          )}
          
          {/* Step 1: Select Whistleblower */}
          {step === "select" && (
            <>
              <Card className="border-3 border-foreground p-6 shadow-[4px_4px_0px_0px_rgba(26,26,26,1)] mb-6">
                <h1 className="text-3xl font-black mb-2">
                  Rate Your Whistleblower
                </h1>
                <p className="text-muted-foreground">
                  Your feedback helps other tenants find trusted residents and
                  helps whistleblowers improve
                </p>
              </Card>

              <div className="space-y-4">
                {rateables.length > 0 ? (
                  rateables.map((whistleblower) => (
                    <Card
                      key={whistleblower.id}
                      onClick={() => {
                        setSelectedWhistleblowerId(whistleblower.id);
                        setStep("rate");
                      }}
                      className="border-3 border-foreground p-4 cursor-pointer transition-all hover:shadow-[4px_4px_0px_0px_rgba(26,26,26,1)] shadow-[2px_2px_0px_0px_rgba(26,26,26,1)]"
                    >
                      <div className="flex items-start justify-between">
                        <div>
                          <h3 className="font-bold text-lg">
                            {whistleblower.name}
                          </h3>
                          <p className="text-sm text-muted-foreground">
                            {whistleblower.apartment}
                          </p>
                          <p className="text-xs text-muted-foreground mt-2">
                            Rented: {whistleblower.rentDate}
                          </p>
                        </div>
                        <div className="text-right">
                          <p className="font-bold text-xl">
                            {whistleblower.rating}⭐
                          </p>
                          <p className="text-xs text-muted-foreground">
                            {whistleblower.reviews} reviews
                          </p>
                        </div>
                      </div>
                    </Card>
                  ))
                ) : (
                  <Card className="border-3 border-foreground p-6 shadow-[4px_4px_0px_0px_rgba(26,26,26,1)]">
                    <div className="text-center">
                      <p className="font-bold mb-2">
                        No Whistleblowers to Rate
                      </p>
                      <p className="text-sm text-muted-foreground">
                        You've already rated all whistleblowers from your
                        rentals
                      </p>
                    </div>
                  </Card>
                )}
              </div>
            </>
          )}

          {/* Step 2: Rate Whistleblower */}
          {step === "rate" && currentWhistleblower && (
            <Card className="border-3 border-foreground p-6 shadow-[4px_4px_0px_0px_rgba(26,26,26,1)]">
              <div className="mb-6">
                <button
                  type="button"
                  onClick={() => {
                    setStep("select");
                    setSelectedWhistleblowerId(null);
                    setRating(0);
                    setReview("");
                  }}
                  className="inline-flex items-center gap-2 text-sm font-bold border-b-2 border-foreground hover:text-primary mb-6"
                >
                  <ArrowLeft className="h-4 w-4" />
                  Back
                </button>

                <div className="border-3 border-foreground bg-muted p-4 mb-6">
                  <p className="text-sm text-muted-foreground mb-2">
                    Rating for:
                  </p>
                  <h2 className="text-2xl font-black">
                    {currentWhistleblower.name}
                  </h2>
                  <p className="text-sm text-muted-foreground">
                    {currentWhistleblower.apartment}
                  </p>
                </div>
              </div>

              {/* Star Rating */}
              <div className="mb-6">
                <p className="text-sm font-bold mb-4">
                  How would you rate this whistleblower?
                </p>
                <div className="flex gap-2 mb-4">
                  {[1, 2, 3, 4, 5].map((star) => (
                    <button
                      key={star}
                      onClick={() => setRating(star)}
                      onMouseEnter={() => setHoverRating(star)}
                      onMouseLeave={() => setHoverRating(0)}
                      className="flex h-14 w-14 items-center justify-center border-3 border-foreground transition-all"
                    >
                      <Star
                        className={`h-8 w-8 ${
                          star <= (hoverRating || rating)
                            ? "fill-primary text-primary"
                            : "text-muted-foreground"
                        }`}
                      />
                    </button>
                  ))}
                </div>
                {rating > 0 && (
                  <p className="text-sm font-bold text-primary">
                    {rating === 5 && "⭐ Excellent!"}
                    {rating === 4 && "⭐ Very Good"}
                    {rating === 3 && "⭐ Good"}
                    {rating === 2 && "⭐ Fair"}
                    {rating === 1 && "⭐ Poor"}
                  </p>
                )}
              </div>

              {/* Rating Criteria */}
              <div className="mb-6 border-3 border-foreground bg-card p-4">
                <p className="text-sm font-bold mb-3">What to consider:</p>
                <ul className="text-xs space-y-2 text-muted-foreground">
                  <li>• Accuracy of apartment information and photos</li>
                  <li>• Responsiveness to questions</li>
                  <li>• Honesty about building amenities and issues</li>
                  <li>• Helpfulness during the rental process</li>
                  <li>• Overall trustworthiness</li>
                </ul>
              </div>

              {/* Written Review */}
              <div className="mb-6">
                <label
                  htmlFor="whistleblower-review"
                  className="text-sm font-bold mb-2 block"
                >
                  Write a Review (Optional)
                </label>
                <textarea
                  id="whistleblower-review"
                  value={review}
                  onChange={(e) => setReview(e.target.value)}
                  placeholder="Share your experience with this whistleblower..."
                  className="w-full border-3 border-foreground px-3 py-3 font-bold bg-background min-h-30"
                  maxLength={500}
                  rows={5}
                />
                <p className="text-xs text-muted-foreground mt-1">
                  {review.length}/500 characters
                </p>
              </div>

              <Button
                onClick={handleSubmitRating}
                disabled={rating === 0}
                className="w-full border-3 border-foreground bg-primary px-6 py-6 font-bold shadow-[4px_4px_0px_0px_rgba(26,26,26,1)] transition-all hover:translate-x-0.5 hover:translate-y-0.5 hover:shadow-[2px_2px_0px_0px_rgba(26,26,26,1)] disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Submit Rating
              </Button>
            </Card>
          )}

          {/* Step 3: Confirmation */}
          {step === "confirmation" && currentWhistleblower && (
            <Card className="border-3 border-foreground p-6 shadow-[4px_4px_0px_0px_rgba(26,26,26,1)]">
              <div className="text-center">
                <div className="flex justify-center mb-4">
                  <div className="flex h-16 w-16 items-center justify-center border-3 border-foreground bg-secondary">
                    <CheckCircle className="h-10 w-10" />
                  </div>
                </div>
                <h2 className="text-3xl font-black mb-2">Rating Submitted!</h2>
                <p className="text-muted-foreground mb-6">
                  Thank you for rating {currentWhistleblower.name}. Your
                  feedback helps the community.
                </p>

                <div className="border-3 border-foreground bg-muted p-4 mb-6 text-left">
                  <div className="flex items-center justify-between mb-3">
                    <p className="font-bold">{currentWhistleblower.name}</p>
                    <p className="font-black text-lg">{rating}⭐</p>
                  </div>
                  {review && (
                    <div className="border-t-2 border-foreground pt-3">
                      <p className="text-xs font-bold text-muted-foreground mb-1">
                        Your review:
                      </p>
                      <p className="text-sm">{review}</p>
                    </div>
                  )}
                </div>

                <div className="bg-green-100 border-3 border-green-600 p-4 mb-6 rounded-sm">
                  <p className="text-sm font-bold text-green-900 mb-2">
                    Impact of Your Rating:
                  </p>
                  <ul className="text-xs text-green-800 space-y-1">
                    <li>• Helps other tenants decide who to trust</li>
                    <li>
                      • Encourages whistleblowers to maintain high standards
                    </li>
                    <li>• Identifies and flags problematic whistleblowers</li>
                  </ul>
                </div>

                <div className="flex flex-col gap-3 md:flex-row">
                  <Link href="/dashboard/tenant" className="flex-1">
                    <Button className="w-full border-3 border-foreground bg-primary px-6 py-6 font-bold shadow-[4px_4px_0px_0px_rgba(26,26,26,1)]">
                      Back to Dashboard
                    </Button>
                  </Link>
                  <Link
                    href="/dashboard/tenant/rate-whistleblower"
                    className="flex-1"
                  >
                    <Button
                      variant="outline"
                      className="w-full border-3 border-foreground bg-transparent px-6 py-6 font-bold"
                    >
                      Rate Another
                    </Button>
                  </Link>
                </div>
              </div>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
