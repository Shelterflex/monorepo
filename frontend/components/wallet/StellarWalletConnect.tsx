"use client";

import React, { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Wallet, Loader2, AlertCircle, CheckCircle } from "lucide-react";
import { stellarWallet } from "@/lib/stellar-wallet";
import { requestWalletChallenge, verifyWalletSignature } from "@/lib/authApi";
import { useRouter } from "next/navigation";

interface StellarWalletConnectProps {
  onSuccess?: () => void;
}

export function StellarWalletConnect({ onSuccess }: StellarWalletConnectProps) {
  const router = useRouter();
  const [isConnecting, setIsConnecting] = useState(false);
  const [isSigning, setIsSigning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [publicKey, setPublicKey] = useState<string | null>(null);

  const handleConnect = async () => {
    setError(null);
    setIsConnecting(true);

    try {
      // Connect to Stellar wallet
      const walletInfo = await stellarWallet.connect();
      setPublicKey(walletInfo.publicKey);
      
      // Request challenge from backend
      const challenge = await requestWalletChallenge(walletInfo.publicKey);
      
      // Sign the challenge transaction
      setIsSigning(true);
      const signedChallengeXdr = await stellarWallet.signTransaction(challenge.challengeXdr);
      
      // Verify signature with backend
      await verifyWalletSignature(walletInfo.publicKey, signedChallengeXdr);
      
      // Success!
      onSuccess?.();
      router.push('/dashboard');
      
    } catch (err) {
      setError(err instanceof Error ? err.message : "Stellar wallet connection failed");
      setPublicKey(null);
    } finally {
      setIsConnecting(false);
      setIsSigning(false);
    }
  };

  return (
    <Card className="w-full">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Wallet className="h-5 w-5" />
          Connect Stellar Wallet
        </CardTitle>
        <CardDescription>
          Connect your Stellar wallet to sign in securely
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {error && (
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
        
        {publicKey && !error && (
          <Alert>
            <CheckCircle className="h-4 w-4" />
            <AlertDescription>
              Connected: {publicKey.slice(0, 6)}...{publicKey.slice(-4)}
            </AlertDescription>
          </Alert>
        )}

        <Button
          onClick={handleConnect}
          disabled={isConnecting || isSigning}
          className="w-full"
        >
          {(isConnecting || isSigning) ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              {isSigning ? "Signing transaction..." : "Connecting wallet..."}
            </>
          ) : (
            <>
              <Wallet className="mr-2 h-4 w-4" />
              Connect Stellar Wallet
            </>
          )}
        </Button>

        <div className="text-xs text-muted-foreground">
          <p>This will request access to your Stellar wallet and ask you to sign a transaction to verify your identity.</p>
          <p className="mt-1">Make sure you have Freighter wallet installed.</p>
        </div>
      </CardContent>
    </Card>
  );
}
