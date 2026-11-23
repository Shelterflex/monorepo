"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  Building2,
  Calendar,
  CheckCircle,
  CreditCard,
  MapPin,
  Clock,
  User,
  Phone,
  Mail,
  Loader2,
  AlertCircle,
  FileText,
  ShieldCheck,
  ArrowRight,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { DashboardHeader } from "@/components/dashboard-header";
import { DashboardSidebar } from "@/components/dashboard/DashboardSidebar";
import useAuthStore from "@/store/useAuthStore";
import { formatDate } from "@/lib/date";
import { formatMoney } from "@/lib/currency";
import {
  getTenantCurrentLease,
  getTenantLeaseDetails,
  type TenantCurrentLease,
  type TenantLeaseDetails,
} from "@/lib/tenantApi";

export default function TenantLeasePage() {
  const user = useAuthStore((state) => state.user);
  const userName = user?.name ?? user?.email ?? "User";
  const [currentLease, setCurrentLease] = useState<TenantCurrentLease | null>(null);
  const [leaseDetails, setLeaseDetails] = useState<TenantLeaseDetails | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [noActiveLease, setNoActiveLease] = useState(false);

  const fetchLease = async () => {
    setLoading(true);
    setError(null);
    setNoActiveLease(false);
    try {
      const currentRes = await getTenantCurrentLease();
      if (!currentRes?.data || !currentRes.data.dealId) {
        setNoActiveLease(true);
        setLoading(false);
        return;
      }
      setCurrentLease(currentRes.data);

      try {
        const detailsRes = await getTenantLeaseDetails(currentRes.data.dealId);
        if (detailsRes?.data) {
          setLeaseDetails(detailsRes.data);
        }
      } catch (detailErr: any) {
        // Fallback gracefully to summary card data if details endpoint is 404/fails
        console.warn("Could not fetch full lease details:", detailErr);
      }
    } catch (err: any) {
      if (
        err?.status === 404 ||
        err?.message?.includes("404") ||
        err?.message?.toLowerCase().includes("not found")
      ) {
        setNoActiveLease(true);
      } else {
        setError(err?.message || "Failed to load lease");
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchLease();
  }, []);

  const formatCurrency = (amount: number) => {
    return formatMoney(amount, "NGN");
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-background">
        <DashboardHeader />
        <DashboardSidebar
          role="tenant"
          userInfo={{ name: userName, roleLabel: "Tenant" }}
        />
        <main id="main-content" className="min-h-screen pt-20 lg:ml-64">
          <div className="flex items-center justify-center p-8">
            <Loader2 className="h-12 w-12 animate-spin text-muted-foreground" />
          </div>
        </main>
      </div>
    );
  }

  if (noActiveLease || (!currentLease && !leaseDetails && !error)) {
    return (
      <div className="min-h-screen bg-background">
        <DashboardHeader />
        <DashboardSidebar
          role="tenant"
          userInfo={{ name: userName, roleLabel: "Tenant" }}
        />
        <main id="main-content" className="min-h-screen pt-20 lg:ml-64">
          <div className="p-8">
            <div className="mb-6">
              <h1 className="text-3xl font-bold text-foreground">My Lease</h1>
              <p className="mt-1 text-muted-foreground">
                View your current lease terms and agreement details
              </p>
            </div>
            <Card className="border-3 border-foreground p-8 text-center shadow-[4px_4px_0px_0px_rgba(26,26,26,1)]">
              <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center border-3 border-foreground bg-muted">
                <FileText className="h-8 w-8 text-muted-foreground" />
              </div>
              <h2 className="text-xl font-bold">No Active Lease</h2>
              <p className="mx-auto mt-2 max-w-md text-sm text-muted-foreground">
                You do not have an active lease at the moment. Once your rental application is approved and finalized, your lease terms, payment schedule, and landlord information will appear here.
              </p>
              <div className="mt-6">
                <Button asChild className="border-3 border-foreground bg-primary font-bold shadow-[4px_4px_0px_0px_rgba(26,26,26,1)]">
                  <Link href="/properties">
                    Browse Properties
                    <ArrowRight className="ml-2 h-4 w-4" />
                  </Link>
                </Button>
              </div>
            </Card>
          </div>
        </main>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-background">
        <DashboardHeader />
        <DashboardSidebar
          role="tenant"
          userInfo={{ name: userName, roleLabel: "Tenant" }}
        />
        <main id="main-content" className="min-h-screen pt-20 lg:ml-64">
          <div className="p-8">
            <Card className="border-3 border-foreground bg-destructive/10 p-6 shadow-[4px_4px_0px_0px_rgba(26,26,26,1)]">
              <div className="flex items-start gap-3">
                <AlertCircle className="h-5 w-5 shrink-0 text-destructive" />
                <div className="flex-1">
                  <p className="font-bold text-destructive">Failed to load lease information</p>
                  <p className="text-sm text-muted-foreground">{error}</p>
                  <Button
                    onClick={fetchLease}
                    variant="outline"
                    size="sm"
                    className="mt-4 border-2 border-foreground font-bold"
                  >
                    Retry
                  </Button>
                </div>
              </div>
            </Card>
          </div>
        </main>
      </div>
    );
  }

  const propertyTitle = leaseDetails?.property?.title || currentLease?.property || "Property";
  const propertyAddress = leaseDetails?.property?.address || currentLease?.location || "Location";
  const startDate = leaseDetails?.lease?.startDate;
  const endDate = leaseDetails?.lease?.endDate || currentLease?.leaseEnd;
  const duration = leaseDetails?.lease?.duration || "12 months";
  const monthlyRent = leaseDetails?.lease?.monthlyPayment ?? currentLease?.monthlyPayment ?? 0;
  const leaseStatus = leaseDetails?.lease?.status || "active";
  const landlordName = leaseDetails?.landlord?.name || currentLease?.landlord?.name || "Landlord";
  const landlordCompany = leaseDetails?.landlord?.company;
  const landlordPhone = leaseDetails?.landlord?.phone;
  const landlordEmail = leaseDetails?.landlord?.email;

  const totalPaid = leaseDetails?.paymentProgress?.totalPaid ?? currentLease?.totalPaid ?? 0;
  const totalOwed = leaseDetails?.paymentProgress?.totalOwed ?? currentLease?.totalOwed ?? 0;
  const progressPercent = totalOwed > 0 ? Math.min(100, Math.round((totalPaid / totalOwed) * 100)) : (currentLease?.progress ?? 0);

  return (
    <div className="min-h-screen bg-background">
      <DashboardHeader />
      <DashboardSidebar
        role="tenant"
        userInfo={{ name: userName, roleLabel: "Tenant" }}
      />
      <main id="main-content" className="min-h-screen pt-20 lg:ml-64">
        <div className="p-4 md:p-6 lg:p-8">
          <div className="mb-6 flex flex-wrap items-center justify-between gap-4 md:mb-8">
            <div>
              <h1 className="text-2xl font-bold text-foreground md:text-3xl">My Lease</h1>
              <p className="mt-1 text-sm text-muted-foreground md:text-base">
                View your current lease terms, payment history, and landlord details
              </p>
            </div>
            <div className="flex items-center gap-2 border-3 border-foreground bg-secondary px-4 py-2 font-bold shadow-[3px_3px_0px_0px_rgba(26,26,26,1)]">
              <CheckCircle className="h-5 w-5" />
              <span className="capitalize">{leaseStatus} Lease</span>
            </div>
          </div>

          <div className="grid gap-6 lg:grid-cols-3">
            <div className="space-y-6 lg:col-span-2">
              {/* Property Summary Card */}
              <Card className="border-3 border-foreground p-6 shadow-[4px_4px_0px_0px_rgba(26,26,26,1)]">
                <h3 className="mb-4 text-lg font-bold">Property Summary</h3>
                <div className="mb-4 flex items-center justify-center border-3 border-foreground bg-muted p-6">
                  <Building2 className="h-16 w-16 text-muted-foreground" />
                </div>
                <h4 className="text-xl font-bold">{propertyTitle}</h4>
                <p className="mt-1 flex items-center gap-1 text-muted-foreground">
                  <MapPin className="h-4 w-4 shrink-0" />
                  {propertyAddress}
                </p>

                {leaseDetails?.property && (
                  <div className="mt-4 flex flex-wrap gap-3">
                    <span className="border-2 border-foreground bg-muted px-3 py-1 text-sm font-bold">
                      {leaseDetails.property.beds} Beds
                    </span>
                    <span className="border-2 border-foreground bg-muted px-3 py-1 text-sm font-bold">
                      {leaseDetails.property.baths} Baths
                    </span>
                    <span className="border-2 border-foreground bg-muted px-3 py-1 text-sm font-bold">
                      {leaseDetails.property.sqm} sqm
                    </span>
                  </div>
                )}
              </Card>

              {/* Lease Terms & Details Card */}
              <Card className="border-3 border-foreground p-6 shadow-[4px_4px_0px_0px_rgba(26,26,26,1)]">
                <h3 className="mb-4 text-lg font-bold">Lease Terms</h3>
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="border-3 border-foreground bg-muted/50 p-4">
                    <div className="flex items-center gap-2 text-muted-foreground">
                      <Calendar className="h-4 w-4" />
                      <span className="text-sm">Start Date</span>
                    </div>
                    <p className="mt-1 font-bold">
                      {startDate ? formatDate(startDate) : "N/A"}
                    </p>
                  </div>

                  <div className="border-3 border-foreground bg-muted/50 p-4">
                    <div className="flex items-center gap-2 text-muted-foreground">
                      <Calendar className="h-4 w-4" />
                      <span className="text-sm">End Date</span>
                    </div>
                    <p className="mt-1 font-bold">
                      {endDate ? formatDate(endDate) : "N/A"}
                    </p>
                  </div>

                  <div className="border-3 border-foreground bg-muted/50 p-4">
                    <div className="flex items-center gap-2 text-muted-foreground">
                      <Clock className="h-4 w-4" />
                      <span className="text-sm">Duration</span>
                    </div>
                    <p className="mt-1 font-bold">{duration}</p>
                  </div>

                  <div className="border-3 border-foreground bg-primary/10 p-4">
                    <div className="flex items-center gap-2 text-muted-foreground">
                      <CreditCard className="h-4 w-4" />
                      <span className="text-sm">Monthly Rent</span>
                    </div>
                    <p className="mt-1 font-bold text-primary">
                      {formatCurrency(monthlyRent)}
                    </p>
                  </div>
                </div>

                {/* Payment Progress */}
                <div className="mt-6 border-t-2 border-foreground pt-6">
                  <div className="mb-2 flex justify-between text-sm">
                    <span className="text-muted-foreground">Payment Progress</span>
                    <span className="font-bold">{progressPercent}%</span>
                  </div>
                  <div className="h-4 w-full border-2 border-foreground bg-muted">
                    <div
                      className="h-full bg-secondary transition-all"
                      style={{ width: `${progressPercent}%` }}
                    />
                  </div>
                  <div className="mt-2 flex justify-between text-sm text-muted-foreground">
                    <span>{formatCurrency(totalPaid)} paid</span>
                    <span>{formatCurrency(totalOwed)} total</span>
                  </div>
                </div>
              </Card>
            </div>

            <div className="space-y-6">
              {/* Landlord Information */}
              <Card className="border-3 border-foreground p-6 shadow-[4px_4px_0px_0px_rgba(26,26,26,1)]">
                <h3 className="mb-4 text-lg font-bold">Landlord</h3>
                <div className="mb-4 flex items-center gap-4">
                  <div className="flex h-14 w-14 items-center justify-center border-3 border-foreground bg-primary text-xl font-bold">
                    <User className="h-7 w-7" />
                  </div>
                  <div>
                    <p className="font-bold">{landlordName}</p>
                    {landlordCompany && (
                      <p className="text-xs text-muted-foreground">
                        {landlordCompany}
                      </p>
                    )}
                  </div>
                </div>

                <div className="space-y-3 border-t-2 border-foreground pt-4">
                  {landlordPhone && (
                    <div className="flex items-center gap-2 text-sm">
                      <Phone className="h-4 w-4 text-muted-foreground" />
                      <span>{landlordPhone}</span>
                    </div>
                  )}
                  {landlordEmail && (
                    <div className="flex items-center gap-2 text-sm">
                      <Mail className="h-4 w-4 text-muted-foreground" />
                      <span>{landlordEmail}</span>
                    </div>
                  )}
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <ShieldCheck className="h-4 w-4 text-primary" />
                    <span>Verified Landlord</span>
                  </div>
                </div>
              </Card>

              {/* Quick Actions */}
              <Card className="border-3 border-foreground bg-accent/20 p-6 shadow-[4px_4px_0px_0px_rgba(26,26,26,1)]">
                <h3 className="mb-2 font-bold">Need Help?</h3>
                <p className="mb-4 text-sm text-muted-foreground">
                  Have questions regarding your lease or need assistance with your payment schedule?
                </p>
                <Button
                  asChild
                  variant="outline"
                  className="w-full border-3 border-foreground bg-background font-bold shadow-[2px_2px_0px_0px_rgba(26,26,26,1)]"
                >
                  <Link href="/dashboard/tenant/payments">
                    View Payments
                  </Link>
                </Button>
              </Card>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
