/**
 * QuoteDisplay component
 * Displays quote information and handles user confirmation
 */

import React from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import type { Quote } from '@/lib/ngnStakingApi';

export interface QuoteDisplayProps {
  quote: Quote;
  onConfirm: (quote: Quote) => void;
  onCancel: () => void;
  isLoading?: boolean;
}

export function QuoteDisplay({
  quote,
  onConfirm,
  onCancel,
  isLoading = false,
}: QuoteDisplayProps) {
  const formatAmount = (amount: number, decimals: number = 2) => {
    return amount.toLocaleString('en-US', {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    });
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Quote Details</CardTitle>
        <CardDescription>
          Review your conversion details before proceeding
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Quote Details */}
        <div className="space-y-3 rounded-lg border p-4">
          <div className="flex justify-between">
            <span className="text-sm text-muted-foreground">NGN Amount</span>
            <span className="font-medium">₦{formatAmount(quote.ngnAmount)}</span>
          </div>

          <div className="flex justify-between">
            <span className="text-sm text-muted-foreground">USDC Amount</span>
            <span className="font-medium">{formatAmount(quote.usdcAmount, 6)} USDC</span>
          </div>

          <div className="flex justify-between">
            <span className="text-sm text-muted-foreground">Exchange Rate</span>
            <span className="font-medium">₦{formatAmount(quote.fxRate)}/USDC</span>
          </div>

          <div className="border-t pt-3 space-y-2">
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Conversion Fee</span>
              <span>₦{formatAmount(quote.fees.conversionFee)}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Platform Fee</span>
              <span>₦{formatAmount(quote.fees.platformFee)}</span>
            </div>
            <div className="flex justify-between font-medium">
              <span>Total Fees</span>
              <span>₦{formatAmount(quote.fees.total)}</span>
            </div>
          </div>
        </div>

        {/* Action Buttons */}
        <div className="flex flex-col sm:flex-row gap-2">
          <Button
            onClick={() => onConfirm(quote)}
            disabled={isLoading}
            className="flex-1"
          >
            {isLoading ? 'Processing...' : 'Confirm Quote'}
          </Button>
          <Button
            onClick={onCancel}
            variant="outline"
            disabled={isLoading}
            className="flex-1"
          >
            Cancel
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
