"use client"

import { useWallet } from "@/contexts/WalletContext"
import { Button } from "@/components/ui/button"
import { Wallet, Loader2, LogOut, ExternalLink, Lock, AlertTriangle } from "lucide-react"

const BUTTON_CLASS =
  "border-3 border-foreground font-bold shadow-[4px_4px_0px_0px_rgba(26,26,26,1)] hover:shadow-[2px_2px_0px_0px_rgba(26,26,26,1)] hover:translate-x-0.5 hover:translate-y-0.5 transition-all min-h-[44px]"

export function ConnectWalletButton() {
  const {
    publicKey,
    connected,
    connecting,
    freighterInstalled,
    networkMismatch,
    walletLocked,
    connect,
    disconnect,
  } = useWallet()

  if (!freighterInstalled) {
    return (
      <a
        href="https://chrome.google.com/webstore/detail/freighter/eoppcpbndeheinkjjdkhlnjepjcfhgfc"
        target="_blank"
        rel="noopener noreferrer"
      >
        <Button
          variant="outline"
          size="sm"
          className="border-3 border-foreground font-bold shadow-[4px_4px_0px_0px_rgba(26,26,26,1)] hover:shadow-[2px_2px_0px_0px_rgba(26,26,26,1)] hover:translate-x-0.5 hover:translate-y-0.5 transition-all min-h-[44px]"
        >
          <ExternalLink className="mr-2 h-4 w-4" />
          Install Freighter
        </Button>
      </a>
    )
  }

  if (walletLocked) {
    return (
      <Button
        variant="outline"
        size="sm"
        onClick={connect}
        className={BUTTON_CLASS}
        title="Freighter is installed but locked. Open the extension and enter your password."
      >
        <Lock className="mr-2 h-4 w-4" />
        Unlock Freighter
      </Button>
    )
  }

  if (connected && publicKey && networkMismatch) {
    return (
      <Button
        variant="outline"
        size="sm"
        onClick={disconnect}
        className={`${BUTTON_CLASS} text-destructive`}
        title="Freighter is on a different network. Switch it to Testnet to continue."
      >
        <AlertTriangle className="mr-2 h-4 w-4" />
        Wrong Network — switch to Testnet
      </Button>
    )
  }

  if (connected && publicKey) {
    const truncated = `${publicKey.slice(0, 4)}...${publicKey.slice(-4)}`
    return (
      <div className="flex items-center gap-2">
        <span className="text-xs font-mono font-bold bg-muted border-2 border-foreground px-2 py-1">
          {truncated}
        </span>
        <Button
          variant="outline"
          size="sm"
          onClick={disconnect}
          aria-label="Disconnect wallet"
          className="border-3 border-foreground font-bold shadow-[4px_4px_0px_0px_rgba(26,26,26,1)] hover:shadow-[2px_2px_0px_0px_rgba(26,26,26,1)] hover:translate-x-0.5 hover:translate-y-0.5 transition-all min-h-[44px]"
        >
          <LogOut className="h-4 w-4" />
        </Button>
      </div>
    )
  }

  return (
    <Button
      variant="outline"
      size="sm"
      onClick={connect}
      disabled={connecting}
      className="border-3 border-foreground font-bold shadow-[4px_4px_0px_0px_rgba(26,26,26,1)] hover:shadow-[2px_2px_0px_0px_rgba(26,26,26,1)] hover:translate-x-0.5 hover:translate-y-0.5 transition-all min-h-[44px]"
    >
      {connecting ? (
        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
      ) : (
        <Wallet className="mr-2 h-4 w-4" />
      )}
      Connect Wallet
    </Button>
  )
}
