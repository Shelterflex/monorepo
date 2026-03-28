"use client";

import { useState } from "react";
import Link from "next/link";
import {
  Home,
  Building2,
  CreditCard,
  MessageSquare,
  Settings,
  Heart,
  Calendar,
  Clock,
  CheckCircle,
  AlertCircle,
  ArrowRight,
  MapPin,
  FileText,
  Menu,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { DashboardHeader } from "@/components/dashboard-header";
import {
  tenantCurrentLease as currentLease,
  tenantDashboardPaymentSchedule as paymentSchedule,
  tenantDashboardPastPayments as pastPayments,
  tenantSavedProperties as savedProperties,
} from "@/lib/mockData";
import { featureFlags } from "@/lib/featureFlags";

// Wallet balance - checked first before auto-deduction
type PaymentItem =
  | {
      month: string;
      amount: number;
      status: "upcoming" | "pending";
      dueDate: string;
    }
  | {
      month: string;
      amount: number;
      status: "paid";
      paidDate: string;
    };

export default function TenantDashboard() {
  const [activeTab, setActiveTab] = useState<"overview" | "payments" | "saved">(
    "overview",
  );
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat("en-NG", {
      style: "currency",
      currency: "NGN",
      minimumFractionDigits: 0,
    }).format(amount);
  };

  const getPaymentHistoryPresentation = (payment: PaymentItem) => {
    const isPaid = payment.status === "paid";
    const isUpcoming = payment.status === "upcoming";

    let iconContainerClassName = "bg-muted";
    if (isPaid) {
      iconContainerClassName = "bg-secondary";
    } else if (isUpcoming) {
      iconContainerClassName = "bg-primary";
    }

    let detailText = "";
    if (isPaid) {
      detailText = `Paid on ${payment.paidDate}`;
    } else {
      detailText = `Due ${payment.dueDate}`;
    }

    let statusClassName = "text-muted-foreground";
    if (isPaid) {
      statusClassName = "text-secondary";
    } else if (isUpcoming) {
      statusClassName = "text-primary";
    }

    let statusLabel = "Pending";
    if (isPaid) {
      statusLabel = "Paid";
    } else if (isUpcoming) {
      statusLabel = "Due Soon";
    }

    return {
      detailText,
      iconContainerClassName,
      statusClassName,
      statusLabel,
    };
  };

  return (
    <div className="min-h-screen bg-background">
      <DashboardHeader />

      {/* Mobile Menu Button */}
      <button
        onClick={() => setSidebarOpen(!sidebarOpen)}
        className="fixed bottom-6 right-6 z-50 flex h-14 w-14 items-center justify-center border-3 border-foreground bg-primary shadow-[4px_4px_0px_0px_rgba(26,26,26,1)] lg:hidden"
      >
        {sidebarOpen ? <X className="h-6 w-6" /> : <Menu className="h-6 w-6" />}
      </button>

      {/* Mobile Overlay */}
      {sidebarOpen && (
        <button
          type="button"
          aria-label="Close sidebar"
          className="fixed inset-0 z-40 bg-foreground/50 lg:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Sidebar */}
      <aside
        className={`fixed left-0 top-0 z-40 h-screen w-64 border-r-3 border-foreground bg-card pt-20 transition-transform lg:translate-x-0 ${sidebarOpen ? "translate-x-0" : "-translate-x-full"}`}
      >
        <div className="flex h-full flex-col px-4 py-6">
          <div className="mb-8 border-3 border-foreground bg-secondary p-4 shadow-[4px_4px_0px_0px_rgba(26,26,26,1)]">
            <p className="text-sm font-medium text-foreground">Logged in as</p>
            <p className="text-lg font-bold text-foreground">Ngozi Adekunle</p>
            <p className="text-sm text-muted-foreground">Tenant</p>
          </div>

          <nav className="flex-1 space-y-2">
            <Link
              href="/dashboard/tenant"
              className="flex items-center gap-3 border-3 border-foreground bg-primary p-3 font-bold shadow-[4px_4px_0px_0px_rgba(26,26,26,1)]"
              onClick={() => setSidebarOpen(false)}
            >
              <Home className="h-5 w-5" />
              Dashboard
            </Link>
            <Link
              href="/dashboard/tenant/payments"
              className="flex items-center gap-3 border-3 border-foreground bg-card p-3 font-bold transition-all hover:bg-muted hover:shadow-[4px_4px_0px_0px_rgba(26,26,26,1)]"
              onClick={() => setSidebarOpen(false)}
            >
              <CreditCard className="h-5 w-5" />
              Payments
            </Link>
            <Link
              href="/dashboard/tenant/lease"
              className="flex items-center gap-3 border-3 border-foreground bg-card p-3 font-bold transition-all hover:bg-muted hover:shadow-[4px_4px_0px_0px_rgba(26,26,26,1)]"
              onClick={() => setSidebarOpen(false)}
            >
              <FileText className="h-5 w-5" />
              My Lease
            </Link>
            <Link
              href="/properties"
              className="flex items-center gap-3 border-3 border-foreground bg-card p-3 font-bold transition-all hover:bg-muted hover:shadow-[4px_4px_0px_0px_rgba(26,26,26,1)]"
              onClick={() => setSidebarOpen(false)}
            >
              <Building2 className="h-5 w-5" />
              Browse Properties
            </Link>
            <Link
              href="/dashboard/tenant/rate-whistleblower"
              className="flex items-center gap-3 border-3 border-foreground bg-card p-3 font-bold transition-all hover:bg-muted hover:shadow-[4px_4px_0px_0px_rgba(26,26,26,1)]"
              onClick={() => setSidebarOpen(false)}
            >
              <MessageSquare className="h-5 w-5" />
              Rate Whistleblower
            </Link>
            <Link
              href="/messages"
              className="flex items-center gap-3 border-3 border-foreground bg-card p-3 font-bold transition-all hover:bg-muted hover:shadow-[4px_4px_0px_0px_rgba(26,26,26,1)]"
              onClick={() => setSidebarOpen(false)}
            >
              <MessageSquare className="h-5 w-5" />
              Messages
              <span className="ml-auto flex h-6 w-6 items-center justify-center border-2 border-foreground bg-destructive text-xs font-bold text-destructive-foreground">
                2
              </span>
            </Link>
            <Link
              href="/dashboard/tenant/settings"
              className="flex items-center gap-3 border-3 border-foreground bg-card p-3 font-bold transition-all hover:bg-muted hover:shadow-[4px_4px_0px_0px_rgba(26,26,26,1)]"
              onClick={() => setSidebarOpen(false)}
            >
              <Settings className="h-5 w-5" />
              Settings
            </Link>
          </nav>
        </div>
      </aside>

      {/* Main Content */}
      <main className="min-h-screen pt-20 lg:ml-64">
        <div className="p-4 md:p-6 lg:p-8">
          {/* Header */}
          <div className="mb-6 md:mb-8">
            <h1 className="text-2xl font-bold text-foreground md:text-3xl lg:text-4xl">
              Welcome back, Ngozi!
            </h1>
            <p className="mt-2 text-sm text-muted-foreground md:text-base lg:text-lg">
              Your next payment of {formatCurrency(currentLease.monthlyPayment)}{" "}
              is due on {currentLease.nextPaymentDate}
            </p>
          </div>

          {/* Quick Stats */}
          <div className="mb-6 grid grid-cols-2 gap-3 md:mb-8 md:grid-cols-4 md:gap-4">
            <Card className="border-3 border-foreground p-3 shadow-[4px_4px_0px_0px_rgba(26,26,26,1)] md:p-4">
              <div className="flex items-center gap-2 md:gap-3">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center border-3 border-foreground bg-primary md:h-12 md:w-12">
                  <CreditCard className="h-5 w-5 md:h-6 md:w-6" />
                </div>
                <div className="min-w-0">
                  <p className="truncate text-xs text-muted-foreground md:text-sm">
                    Next Payment
                  </p>
                  <p className="truncate text-base font-bold md:text-xl">
                    {formatCurrency(currentLease.monthlyPayment)}
                  </p>
                </div>
              </div>
            </Card>
            <Card className="border-3 border-foreground p-3 shadow-[4px_4px_0px_0px_rgba(26,26,26,1)] md:p-4">
              <div className="flex items-center gap-2 md:gap-3">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center border-3 border-foreground bg-secondary md:h-12 md:w-12">
                  <CheckCircle className="h-5 w-5 md:h-6 md:w-6" />
                </div>
                <div className="min-w-0">
                  <p className="truncate text-xs text-muted-foreground md:text-sm">
                    Total Paid
                  </p>
                  <p className="truncate text-base font-bold md:text-xl">
                    {formatCurrency(currentLease.totalPaid)}
                  </p>
                </div>
              </div>
            </Card>
            <Card className="border-3 border-foreground p-3 shadow-[4px_4px_0px_0px_rgba(26,26,26,1)] md:p-4">
              <div className="flex items-center gap-2 md:gap-3">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center border-3 border-foreground bg-accent md:h-12 md:w-12">
                  <Clock className="h-5 w-5 md:h-6 md:w-6" />
                </div>
                <div className="min-w-0">
                  <p className="truncate text-xs text-muted-foreground md:text-sm">
                    Remaining
                  </p>
                  <p className="truncate text-base font-bold md:text-xl">
                    {formatCurrency(
                      currentLease.totalOwed - currentLease.totalPaid,
                    )}
                  </p>
                </div>
              </div>
            </Card>
            <Card className="border-3 border-foreground p-3 shadow-[4px_4px_0px_0px_rgba(26,26,26,1)] md:p-4">
              <div className="flex items-center gap-2 md:gap-3">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center border-3 border-foreground bg-muted md:h-12 md:w-12">
                  <Calendar className="h-5 w-5 md:h-6 md:w-6" />
                </div>
                <div className="min-w-0">
                  <p className="truncate text-xs text-muted-foreground md:text-sm">
                    Lease Ends
                  </p>
                  <p className="truncate text-base font-bold md:text-xl">
                    {currentLease.leaseEnd}
                  </p>
                </div>
              </div>
            </Card>
          </div>

          {/* Tabs */}
          <div className="mb-6 flex flex-wrap gap-2 md:gap-4">
            {[
              { id: "overview", label: "Overview" },
              { id: "payments", label: "Payments" },
              { id: "saved", label: "Saved" },
            ].map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id as typeof activeTab)}
                className={`border-3 border-foreground px-3 py-2 text-sm font-bold transition-all md:px-6 md:py-3 md:text-base ${
                  activeTab === tab.id
                    ? "bg-foreground text-background shadow-[4px_4px_0px_0px_rgba(26,26,26,1)]"
                    : "bg-card hover:bg-muted"
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          {/* Overview Tab */}
          {activeTab === "overview" && (
            <div className="grid gap-4 md:gap-6 lg:grid-cols-2">
              {/* Current Property */}
              <Card className="border-3 border-foreground p-6 shadow-[4px_4px_0px_0px_rgba(26,26,26,1)]">
                <h3 className="mb-4 text-lg font-bold">Your Current Home</h3>
                <div className="mb-4 border-3 border-foreground bg-muted p-4">
                  <div className="flex items-center justify-center py-8">
                    <Building2 className="h-16 w-16 text-muted-foreground" />
                  </div>
                </div>
                <h4 className="text-xl font-bold">{currentLease.property}</h4>
                <p className="mt-1 flex items-center gap-1 text-muted-foreground">
                  <MapPin className="h-4 w-4" />
                  {currentLease.location}
                </p>

                <div className="mt-4 flex items-center gap-3 border-t-2 border-foreground pt-4">
                  <div className="flex h-10 w-10 items-center justify-center border-2 border-foreground bg-primary font-bold">
                    {currentLease.landlord?.name?.charAt(0) || "L"}
                  </div>
                  <div>
                    <p className="font-bold">{currentLease.landlord?.name || "Landlord"}</p>
                    <p className="text-sm text-muted-foreground">Your Landlord</p>
                  </div>
                  <Link href="/messages" className="ml-auto">
                    <Button
                      size="sm"
                      className="border-2 border-foreground bg-secondary font-bold"
                    >
                      <MessageSquare className="mr-1 h-4 w-4" />
                      Message
                    </Button>
                  </Link>
                </div>
              </Card>

              {/* Payment Progress */}
              <Card className="border-3 border-foreground p-6 shadow-[4px_4px_0px_0px_rgba(26,26,26,1)]">
                <h3 className="mb-4 text-lg font-bold">Payment Progress</h3>

                <div className="mb-6">
                  <div className="mb-2 flex justify-between text-sm">
                    <span className="text-muted-foreground">Progress</span>
                    <span className="font-bold">{currentLease.progress}%</span>
                  </div>
                  <div className="h-6 border-3 border-foreground bg-muted">
                    <div
                      className="h-full bg-secondary transition-all"
                      style={{ width: `${currentLease.progress}%` }}
                    />
                  </div>
                  <div className="mt-2 flex justify-between text-sm text-muted-foreground">
                    <span>{formatCurrency(currentLease.totalPaid)} paid</span>
                    <span>{formatCurrency(currentLease.totalOwed)} total</span>
                  </div>
                </div>

                <h4 className="mb-3 font-bold">Upcoming Payments</h4>
                <div className="space-y-2">
                  {paymentSchedule.slice(0, 3).map((payment) => (
                    <div
                      key={payment.month}
                      className="flex items-center justify-between border-b border-foreground/10 pb-2"
                    >
                      <div className="flex items-center gap-2">
                        {payment.status === "upcoming" ? (
                          <AlertCircle className="h-4 w-4 text-primary" />
                        ) : (
                          <Clock className="h-4 w-4 text-muted-foreground" />
                        )}
                        <span
                          className={
                            payment.status === "upcoming" ? "font-bold" : ""
                          }
                        >
                          {payment.month}
                        </span>
                      </div>
                      <span className="font-mono font-bold">
                        {formatCurrency(payment.amount)}
                      </span>
                    </div>
                  ))}
                </div>

                  <Button className="mt-4 w-full border-3 border-foreground bg-primary font-bold shadow-[4px_4px_0px_0px_rgba(26,26,26,1)] transition-all hover:translate-x-0.5 hover:translate-y-0.5 hover:shadow-[2px_2px_0px_0px_rgba(26,26,26,1)]">
                    Make Payment
                    <ArrowRight className="ml-2 h-4 w-4" />
                  </Button>
                </Card>

                {featureFlags.enableExperimentalStaking && (
                  <Card className="border-3 border-foreground bg-secondary/10 p-6 shadow-[4px_4px_0px_0px_rgba(26,26,26,1)] lg:col-span-2">
                    <div className="flex items-center gap-3">
                      <div className="flex h-12 w-12 items-center justify-center border-3 border-foreground bg-secondary">
                        <Heart className="h-6 w-6" />
                      </div>
                      <div>
                        <h3 className="text-lg font-bold">Experimental: Staking Rewards</h3>
                        <p className="text-sm text-muted-foreground">
                          Coming soon: Earn rewards automatically by paying rent on time!
                        </p>
                      </div>
                    </div>
                  </Card>
                )}
              </div>
            )}

          {/* Payment History Tab */}
          {activeTab === "payments" && (
            <Card className="border-3 border-foreground p-6 shadow-[4px_4px_0px_0px_rgba(26,26,26,1)]">
              <h3 className="mb-6 text-lg font-bold">Payment History</h3>

              <div className="space-y-3">
                {[...pastPayments, ...paymentSchedule].map((payment) => (
                  (() => {
                    const presentation = getPaymentHistoryPresentation(payment);

                    return (
                  <div
                    key={`${payment.month}-${payment.amount}-${payment.status}-${"dueDate" in payment ? payment.dueDate : payment.paidDate}`}
                    className="flex items-center justify-between border-b-2 border-foreground/10 pb-3 last:border-0"
                  >
                    <div className="flex items-center gap-4">
                      <div
                        className={`flex h-10 w-10 items-center justify-center border-2 border-foreground ${
                          presentation.iconContainerClassName
                        }`}
                      >
                        {payment.status === "paid" ? (
                          <CheckCircle className="h-5 w-5" />
                        ) : (
                          <Clock className="h-5 w-5" />
                        )}
                      </div>
                      <div>
                        <p className="font-bold">{payment.month}</p>
                        <p className="text-sm text-muted-foreground">
                          {presentation.detailText}
                        </p>
                      </div>
                    </div>
                    <div className="text-right">
                      <p className="font-mono font-bold">
                        {formatCurrency(payment.amount)}
                      </p>
                      <span
                        className={`text-sm font-bold ${
                          presentation.statusClassName
                        }`}
                      >
                        {presentation.statusLabel}
                      </span>
                    </div>
                  </div>
                    );
                  })()
                ))}
              </div>
            </Card>
          )}

          {/* Saved Properties Tab */}
          {activeTab === "saved" && (
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              {savedProperties.map((property) => (
                <Card
                  key={property.id}
                  className="border-3 border-foreground p-0 shadow-[4px_4px_0px_0px_rgba(26,26,26,1)]"
                >
                  <div className="relative border-b-3 border-foreground bg-muted p-8">
                    <Building2 className="mx-auto h-12 w-12 text-muted-foreground" />
                    <button className="absolute right-3 top-3 flex h-8 w-8 items-center justify-center border-2 border-foreground bg-background">
                      <Heart className="h-4 w-4 fill-destructive text-destructive" />
                    </button>
                  </div>
                  <div className="p-4">
                    <h4 className="font-bold">{property.title}</h4>
                    <p className="text-sm text-muted-foreground">
                      {property.location}
                    </p>
                    <p className="mt-2 text-lg font-bold text-primary">
                      {formatCurrency(property.price)}/yr
                    </p>
                    <Link href={`/properties/${property.id}`}>
                      <Button className="mt-3 w-full border-2 border-foreground bg-secondary font-bold">
                        View Property
                      </Button>
                    </Link>
                  </div>
                </Card>
              ))}
              <Card className="flex items-center justify-center border-3 border-dashed border-foreground p-8">
                <Link href="/properties" className="text-center">
                  <Building2 className="mx-auto h-12 w-12 text-muted-foreground" />
                  <p className="mt-2 font-bold">Browse More Properties</p>
                  <p className="text-sm text-muted-foreground">
                    Find your next home
                  </p>
                </Link>
              </Card>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
