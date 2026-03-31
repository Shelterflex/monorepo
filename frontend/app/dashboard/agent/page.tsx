"use client";

import Link from "next/link";
import { AlertCircle, Home, Users } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { DashboardHeader } from "@/components/dashboard-header";

export default function AgentDashboardDeprecated() {
  return (
    <div className="min-h-screen bg-background">
      <DashboardHeader />

      <main className="ml-64 min-h-screen pt-20">
        <div className="container mx-auto px-4 py-8">
          <Card className="border-3 border-foreground p-8 shadow-[4px_4px_0px_0px_rgba(26,26,26,1)] max-w-2xl mx-auto">
            <div className="flex flex-col items-center text-center space-y-6">
              <div className="flex h-16 w-16 items-center justify-center border-3 border-foreground bg-destructive/10 rounded-full">
                <AlertCircle className="h-8 w-8 text-destructive" />
              </div>
              
              <div>
                <h1 className="text-3xl font-bold mb-2">Agent Role Deprecated</h1>
                <p className="text-muted-foreground text-lg">
                  The agent role has been removed from Shelterflex.
                </p>
              </div>

              <div className="w-full border-t-2 border-foreground pt-6 space-y-4">
                <p className="text-sm text-muted-foreground">
                  We have transitioned to a whistleblower model where current tenants in buildings help with property discovery and verification.
                </p>
                
                <div className="bg-muted/50 border-2 border-foreground p-4 space-y-2">
                  <p className="font-bold">What changed?</p>
                  <ul className="text-sm text-left space-y-1 list-disc list-inside text-muted-foreground">
                    <li>Property verification is now done by resident whistleblowers</li>
                    <li>Tenants can message residents (whistleblowers) for property questions</li>
                    <li>Landlords manage properties directly without agents</li>
                  </ul>
                </div>
              </div>

              <div className="flex gap-4 pt-4">
                <Link href="/">
                  <Button className="border-3 border-foreground bg-primary font-bold shadow-[4px_4px_0px_0px_rgba(26,26,26,1)]">
                    <Home className="mr-2 h-4 w-4" />
                    Go to Homepage
                  </Button>
                </Link>
                <Link href="/whistleblower/signup">
                  <Button variant="outline" className="border-3 border-foreground font-bold shadow-[4px_4px_0px_0px_rgba(26,26,26,1)]">
                    <Users className="mr-2 h-4 w-4" />
                    Become a Whistleblower
                  </Button>
                </Link>
              </div>
            </div>
          </Card>
        </div>
      </main>
    </div>
  );
}
