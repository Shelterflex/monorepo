"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import {
  Building2,
  CreditCard,
  MessageSquare,
  Calendar,
  Clock,
  CheckCircle,
  AlertCircle,
  ArrowRight,
  MapPin,
  ShieldCheck,
  Heart,
  Receipt,
} from "lucide-react";
import { PropertyCard } from "@/components/property-card";
import { PropertyCardSkeleton } from "@/components/property-card-skeleton";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  EmptyState,
  ErrorState,
  ListRowSkeleton,
  LoadingState,
  MoneyValue,
  StatCardSkeleton,
} from "@/components/ui/data-state";
import { DashboardHeader } from "@/components/dashboard-header";
import { DashboardSidebar } from "@/components/dashboard/DashboardSidebar";
import { TenantRewardsSummaryCard } from "@/components/tenant-rewards-summary-card";
import { useFeatureFlag } from "@/lib/featureFlags";
import { getTenantPaymentStatusPresentation } from "@/lib/tenantPaymentStatus";
import { apiFetch } from "@/lib/api";
import { SectionBoundary } from "@/components/section-boundary";
import { formatDate, formatMonthYear } from "@/lib/date";
import {
  getTenantCurrentLease,
  getPaymentSchedule,
  getPaymentHistory,
  type TenantCurrentLease,
  type PaymentScheduleItem,
  type PaymentHistoryItem,
} from "@/lib/tenantApi";
import { fetchSavedListingIds } from "@/lib/savedPropertiesApi";
import { listPublicListings, type PublicListing } from "@/lib/propertiesApi";

type PaymentItem =
  | PaymentScheduleItem
  | (PaymentHistoryItem & { month: string });

