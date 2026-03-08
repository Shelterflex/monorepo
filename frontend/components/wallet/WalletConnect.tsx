"use client";

import React, { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Wallet, Loader2, AlertCircle, CheckCircle } from "lucide-react";
import { wallet } from "@/lib/wallet";
import { requestWalletChallenge, verifyWalletSignature } from "@/lib/authApi";
import { useRouter } from "next/navigation";

interface WalletConnectProps {
  onSuccess?: () => void;
}

export function WalletConnect({ onSuccess }: WalletConnectProps) {
  const router = useRouter();
  const [isConnecting, setIsConnecting] = useState(false);
  const [isSigning, setIsSigning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [walletAddress, setWalletAddress] = useState<string | null>(null);

  const handleConnect = async () => {
    setError(null);
    setIsConnecting(true);

    try {
      const walletInfo = await wallet.connect();
      setWalletAddress(walletInfo.address);
      
      // Request challenge from backend
      const challenge = await requestWalletChallenge(walletInfo.address);
      
      // Sign the challenge message
      setIsSigning(true);
      const signature = await wallet.signMessage(challenge.message);
      
      // Verify signature with backend
      await verifyWalletSignature(walletInfo.address, signature);
      
      // Success!
      onSuccess?.();
      router.push('/dashboard');
      
    } catch (err) {
      setError(err instanceof Error ? err.message : "Wallet connection failed");
      setWalletAddress(null);
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
          Connect Wallet
        </CardTitle>
        <CardDescription>
          Connect your Ethereum wallet to sign in securely
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {error && (
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
        
        {walletAddress && !error && (
          <Alert>
            <CheckCircle className="h-4 w-4" />
            <AlertDescription>
              Connected: {walletAddress.slice(0, 6)}...{walletAddress.slice(-4)}
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
              {isSigning ? "Signing message..." : "Connecting wallet..."}
            </>
          ) : (
            <>
              <Wallet className="mr-2 h-4 w-4" />
              Connect Wallet
            </>
          )}
        </Button>

        <div className="text-xs text-muted-foreground">
          <p>This will request access to your wallet and ask you to sign a message to verify your identity.</p>
          <p className="mt-1">No blockchain transaction will be initiated.</p>
        </div>
      </CardContent>
    </Card>
  );
}
