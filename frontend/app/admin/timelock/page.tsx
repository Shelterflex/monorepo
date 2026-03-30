"use client";

import { Clock, ShieldAlert, History, Play, XCircle, RefreshCw, Loader2, Info } from "lucide-react";
import { useTimelock, useCountdown } from "@/hooks/useTimelock";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

function TransactionCard({ tx, onExecute, onCancel }: { tx: any, onExecute: any, onCancel: any }) {
  const { timeLeft, formatTime } = useCountdown(tx.eta);
  const isReady = timeLeft <= 0;

  return (
    <Card className="border-3 border-foreground p-5 shadow-[4px_4px_0px_0px_rgba(26,26,26,1)] bg-card overflow-hidden">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="space-y-2 flex-1">
          <div className="flex items-center gap-2">
            <Badge className="bg-primary text-primary-foreground border-2 border-foreground font-bold px-2 py-0.5">
              {tx.target}
            </Badge>
            <span className="font-mono text-sm font-bold bg-muted px-2 py-0.5 border-2 border-foreground">
              {tx.functionName}
            </span>
          </div>
          
          <div className="space-y-1">
            <p className="text-xs text-muted-foreground font-medium uppercase tracking-wider">Arguments</p>
            <div className="bg-muted/50 p-2 border-2 border-foreground rounded-sm">
              <code className="text-xs break-all">
                {JSON.stringify(tx.args)}
              </code>
            </div>
          </div>

          <div className="flex items-center gap-4 pt-2">
            <div className="flex items-center gap-1.5 text-xs font-bold">
              <Clock className="w-4 h-4" />
              <span>ETA: {new Date(tx.eta * 1000).toLocaleString()}</span>
            </div>
            <div className="flex items-center gap-1.5 text-xs font-bold">
              <History className="w-4 h-4" />
              <span>Queued: {new Date(tx.createdAt).toLocaleString()}</span>
            </div>
          </div>
        </div>

        <div className="flex flex-col items-end gap-3 min-w-[180px]">
          <div className={`w-full text-center py-2 border-3 border-foreground font-black text-sm shadow-[2px_2px_0px_0px_rgba(26,26,26,1)] ${
            isReady ? 'bg-secondary text-secondary-foreground' : 'bg-accent text-accent-foreground'
          }`}>
            {formatTime()}
          </div>
          
          <div className="flex gap-2 w-full">
            <Button
              className="flex-1 font-bold border-2 border-foreground shadow-[2px_2px_0px_0px_rgba(26,26,26,1)] hover:translate-x-0.5 hover:translate-y-0.5 hover:shadow-none transition-all"
              variant="destructive"
              size="sm"
              onClick={() => onCancel(tx.txHash)}
            >
              <XCircle className="w-4 h-4 mr-1" />
              Cancel
            </Button>
            <Button
              className="flex-1 font-bold border-2 border-foreground shadow-[2px_2px_0px_0px_rgba(26,26,26,1)] hover:translate-x-0.5 hover:translate-y-0.5 hover:shadow-none transition-all"
              variant="default"
              size="sm"
              disabled={!isReady}
              onClick={() => onExecute(tx.txHash)}
            >
              <Play className="w-4 h-4 mr-1" />
              Execute
            </Button>
          </div>
        </div>
      </div>
    </Card>
  );
}

