import { AlertCircle, RefreshCw, Mail } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";

export type ErrorType =
  | "quote_expired"
  | "deposit_failed"
  | "conversion_failed"
  | "staking_failed"
  | "network_error";

export interface ErrorInfo {
  type: ErrorType;
  message: string;
  transactionId?: string;
  canRetry: boolean;
}

export interface ErrorDisplayProps {
  error: ErrorInfo;
  onRetry?: () => void;
  onContactSupport?: () => void;
}

// Map error types to user-friendly messages
function getErrorMessage(type: ErrorType, transactionId?: string): string {
  switch (type) {
    case "quote_expired":
      return "This quote has expired. Please request a new one.";
    
    case "deposit_failed":
      return "We couldn't confirm your deposit. Please try again or contact support.";
    
    case "conversion_failed":
      return transactionId
        ? `Currency conversion failed. Please contact support with your transaction reference: ${transactionId}`
        : "Currency conversion failed. Please contact support with your transaction reference.";
    
    case "staking_failed":
      return "Staking failed. Your USDC is safe. Please contact support to complete staking.";
    
    case "network_error":
      return "Connection error. Please check your internet and try again.";
    
    default:
      return "An unexpected error occurred. Please try again or contact support.";
  }
}

export function ErrorDisplay({
  error,
  onRetry,
  onContactSupport,
}: Readonly<ErrorDisplayProps>) {
  const displayMessage = error.message || getErrorMessage(error.type, error.transactionId);
  const showRetryButton = error.canRetry && onRetry;
  const showSupportButton = onContactSupport;

  return (
    <Card className="border-red-200 bg-red-50/50">
      <CardContent className="space-y-4 py-6">
        <div className="flex items-start gap-3">
          <AlertCircle className="h-6 w-6 text-red-600 shrink-0 mt-0.5" aria-hidden="true" />
          <div className="flex-1 space-y-2">
            <p className="font-semibold text-red-900" role="alert" aria-live="assertive">
              Error
            </p>
            <p className="text-sm text-red-800">
              {displayMessage}
            </p>
          </div>
        </div>

        {/* Transaction Reference Display */}
        {error.transactionId && (
          <Alert className="bg-white border-red-200">
            <AlertDescription className="text-xs">
              <span className="font-medium">Transaction Reference:</span>{" "}
              <code className="rounded bg-red-100 px-2 py-0.5 font-mono text-red-900">
                {error.transactionId}
              </code>
            </AlertDescription>
          </Alert>
        )}

        {/* Action Buttons */}
        {(showRetryButton || showSupportButton) && (
          <div className="flex flex-col sm:flex-row gap-2">
            {showRetryButton && (
              <Button
                onClick={onRetry}
                variant="default"
                className="flex-1"
                aria-label="Retry operation"
              >
                <RefreshCw className="mr-2 h-4 w-4" />
                Retry
              </Button>
            )}
            
            {showSupportButton && (
              <Button
                onClick={onContactSupport}
                variant="outline"
                className="flex-1"
                aria-label="Contact support"
              >
                <Mail className="mr-2 h-4 w-4" />
                Contact Support
              </Button>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
