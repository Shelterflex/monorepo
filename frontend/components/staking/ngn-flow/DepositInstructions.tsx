import React from "react";
import { Loader2, Copy, ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";

export interface PaymentInstructions {
  paystackUrl?: string;
  bankDetails?: {
    accountNumber: string;
    accountName: string;
    bankName: string;
    reference: string;
  };
}

export interface DepositInstructionsProps {
  transactionId: string;
  paymentMethod: "paystack" | "bank_transfer";
  instructions: PaymentInstructions;
}

export function DepositInstructions({
  transactionId,
  paymentMethod,
  instructions,
}: DepositInstructionsProps) {
  const [copied, setCopied] = React.useState<string | null>(null);

  const copyToClipboard = (text: string, field: string) => {
    navigator.clipboard.writeText(text);
    setCopied(field);
    setTimeout(() => setCopied(null), 2000);
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>Payment Instructions</CardTitle>
          <CardDescription>
            Complete your payment to proceed with staking
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Transaction Reference */}
          <div className="space-y-2">
            <label className="text-sm font-medium">Transaction Reference</label>
            <div className="flex items-center gap-2">
              <code className="flex-1 rounded bg-muted px-3 py-2 text-sm font-mono">
                {transactionId}
              </code>
              <Button
                variant="outline"
                size="sm"
                onClick={() => copyToClipboard(transactionId, "reference")}
                aria-label="Copy transaction reference"
              >
                <Copy className="h-4 w-4" />
                {copied === "reference" && (
                  <span className="ml-2 text-xs">Copied!</span>
                )}
              </Button>
            </div>
          </div>

          {/* Paystack Payment */}
          {paymentMethod === "paystack" && instructions.paystackUrl && (
            <div className="space-y-3">
              <p className="text-sm text-muted-foreground">
                Click the button below to complete your payment via Paystack
              </p>
              <Button
                className="w-full"
                onClick={() => window.open(instructions.paystackUrl, "_blank")}
                aria-label="Open Paystack payment page"
              >
                <ExternalLink className="mr-2 h-4 w-4" />
                Pay with Paystack
              </Button>
            </div>
          )}

          {/* Bank Transfer Details */}
          {paymentMethod === "bank_transfer" && instructions.bankDetails && (
            <div className="space-y-3">
              <p className="text-sm text-muted-foreground">
                Transfer to the account below using the reference provided
              </p>
              
              <div className="space-y-3 rounded-lg border p-4">
                <div className="space-y-1">
                  <label className="text-xs font-medium text-muted-foreground">
                    Bank Name
                  </label>
                  <div className="flex items-center gap-2">
                    <p className="flex-1 text-sm font-medium">
                      {instructions.bankDetails.bankName}
                    </p>
                  </div>
                </div>

                <div className="space-y-1">
                  <label className="text-xs font-medium text-muted-foreground">
                    Account Name
                  </label>
                  <div className="flex items-center gap-2">
                    <p className="flex-1 text-sm font-medium">
                      {instructions.bankDetails.accountName}
                    </p>
                  </div>
                </div>

                <div className="space-y-1">
                  <label className="text-xs font-medium text-muted-foreground">
                    Account Number
                  </label>
                  <div className="flex items-center gap-2">
                    <code className="flex-1 rounded bg-muted px-2 py-1 text-sm font-mono">
                      {instructions.bankDetails.accountNumber}
                    </code>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() =>
                        copyToClipboard(
                          instructions.bankDetails!.accountNumber,
                          "account"
                        )
                      }
                      aria-label="Copy account number"
                    >
                      <Copy className="h-4 w-4" />
                    </Button>
                  </div>
                </div>

                <div className="space-y-1">
                  <label className="text-xs font-medium text-muted-foreground">
                    Payment Reference
                  </label>
                  <div className="flex items-center gap-2">
                    <code className="flex-1 rounded bg-muted px-2 py-1 text-sm font-mono">
                      {instructions.bankDetails.reference}
                    </code>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() =>
                        copyToClipboard(
                          instructions.bankDetails!.reference,
                          "paymentRef"
                        )
                      }
                      aria-label="Copy payment reference"
                    >
                      <Copy className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              </div>

              <Alert>
                <AlertDescription className="text-xs">
                  <strong>Important:</strong> You must use the payment reference
                  above when making your transfer. This helps us identify your
                  payment.
                </AlertDescription>
              </Alert>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Waiting for Payment Status */}
      <Card>
        <CardContent className="flex items-center gap-3 py-4">
          <Loader2 className="h-5 w-5 animate-spin text-primary" />
          <div>
            <p className="font-medium">Waiting for payment</p>
            <p className="text-sm text-muted-foreground">
              We'll automatically detect your payment and proceed with the conversion
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