export default function TimelockAdminPage() {
  const { queuedTransactions, isLoading, fetchTransactions, handleExecute, handleCancel } = useTimelock();

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b-4 border-foreground bg-card p-6 md:p-10">
        <div className="container mx-auto flex flex-col md:flex-row md:items-center justify-between gap-6">
          <div className="space-y-2">
            <div className="flex items-center gap-3">
              <ShieldAlert className="w-8 h-8 md:w-10 md:h-10 text-primary" />
              <h1 className="text-3xl md:text-5xl font-black tracking-tighter uppercase italic">
                Governance <span className="text-primary">Timelock</span>
              </h1>
            </div>
            <p className="text-lg font-bold text-muted-foreground max-w-2xl">
              Secure administrative operations requiring a time delay and community oversight. 
              All operations are queued and can be monitored or cancelled before execution.
            </p>
          </div>
          
          <Button 
            onClick={fetchTransactions}
            className="w-full md:w-auto h-16 px-8 text-xl font-black border-4 border-foreground shadow-[8px_8px_0px_0px_rgba(26,26,26,1)] hover:translate-x-1 hover:translate-y-1 hover:shadow-[4px_4px_0px_0px_rgba(26,26,26,1)] transition-all bg-secondary text-secondary-foreground"
          >
            {isLoading ? <Loader2 className="animate-spin w-6 h-6 mr-2" /> : <RefreshCw className="w-6 h-6 mr-2" />}
            REFRESH
          </Button>
        </div>
      </header>

      <main className="container mx-auto px-4 py-12 md:py-20">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-12">
          <div className="lg:col-span-2 space-y-8">
            <div className="flex items-center justify-between">
              <h2 className="text-2xl font-black uppercase flex items-center gap-3">
                <History className="w-6 h-6" />
                Pending Operations
                <span className="bg-foreground text-background px-3 py-1 text-sm rounded-full">
                  {queuedTransactions.length}
                </span>
              </h2>
            </div>

            {isLoading && queuedTransactions.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-20 border-3 border-dashed border-foreground rounded-lg bg-muted/20">
                <Loader2 className="w-12 h-12 animate-spin text-muted-foreground mb-4" />
                <p className="font-bold text-muted-foreground">Fetching governance state...</p>
              </div>
            ) : queuedTransactions.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-20 border-4 border-foreground bg-card shadow-[8px_8px_0px_0px_rgba(26,26,26,1)] text-center px-6">
                <div className="bg-secondary p-6 rounded-full border-4 border-foreground mb-6">
                  <ShieldAlert className="w-16 h-16" />
                </div>
                <h3 className="text-2xl font-black uppercase mb-2">Queue is Empty</h3>
                <p className="font-bold text-muted-foreground max-w-sm">
                  No administrative operations are currently waiting for execution. 
                  The governance system is in a steady state.
                </p>
              </div>
            ) : (
              <div className="space-y-6">
                {queuedTransactions.map((tx) => (
                  <TransactionCard 
                    key={tx.txHash} 
                    tx={tx} 
                    onExecute={handleExecute}
                    onCancel={handleCancel}
                  />
                ))}
              </div>
            )}
          </div>

          <div className="space-y-8">
            <Card className="border-4 border-foreground p-8 bg-primary shadow-[8px_8px_0px_0px_rgba(26,26,26,1)] text-primary-foreground">
              <h3 className="text-2xl font-black uppercase mb-4 flex items-center gap-2">
                <Info className="w-6 h-6" />
                Governance Protocol
              </h3>
              <ul className="space-y-4 font-bold">
                <li className="flex gap-3">
                  <span className="bg-foreground text-background w-6 h-6 rounded-full flex items-center justify-center flex-shrink-0">1</span>
                  <span>Admins propose operations that are queued with a minimum delay (e.g., 24h).</span>
                </li>
                <li className="flex gap-3">
                  <span className="bg-foreground text-background w-6 h-6 rounded-full flex items-center justify-center flex-shrink-0">2</span>
                  <span>The community monitors pending operations on this dashboard.</span>
                </li>
                <li className="flex gap-3">
                  <span className="bg-foreground text-background w-6 h-6 rounded-full flex items-center justify-center flex-shrink-0">3</span>
                  <span>Once the ETA passes, anyone can trigger the execution.</span>
                </li>
                <li className="flex gap-3 text-secondary">
                  <span className="bg-secondary text-foreground w-6 h-6 rounded-full flex items-center justify-center flex-shrink-0">!</span>
                  <span>In an emergency, 2-of-N multisig holders can bypass the timelock.</span>
                </li>
              </ul>
            </Card>

            <Card className="border-4 border-foreground p-8 bg-card shadow-[8px_8px_0px_0px_rgba(26,26,26,1)]">
              <h3 className="text-xl font-black uppercase mb-4">Contract Security</h3>
              <div className="space-y-4">
                <div className="p-4 border-2 border-foreground bg-muted font-mono text-xs break-all">
                  <p className="font-bold mb-1 uppercase">Timelock Address:</p>
                  CADM...TIMELOCK
                </div>
                <div className="p-4 border-2 border-foreground bg-muted font-mono text-xs break-all">
                  <p className="font-bold mb-1 uppercase">Min Delay:</p>
                  3,600 Seconds (1 Hour)
                </div>
                <div className="p-4 border-2 border-foreground bg-muted font-mono text-xs break-all">
                  <p className="font-bold mb-1 uppercase">Max Delay:</p>
                  259,200 Seconds (3 Days)
                </div>
              </div>
            </Card>
          </div>
        </div>
      </main>
    </div>
  );
}
