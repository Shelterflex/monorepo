"use client";

import { Label } from "@/components/ui/label";
import { Wallet, CheckCircle, ExternalLink, ShieldCheck, Loader2 } from "lucide-react";
import { TenantOnboardingData } from "@/lib/tenantApi";
import { Button } from "@/components/ui/button";
import { useState } from "react";
import { Input } from "@/components/ui/input";

interface WalletStepProps {
  data: TenantOnboardingData["wallet"];
  updateData: (data: Partial<TenantOnboardingData["wallet"]>) => void;
  errors: Record<string, string>;
}

export function WalletStep({ data, updateData, errors }: WalletStepProps) {
  const [isConnecting, setIsConnecting] = useState(false);

  const connectWallet = () => {
    setIsConnecting(true);
    // Simulate wallet connection
    setTimeout(() => {
      updateData({ address: "GABC123...XYZ789", connected: true });
      setIsConnecting(false);
    }, 1500);
  };

  const disconnectWallet = () => {
    updateData({ address: "", connected: false });
  };

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-right-4 duration-500">
      <div className="space-y-2">
        <h2 className="text-2xl font-bold text-foreground">Link Your Wallet</h2>
        <p className="text-muted-foreground">Connect your Stellar wallet to handle rent payments and security deposits securely.</p>
      </div>

      <div className="border-3 border-foreground bg-accent/10 p-8 flex flex-col items-center text-center space-y-6 shadow-[6px_6px_0px_0px_rgba(0,0,0,1)]">
        <div className="bg-background p-4 border-3 border-foreground rounded-full">
          <Wallet className="h-12 w-12" />
        </div>
        
        {!data.connected ? (
          <>
            <div className="space-y-2">
              <h3 className="text-xl font-bold">No Wallet Connected</h3>
              <p className="text-sm text-muted-foreground max-w-md">
                We support Freighter, Albedo, and Rabe wallets. If you don&apos;t have one, you can skip this for now, but you&apos;ll need it to sign your lease.
              </p>
            </div>
            <Button 
              onClick={connectWallet}
              disabled={isConnecting}
              className="border-3 border-foreground bg-primary px-8 py-6 text-lg font-bold shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] hover:translate-x-0.5 hover:translate-y-0.5 hover:shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] transition-all"
            >
              {isConnecting ? <Loader2 className="mr-2 h-5 w-5 animate-spin" /> : <ExternalLink className="mr-2 h-5 w-5" />}
              {isConnecting ? "Connecting..." : "Connect Wallet"}
            </Button>
          </>
        ) : (
          <div className="w-full space-y-4">
            <div className="bg-green-500/10 border-3 border-green-600 p-4 flex items-center justify-center gap-3">
              <CheckCircle className="h-6 w-6 text-green-600" />
              <p className="font-bold text-green-600">Wallet Connected Successfully</p>
            </div>
            
            <div className="space-y-2 text-left">
              <Label className="font-bold">Wallet Address</Label>
              <div className="flex gap-2">
                <Input 
                  readOnly 
                  value={data.address} 
                  className="border-3 border-foreground bg-muted font-mono py-6"
                />
                <Button 
                  variant="outline" 
                  onClick={disconnectWallet}
                  className="border-3 border-foreground bg-background font-bold"
                >
                  Disconnect
                </Button>
              </div>
            </div>
          </div>
        )}
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <div className="p-4 border-3 border-foreground bg-background flex gap-3 shadow-[4px_4px_0px_0px_rgba(0,0,0,1)]">
          <ShieldCheck className="h-6 w-6 text-primary shrink-0" />
          <div className="space-y-1">
            <p className="font-bold text-sm">Non-Custodial</p>
            <p className="text-xs text-muted-foreground">You maintain full control of your private keys and funds at all times.</p>
          </div>
        </div>
        <div className="p-4 border-3 border-foreground bg-background flex gap-3 shadow-[4px_4px_0px_0px_rgba(0,0,0,1)]">
          <ShieldCheck className="h-6 w-6 text-primary shrink-0" />
          <div className="space-y-1">
            <p className="font-bold text-sm">Secure Signing</p>
            <p className="text-xs text-muted-foreground">Your wallet is used to cryptographically sign lease agreements and payments.</p>
          </div>
        </div>
      </div>
      
      {errors.address && <p className="text-sm font-bold text-destructive text-center">{errors.address}</p>}
    </div>
  );
}
