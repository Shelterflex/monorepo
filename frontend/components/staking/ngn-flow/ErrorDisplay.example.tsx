import { ErrorDisplay, ErrorInfo } from "./ErrorDisplay";

export default function ErrorDisplayExamples() {
  const handleRetry = () => {
    console.log("Retry clicked");
  };

  const handleContactSupport = () => {
    console.log("Contact support clicked");
  };

  // Example 1: Quote Expired Error
  const quoteExpiredError: ErrorInfo = {
    type: "quote_expired",
    message: "This quote has expired. Please request a new one.",
    canRetry: true,
  };

  // Example 2: Deposit Failed Error with Transaction ID
  const depositFailedError: ErrorInfo = {
    type: "deposit_failed",
    message: "We couldn't confirm your deposit. Please try again or contact support.",
    transactionId: "TXN-123456789",
    canRetry: true,
  };

  // Example 3: Conversion Failed Error
  const conversionFailedError: ErrorInfo = {
    type: "conversion_failed",
    message: "Currency conversion failed. Please contact support with your transaction reference.",
    transactionId: "TXN-987654321",
    canRetry: false,
  };

  // Example 4: Staking Failed Error
  const stakingFailedError: ErrorInfo = {
    type: "staking_failed",
    message: "Staking failed. Your USDC is safe. Please contact support to complete staking.",
    transactionId: "TXN-555666777",
    canRetry: false,
  };

  // Example 5: Network Error
  const networkError: ErrorInfo = {
    type: "network_error",
    message: "Connection error. Please check your internet and try again.",
    canRetry: true,
  };

  return (
    <div className="space-y-6 p-6 max-w-2xl mx-auto">
      <h1 className="text-2xl font-bold mb-6">ErrorDisplay Component Examples</h1>

      <div className="space-y-4">
        <h2 className="text-lg font-semibold">1. Quote Expired (Retryable)</h2>
        <ErrorDisplay
          error={quoteExpiredError}
          onRetry={handleRetry}
        />
      </div>

      <div className="space-y-4">
        <h2 className="text-lg font-semibold">2. Deposit Failed (Retryable with Transaction ID)</h2>
        <ErrorDisplay
          error={depositFailedError}
          onRetry={handleRetry}
          onContactSupport={handleContactSupport}
        />
      </div>

      <div className="space-y-4">
        <h2 className="text-lg font-semibold">3. Conversion Failed (Non-retryable)</h2>
        <ErrorDisplay
          error={conversionFailedError}
          onContactSupport={handleContactSupport}
        />
      </div>

      <div className="space-y-4">
        <h2 className="text-lg font-semibold">4. Staking Failed (Non-retryable)</h2>
        <ErrorDisplay
          error={stakingFailedError}
          onContactSupport={handleContactSupport}
        />
      </div>

      <div className="space-y-4">
        <h2 className="text-lg font-semibold">5. Network Error (Retryable)</h2>
        <ErrorDisplay
          error={networkError}
          onRetry={handleRetry}
          onContactSupport={handleContactSupport}
        />
      </div>
    </div>
  );
}