export default function TenantDashboard() {
  const isStakingEnabled = useFeatureFlag("STAKING_ENABLED");
  const [activeTab, setActiveTab] = useState<"overview" | "payments" | "saved">(
    "overview",
  );

  const [currentLease, setCurrentLease] = useState<TenantCurrentLease | null>(
    null,
  );
  const [paymentSchedule, setPaymentSchedule] = useState<PaymentScheduleItem[]>(
    [],
  );
  const [pastPayments, setPastPayments] = useState<PaymentHistoryItem[]>([]);
  const [savedProperties, setSavedProperties] = useState<PublicListing[]>([]);

  const [leaseLoading, setLeaseLoading] = useState(true);
  const [leaseError, setLeaseError] = useState<string | null>(null);
  const [paymentsLoading, setPaymentsLoading] = useState(true);
  const [paymentsError, setPaymentsError] = useState<string | null>(null);
  const [savedLoading, setSavedLoading] = useState(true);
  const [savedError, setSavedError] = useState<string | null>(null);

  const [onboardingStatus, setOnboardingStatus] = useState<{
    completedSteps: string[];
    currentStep: string;
    submitted: boolean;
  } | null>(null);

  useEffect(() => {
    apiFetch<{
      completedSteps: string[];
      currentStep: string;
      submitted: boolean;
    }>("/api/onboarding/status")
      .then(setOnboardingStatus)
      .catch(() => {});
  }, []);

  const loadLease = useCallback(() => {
    getTenantCurrentLease()
      .then((res) => {
        setCurrentLease(res.data);
        setLeaseError(null);
      })
      .catch((err) => {
        console.error("Failed to load lease:", err);
        setLeaseError(
          err instanceof Error ? err.message : "Failed to load lease",
        );
      })
      .finally(() => setLeaseLoading(false));
  }, []);

  const loadPayments = useCallback(() => {
    Promise.all([getPaymentSchedule(), getPaymentHistory({ limit: 10 })])
      .then(([scheduleRes, historyRes]) => {
        setPaymentSchedule(scheduleRes.data.schedule || []);
        setPastPayments(historyRes.data.payments || []);
        setPaymentsError(null);
      })
      .catch((err) => {
        console.error("Failed to load payments:", err);
        setPaymentsError(
          err instanceof Error ? err.message : "Failed to load payments",
        );
      })
      .finally(() => setPaymentsLoading(false));
  }, []);

  const loadSaved = useCallback(() => {
    fetchSavedListingIds()
      .then((ids) => {
        if (ids.length === 0) {
          setSavedProperties([]);
          return;
        }
        return listPublicListings({ listingIds: ids }).then((listings) => {
          setSavedProperties(listings.data);
        });
      })
      .catch((err) => {
        console.error("Failed to load saved properties:", err);
        setSavedError(
          err instanceof Error
            ? err.message
            : "Failed to load saved properties",
        );
      })
      .finally(() => setSavedLoading(false));
  }, []);

  useEffect(() => {
    loadLease();
  }, [loadLease]);

  useEffect(() => {
    loadPayments();
  }, [loadPayments]);

  useEffect(() => {
    loadSaved();
  }, [loadSaved]);

  // Retry handlers reset to the loading state before re-fetching. Kept separate
  // from the loaders above so the mount effects never call setState synchronously.
  const retryLease = useCallback(() => {
    setLeaseLoading(true);
    setLeaseError(null);
    loadLease();
  }, [loadLease]);

  const retryPayments = useCallback(() => {
    setPaymentsLoading(true);
    setPaymentsError(null);
    loadPayments();
  }, [loadPayments]);

  const retrySaved = useCallback(() => {
    setSavedLoading(true);
    setSavedError(null);
    loadSaved();
  }, [loadSaved]);

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat("en-NG", {
      style: "currency",
      currency: "NGN",
      minimumFractionDigits: 0,
    }).format(amount);
  };

  const getPaymentHistoryPresentation = (payment: PaymentItem) => {
    const status = "status" in payment ? payment.status : "paid";
    const statusPresentation = getTenantPaymentStatusPresentation(status);

    let detailText = "";
    if ("paidDate" in payment && payment.paidDate) {
      detailText = `Paid on ${formatDate(payment.paidDate)}`;
    } else if ("dueDate" in payment && payment.dueDate) {
      detailText = `Due ${formatDate(payment.dueDate)}`;
    }

    return {
      detailText,
      statusPresentation,
    };
  };

  const onboardingComplete = onboardingStatus?.submitted || false;
  const onboardingProgress = onboardingStatus
    ? Math.round((onboardingStatus.completedSteps.length / 5) * 100)
    : 0;
  const showOnboardingBanner = onboardingStatus && !onboardingStatus.submitted;

  // Left null rather than 0 when either side is missing, so MoneyValue renders
  // an explicit dash instead of a balance the server never sent.
  const remainingBalance =
    currentLease &&
    Number.isFinite(currentLease.totalOwed) &&
    Number.isFinite(currentLease.totalPaid)
      ? currentLease.totalOwed - currentLease.totalPaid
      : null;

  const allPayments: PaymentItem[] = [
    ...pastPayments.map((p) => ({
      ...p,
      month: formatMonthYear(p.transactionDate),
    })),
    ...paymentSchedule,
  ];

  return (
    <div className="min-h-screen bg-background">
      <DashboardHeader />

      {showOnboardingBanner && (
        <div className="border-b-3 border-foreground bg-amber-50">
          <div className="mx-auto max-w-7xl px-4 py-3 flex items-center justify-between gap-4 flex-wrap">
            <div className="flex items-center gap-3">
              <AlertCircle className="h-5 w-5 text-amber-600 shrink-0" aria-hidden="true" />
              <div>
                <p className="text-sm font-semibold text-amber-900">
                  Complete your profile to apply for properties
                </p>
                <div className="flex items-center gap-2 mt-0.5">
                  <div className="w-32 h-1.5 bg-amber-200 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-amber-500 rounded-full transition-all"
                      style={{ width: `${onboardingProgress}%` }}
                    />
                  </div>
                  <span className="text-xs text-amber-700">
                    {onboardingStatus.completedSteps.length} / 5 steps
                  </span>
                </div>
              </div>
            </div>
            <Link href="/onboarding">
              <Button
                size="sm"
                className="bg-amber-600 hover:bg-amber-700 text-white border-none"
              >
                Continue
                <ArrowRight className="h-4 w-4 ml-1" />
              </Button>
            </Link>
          </div>
        </div>
      )}

      {onboardingComplete && (
        <div className="border-b-3 border-foreground bg-blue-50">
          <div className="mx-auto max-w-7xl px-4 py-3 flex items-center gap-3">
            <ShieldCheck className="h-5 w-5 text-blue-600 shrink-0" />
            <p className="text-sm font-semibold text-blue-900">
              Assessment in progress — we will notify you once your profile is
              reviewed.
            </p>
          </div>
        </div>
      )}

      <DashboardSidebar
        role="tenant"
        userInfo={{ name: "Ngozi Adekunle", roleLabel: "Tenant" }}
      />

      <main className="min-h-screen pt-20 lg:ml-64">
        <div className="p-4 md:p-6 lg:p-8">
          <div className="mb-6 md:mb-8">
            <h1 className="text-2xl font-bold text-foreground md:text-3xl lg:text-4xl">
              Welcome back, Ngozi!
            </h1>
            {leaseLoading ? (
              <LoadingState
                label="Loading your lease summary"
                className="mt-2 flex h-6 items-center md:h-7 lg:h-8"
              >
                <Skeleton className="h-4 w-72 max-w-full" />
              </LoadingState>
            ) : leaseError ? (
              <p className="mt-2 text-sm text-muted-foreground md:text-base lg:text-lg">
                We couldn&apos;t load your lease just now.
              </p>
            ) : currentLease ? (
              <p className="mt-2 text-sm text-muted-foreground md:text-base lg:text-lg">
                Your next payment of{" "}
                <MoneyValue
                  status="ready"
                  amount={currentLease.monthlyPayment}
                  format={formatCurrency}
                  className="font-bold text-foreground"
                />{" "}
                is due on{" "}
                {formatDate(currentLease.nextPaymentDate)}
              </p>
            ) : (
              <p className="mt-2 text-sm text-muted-foreground md:text-base lg:text-lg">
                You have no active lease at the moment
              </p>
            )}
          </div>

          {leaseLoading ? (
            <LoadingState
              label="Loading lease totals"
              className="mb-6 grid grid-cols-2 gap-3 md:mb-8 md:grid-cols-4 md:gap-4"
            >
              {Array.from({ length: 4 }).map((_, index) => (
                <StatCardSkeleton key={`lease-stat-${index}`} className="md:p-4" />
              ))}
            </LoadingState>
          ) : leaseError ? (
            <ErrorState
              className="mb-6 md:mb-8"
              title="Failed to load lease information"
              description={leaseError}
              onRetry={retryLease}
            />
          ) : currentLease ? (
            <div className="mb-6 grid grid-cols-2 gap-3 md:mb-8 md:grid-cols-4 md:gap-4">
              <Card className="border-3 border-foreground p-3 shadow-[4px_4px_0px_0px_rgba(26,26,26,1)] md:p-4">
                <div className="flex items-center gap-2 md:gap-3">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center border-3 border-foreground bg-primary md:h-12 md:w-12">
                    <CreditCard className="h-5 w-5 md:h-6 md:w-6" />
                  </div>
                  <div className="min-w-0">
                    <p className="truncate text-xs text-muted-foreground md:text-sm">
                      Next Due Date
                    </p>
                    <p className="truncate text-base font-bold md:text-xl">
                      {formatDate(currentLease.nextPaymentDate)}
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
                      <MoneyValue
                        status="ready"
                        amount={currentLease.totalPaid}
                        format={formatCurrency}
                      />
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
                      <MoneyValue
                        status={remainingBalance === null ? "error" : "ready"}
                        amount={remainingBalance}
                        format={formatCurrency}
                        unavailableLabel="Balance unavailable"
                      />
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
                      {formatDate(currentLease.leaseEnd)}
                    </p>
                  </div>
                </div>
              </Card>
            </div>
          ) : null}

          <div
            className="mb-6 flex flex-wrap gap-2 md:gap-4"
            role="tablist"
            aria-label="Dashboard sections"
          >
            {[
              { id: "overview", label: "Overview" },
              { id: "payments", label: "Payments" },
              { id: "saved", label: "Saved" },
            ].map((tab) => (
              <button
                key={tab.id}
                role="tab"
                aria-selected={activeTab === tab.id}
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

          {activeTab === "overview" && (
            <SectionBoundary section="tenant-dashboard-overview" userRole="tenant">
            <div className="grid gap-4 md:gap-6 lg:grid-cols-2">
              {leaseLoading ? (
                <LoadingState label="Loading your current home">
                  <Card className="space-y-4 border-3 border-foreground p-6 shadow-[4px_4px_0px_0px_rgba(26,26,26,1)]">
                    <Skeleton className="h-6 w-40" />
                    <Skeleton className="h-40 w-full" />
                    <Skeleton className="h-6 w-56" />
                    <Skeleton className="h-4 w-40" />
                    <Skeleton className="h-12 w-full" />
                  </Card>
                </LoadingState>
              ) : leaseError ? (
                <ErrorState
                  title="Failed to load your current home"
                  description={leaseError}
                  onRetry={retryLease}
                />
              ) : currentLease ? (
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
                      <p className="font-bold">
                        {currentLease.landlord?.name || "Landlord"}
                      </p>
                      <p className="text-sm text-muted-foreground">
                        Your Landlord
                      </p>
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
              ) : (
                <EmptyState
                  icon={Building2}
                  title="No active lease"
                  description="Once you're approved for a property, your lease, landlord, and payment schedule will show up here."
                  action={{ label: "Browse properties", href: "/properties" }}
                />
              )}

              <Card className="border-3 border-foreground p-6 shadow-[4px_4px_0px_0px_rgba(26,26,26,1)]">
                <h3 className="mb-4 text-lg font-bold">Payment Progress</h3>

                {currentLease && (
                  <>
                    <div className="mb-6">
                      <div className="mb-2 flex justify-between text-sm">
                        <span className="text-muted-foreground">Progress</span>
                        <span className="font-bold">
                          {currentLease.progress}%
                        </span>
                      </div>
                      <div
                        className="h-6 border-3 border-foreground bg-muted"
                        role="progressbar"
                        aria-valuenow={currentLease.progress}
                        aria-valuemin={0}
                        aria-valuemax={100}
                        aria-label={`Payment progress: ${currentLease.progress}%`}
                      >
                        <div
                          className="h-full bg-secondary transition-all"
                          style={{ width: `${currentLease.progress}%` }}
                        />
                      </div>
                      <div className="mt-2 flex justify-between text-sm text-muted-foreground">
                        <span>
                          <MoneyValue
                            status="ready"
                            amount={currentLease.totalPaid}
                            format={formatCurrency}
                          />{" "}
                          paid
                        </span>
                        <span>
                          <MoneyValue
                            status="ready"
                            amount={currentLease.totalOwed}
                            format={formatCurrency}
                          />{" "}
                          total
                        </span>
                      </div>
                    </div>

                    <h4 className="mb-3 font-bold">Upcoming Payments</h4>
                    {paymentsLoading ? (
                      <LoadingState
                        label="Loading upcoming payments"
                        className="space-y-2"
                      >
                        {Array.from({ length: 3 }).map((_, index) => (
                          <div
                            key={`upcoming-${index}`}
                            className="flex items-center justify-between border-b border-foreground/10 pb-2"
                          >
                            <Skeleton className="h-5 w-28" />
                            <Skeleton className="h-5 w-24" />
                          </div>
                        ))}
                      </LoadingState>
                    ) : paymentsError ? (
                      <ErrorState
                        title="Failed to load upcoming payments"
                        description={paymentsError}
                        onRetry={retryPayments}
                      />
                    ) : paymentSchedule.length > 0 ? (
                      <div className="space-y-2">
                        {paymentSchedule.slice(0, 3).map((payment) => (
                          <div
                            key={`${payment.period}-${payment.dueDate}`}
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
                                  payment.status === "upcoming"
                                    ? "font-bold"
                                    : ""
                                }
                              >
                                {payment.month}
                              </span>
                            </div>
                            <span className="font-mono font-bold">
                              <MoneyValue
                                status="ready"
                                amount={payment.amount}
                                format={formatCurrency}
                              />
                            </span>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className="text-sm text-muted-foreground">
                        You&apos;re all paid up — no upcoming instalments on this
                        lease.
                      </p>
                    )}
                  </>
                )}

                <Button className="mt-4 w-full border-3 border-foreground bg-primary font-bold shadow-[4px_4px_0px_0px_rgba(26,26,26,1)] transition-all hover:translate-x-0.5 hover:translate-y-0.5 hover:shadow-[2px_2px_0px_0px_rgba(26,26,26,1)]">
                  Make Payment
                  <ArrowRight className="ml-2 h-4 w-4" />
                </Button>
              </Card>

              {isStakingEnabled && <TenantRewardsSummaryCard />}
            </div>
            </SectionBoundary>
          )}

          {activeTab === "payments" && (
            <SectionBoundary section="tenant-dashboard-payments" userRole="tenant">
            <Card className="border-3 border-foreground p-6 shadow-[4px_4px_0px_0px_rgba(26,26,26,1)]">
              <h3 className="mb-6 text-lg font-bold">Payment History</h3>

              {paymentsLoading ? (
                <LoadingState
                  label="Loading payment history"
                  className="space-y-3"
                >
                  {Array.from({ length: 4 }).map((_, index) => (
                    <ListRowSkeleton key={`payment-${index}`} />
                  ))}
                </LoadingState>
              ) : paymentsError ? (
                <ErrorState
                  title="Failed to load payments"
                  description={paymentsError}
                  onRetry={retryPayments}
                />
              ) : allPayments.length === 0 ? (
                <EmptyState
                  icon={Receipt}
                  title="No payment history yet"
                  description="Payments you make on your lease will be listed here with their receipts and status."
                  action={{ label: "Go to payments", href: "/dashboard/tenant/payments" }}
                />
              ) : (
                <div className="space-y-3">
                  {allPayments.map((payment) => {
                    const presentation = getPaymentHistoryPresentation(payment);
                    const paymentId =
                      "id" in payment
                        ? payment.id
                        : `${payment.period}-${payment.dueDate}`;

                    return (
                      <div
                        key={paymentId}
                        className="flex items-center justify-between border-b-2 border-foreground/10 pb-3 last:border-0"
                      >
                        <div className="flex items-center gap-4">
                          <div
                            className={`flex h-10 w-10 items-center justify-center border-2 border-foreground ${
                              presentation.statusPresentation
                                .iconContainerClassName
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
                            <MoneyValue
                              status="ready"
                              amount={payment.amount}
                              format={formatCurrency}
                            />
                          </p>
                          <Badge
                            variant={presentation.statusPresentation.variant}
                            className={
                              presentation.statusPresentation.className
                            }
                          >
                            {presentation.statusPresentation.label}
                          </Badge>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </Card>
            </SectionBoundary>
          )}

          {activeTab === "saved" && (
            <SectionBoundary section="tenant-dashboard-saved" userRole="tenant">
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              {savedLoading ? (
                <LoadingState
                  label="Loading saved properties"
                  className="col-span-full grid gap-4 md:grid-cols-2 lg:grid-cols-3"
                >
                  {Array.from({ length: 3 }).map((_, i) => (
                    <PropertyCardSkeleton key={`saved-${i}`} />
                  ))}
                </LoadingState>
              ) : savedError ? (
                <ErrorState
                  className="col-span-full"
                  title="Failed to load saved properties"
                  description={savedError}
                  onRetry={retrySaved}
                />
              ) : savedProperties.length > 0 ? (
                <>
                  {savedProperties.map((property) => (
                    <PropertyCard
                      key={property.listingId}
                      property={property}
                      isFavorited
                      href={`/properties/${property.listingId}`}
                    />
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
                </>
              ) : (
                <EmptyState
                  className="col-span-full"
                  icon={Heart}
                  title="No saved properties yet"
                  description="Tap the heart on any listing to keep it here, so you can compare your shortlist later."
                  action={{ label: "Browse properties", href: "/properties" }}
                />
              )}
            </div>
            </SectionBoundary>
          )}
        </div>
      </main>
    </div>
  );
}
