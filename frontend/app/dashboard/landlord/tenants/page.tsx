"use client";

import Link from "next/link";
import {
  Home,
  Building2,
  Users,
  MessageSquare,
  Settings,
  ArrowLeft,
  CheckCircle,
  UserX,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { landlordTenants as tenants } from "@/lib/mockData";

export default function TenantsPage() {
  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat("en-NG", {
      style: "currency",
      currency: "NGN",
      minimumFractionDigits: 0,
    }).format(amount);
  };

  return (
    <div className="flex min-h-screen bg-background">
      {/* Sidebar */}
      <aside className="fixed left-0 top-0 z-40 hidden h-screen w-64 border-r-3 border-foreground bg-card pt-20 lg:block">
        <div className="px-4">
          <nav className="space-y-2">
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
              href="/dashboard/landlord/tenants"
              className="flex items-center gap-3 border-3 border-foreground bg-primary p-3 font-bold shadow-[4px_4px_0px_0px_rgba(26,26,26,1)]"
            >
              <Users className="h-5 w-5" />
              My Tenants
            </Link>
            <Link
              href="/messages"
              className="flex items-center gap-3 border-3 border-foreground bg-card p-3 font-bold transition-all hover:bg-muted hover:shadow-[4px_4px_0px_0px_rgba(26,26,26,1)]"
            >
              <MessageSquare className="h-5 w-5" />
              Messages
              <span className="ml-auto flex h-6 w-6 items-center justify-center border-2 border-foreground bg-destructive text-xs font-bold text-destructive-foreground">
                3
              </span>
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

      {/* Main Content */}
      <main className="min-h-screen w-full pt-20 lg:ml-64">
        <div className="p-4 md:p-6 lg:p-8">
          {/* Back Button */}
          <Link href="/dashboard/landlord" className="mb-6 inline-flex">
            <Button className="border-3 border-foreground bg-card px-4 py-2 font-bold shadow-[3px_3px_0px_0px_rgba(26,26,26,1)] transition-all hover:translate-x-0.5 hover:translate-y-0.5 hover:shadow-[2px_2px_0px_0px_rgba(26,26,26,1)]">
              <ArrowLeft className="mr-2 h-4 w-4" />
              Back
            </Button>
          </Link>

          {/* Header */}
          <div className="mb-8">
            <h1 className="text-3xl font-bold lg:text-4xl">My Tenants</h1>
            <p className="mt-2 text-muted-foreground">
              View and manage all your current tenants
            </p>
          </div>

          {/* Tenants Grid */}
          <div className="grid gap-6">
            {tenants.length === 0 ? (
              <Card className="border-3 border-foreground p-12 text-center shadow-[4px_4px_0px_0px_rgba(26,26,26,1)]">
                <UserX className="mx-auto h-16 w-16 text-muted-foreground" />
                <h3 className="mt-4 text-xl font-bold">No Tenants Yet</h3>
                <p className="mt-2 text-muted-foreground">
                  Tenants will appear here once they are assigned to your properties.
                </p>
                <Link href="/dashboard/landlord/properties" className="mt-6 inline-block">
                  <Button className="border-3 border-foreground bg-primary font-bold shadow-[4px_4px_0px_0px_rgba(26,26,26,1)] transition-all hover:translate-x-0.5 hover:translate-y-0.5 hover:shadow-[2px_2px_0px_0px_rgba(26,26,26,1)]">
                    <Building2 className="mr-2 h-4 w-4" />
                    Manage Properties
                  </Button>
                </Link>
              </Card>
            ) : tenants.map((tenant) => (
              <Card
                key={tenant.id}
                className="border-3 border-foreground p-6 shadow-[4px_4px_0px_0px_rgba(26,26,26,1)]"
              >
                <div className="mb-4 flex items-start justify-between">
                  <div>
                    <div className="flex items-center gap-3">
                      <h3 className="text-xl font-bold">{tenant.name}</h3>
                      {tenant.verified && (
                        <span className="inline-flex items-center gap-1 border-2 border-secondary bg-secondary/20 px-2 py-1 text-xs font-bold text-secondary">
                          <CheckCircle className="h-3 w-3" /> Verified
                        </span>
                      )}
                    </div>
                    <p className="mt-2 text-sm text-muted-foreground">
                      {tenant.property}
                    </p>
                  </div>
                  <span className="border-3 border-primary bg-primary px-3 py-1 font-mono text-xs font-bold text-primary-foreground">
                    {tenant.status.toUpperCase()}
                  </span>
                </div>

                <div className="border-t-2 border-dashed border-foreground pt-4">
                  <div className="mb-4 grid grid-cols-2 gap-4 md:grid-cols-4">
                    <div>
                      <p className="text-xs text-muted-foreground">
                        Lease Start
                      </p>
                      <p className="font-bold">{tenant.leaseStart}</p>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground">Lease End</p>
                      <p className="font-bold">{tenant.leaseEnd}</p>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground">
                        Monthly Payment
                      </p>
                      <p className="font-bold">
                        {formatCurrency(tenant.monthlyPayment)}
                      </p>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground">
                        Total Paid
                      </p>
                      <p className="font-bold">
                        {formatCurrency(tenant.totalPaid)}
                      </p>
                    </div>
                  </div>
                </div>

                <div className="mt-4 flex gap-3">
                  <Link href="/messages" className="flex-1">
                    <Button className="w-full border-3 border-foreground bg-primary font-bold shadow-[3px_3px_0px_0px_rgba(26,26,26,1)] transition-all hover:translate-x-0.5 hover:translate-y-0.5 hover:shadow-[2px_2px_0px_0px_rgba(26,26,26,1)]">
                      <MessageSquare className="mr-2 h-4 w-4" />
                      Message
                    </Button>
                  </Link>
                  <Button className="flex-1 border-3 border-foreground bg-transparent font-bold hover:bg-muted">
                    View Details
                  </Button>
                </div>
              </Card>
            ))}
          </div>
        </div>
      </main>
    </div>
  );
}
