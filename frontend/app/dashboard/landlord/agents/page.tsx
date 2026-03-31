"use client";

import Link from "next/link";
import { AlertCircle, Home, Building2, MessageSquare, Settings } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { DashboardHeader } from "@/components/dashboard-header";

export default function LandlordAgentsPageDeprecated() {
  return (
    <div className="min-h-screen bg-background">
      <DashboardHeader />

      <aside className="fixed left-0 top-0 z-40 h-screen w-64 border-r-3 border-foreground bg-card pt-20">
        <div className="flex h-full flex-col px-4 py-6">
          <div className="mb-8 border-3 border-foreground bg-accent p-4 shadow-[4px_4px_0px_0px_rgba(26,26,26,1)]">
            <p className="text-sm font-medium text-foreground">Logged in as</p>
            <p className="text-lg font-bold text-foreground">Chief Okonkwo</p>
            <p className="text-sm text-muted-foreground">Landlord</p>
          </div>

          <nav className="flex-1 space-y-2">
            <Link
              href="/dashboard/landlord"
              className="flex items-center gap-3 border-3 border-foreground bg-card p-3 font-bold transition-all hover:bg-muted hover:shadow-[4px_4px_0px_0px_rgba(26,26,26,1)]"
            >
              <Home className="h-5 w-5" />
              Dashboard
            </Link>
            <Link
              href="/dashboard/landlord/properties"
              className="flex items-center gap-3 border-3 border-foreground bg-card p-3 font-bold transition-all hover:bg-muted hover:shadow-[4px_4px_0px_0px_rgba(26,26,26,1)]"
            >
              <Building2 className="h-5 w-5" />
              My Properties
            </Link>
            <Link
              href="/messages"
              className="flex items-center gap-3 border-3 border-foreground bg-card p-3 font-bold transition-all hover:bg-muted hover:shadow-[4px_4px_0px_0px_rgba(26,26,26,1)]"
            >
              <MessageSquare className="h-5 w-5" />
              Messages
            </Link>
            <Link
              href="/dashboard/landlord/settings"
              className="flex items-center gap-3 border-3 border-foreground bg-card p-3 font-bold transition-all hover:bg-muted hover:shadow-[4px_4px_0px_0px_rgba(26,26,26,1)]"
            >
              <Settings className="h-5 w-5" />
              Settings
            </Link>
          </nav>
        </div>
      </aside>

      <main className="ml-64 min-h-screen pt-20">
        <div className="container mx-auto px-4 py-8">
          <Card className="border-3 border-foreground p-8 shadow-[4px_4px_0px_0px_rgba(26,26,26,1)] max-w-2xl mx-auto">
            <div className="flex flex-col items-center text-center space-y-6">
              <div className="flex h-16 w-16 items-center justify-center border-3 border-foreground bg-destructive/10 rounded-full">
                <AlertCircle className="h-8 w-8 text-destructive" />
              </div>
              
              <div>
                <h1 className="text-3xl font-bold mb-2">Agent Management Deprecated</h1>
                <p className="text-muted-foreground text-lg">
                  Agent management has been removed from Shelterflex.
                </p>
              </div>

              <div className="w-full border-t-2 border-foreground pt-6 space-y-4">
                <p className="text-sm text-muted-foreground">
                  We have transitioned to a whistleblower model where current tenants in buildings help with property discovery and verification. Landlords now manage properties directly.
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
                <Link href="/dashboard/landlord">
                  <Button className="border-3 border-foreground bg-primary font-bold shadow-[4px_4px_0px_0px_rgba(26,26,26,1)]">
                    <Home className="mr-2 h-4 w-4" />
                    Back to Dashboard
                  </Button>
                </Link>
                <Link href="/dashboard/landlord/properties">
                  <Button variant="outline" className="border-3 border-foreground font-bold shadow-[4px_4px_0px_0px_rgba(26,26,26,1)]">
                    <Building2 className="mr-2 h-4 w-4" />
                    Manage Properties
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
