"use client";

import React, { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Wallet, Loader2, AlertCircle, CheckCircle, LogOut } from "lucide-react";
import { walletAuthManager, type WalletAuthSession } from "@/lib/wallet-auth";
import { useRouter } from "next/navigation";

interface WalletAuthFlowProps {
  onSuccess?: (session: WalletAuthSession) => void;
  onError?: (error: Error) => void;
  redirectTo?: string;
}

export function WalletAuthFlow({ 
  onSuccess, 
  onError,
  redirectTo = "/dashboard" 
}: WalletAuthFlowProps) {
  const router = useRouter();
  const [isConnecting, setIsConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [session, setSession] = useState<WalletAuthSession | null>(null);
  const [currentStep, setCurrentStep] = useState<
    "idle" | "connecting" | "signing" | "verifying" | "complete"
  >("idle");

  useEffect(() => {
    const existingSession = walletAuthManager.getSession();
    if (existingSession) {
      setSession(existingSession);
      setCurrentStep("complete");
    }
  }, []);

  const handleConnect = async () => {
    setError(null);
    setIsConnecting(true);
    setCurrentStep("connecting");

    try {
      setCurrentStep("signing");
      const newSession = await walletAuthManager.connectAndAuthenticate();
      
      setCurrentStep("complete");
      setSession(newSession);
      onSuccess?.(newSession);
      
      setTimeout(() => {
        router.push(redirectTo);
      }, 500);
      
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : "Wallet authentication failed";
      setError(errorMessage);
      setCurrentStep("idle");
      onError?.(err instanceof Error ? err : new Error(errorMessage));
    } finally {
      setIsConnecting(false);
    }
  };

  const handleDisconnect = async () => {
    try {
      await walletAuthManager.disconnect();
      setSession(null);
      setCurrentStep("idle");
    } catch (err) {
      console.error("Disconnect failed:", err);
    }
  };

  const getStepMessage = () => {
    switch (currentStep) {
      case "connecting":
        return "Connecting to wallet...";
      case "signing":
        return "Please sign the transaction in your wallet...";
      case "verifying":
        return "Verifying signature...";
      case "complete":
        return "Authentication successful!";
      default:
        return "";
    }
  };

  return (
    <Card className="w-full max-w-md">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Wallet className="h-5 w-5" />
          Stellar Wallet Authentication
        </CardTitle>
        <CardDescription>
          {session 
            ? "Your wallet is connected and authenticated" 
            : "Connect your Stellar wallet to sign in securely"}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {error && (
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
        
        {session && !error && (
          <Alert>
            <CheckCircle className="h-4 w-4" />
            <AlertDescription>
              Connected: {session.publicKey.slice(0, 8)}...{session.publicKey.slice(-6)}
            </AlertDescription>
          </Alert>
        )}

        {isConnecting && (
          <Alert>
            <Loader2 className="h-4 w-4 animate-spin" />
            <AlertDescription>{getStepMessage()}</AlertDescription>
          </Alert>
        )}

        {!session ? (
          <Button
            onClick={handleConnect}
            disabled={isConnecting}
            className="w-full"
            size="lg"
          >
            {isConnecting ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                {getStepMessage()}
              </>
            ) : (
              <>
                <Wallet className="mr-2 h-4 w-4" />
                Connect & Authenticate
              </>
            )}
          </Button>
        ) : (
          <Button
            onClick={handleDisconnect}
            variant="outline"
            className="w-full"
            size="lg"
          >
            <LogOut className="mr-2 h-4 w-4" />
            Disconnect Wallet
          </Button>
        )}

        <div className="text-xs text-muted-foreground space-y-1">
          <p className="font-semibold">Authentication Flow:</p>
          <ol className="list-decimal list-inside space-y-0.5 ml-2">
            <li>Connect to Freighter wallet</li>
            <li>Sign authentication challenge</li>
            <li>Verify signature on backend</li>
            <li>Persist session securely</li>
          </ol>
          <p className="mt-2">
            Make sure you have the Freighter wallet extension installed.
          </p>
        </div>
      </CardContent>
    </Card>
  );
}
