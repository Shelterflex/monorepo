"use client";

import { useState } from "react";
import Link from "next/link";
import {
  Home,
  Building2,
  CreditCard,
  MessageSquare,
  Settings,
  Calendar,
  CheckCircle,
  MapPin,
  FileText,
  Download,
  User,
  Phone,
  Mail,
  Clock,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { DashboardHeader } from "@/components/dashboard-header";
import { leaseDetails } from "@/lib/mockData/leaseData";
import {
  leaseAgreement,
  propertyInspectionReport,
  paymentSchedule,
  houseRules,
} from "@/lib/mockData/documents";

import { DashboardHeader } from "@/components/dashboard-header";
import { TenantSidebar } from "@/components/tenant/TenantSidebar";
import { leaseDetails } from "@/lib/mockData/leaseData";

export default function TenantLeasePage() {
  const [selectedDocument, setSelectedDocument] = useState<
    | typeof leaseAgreement
    | typeof propertyInspectionReport
    | typeof paymentSchedule
    | typeof houseRules
    | null
  >(null);

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat("en-NG", {
      style: "currency",
      currency: "NGN",
      minimumFractionDigits: 0,
    }).format(amount);
  };

  const progressPercentage =
    (leaseDetails.paymentProgress.totalPaid /
      leaseDetails.paymentProgress.totalOwed) *
    100;

  const getDocumentObject = (docName: string) => {
    switch (docName) {
      case "Lease Agreement":
        return leaseAgreement;
      case "Property Inspection Report":
        return propertyInspectionReport;
      case "Payment Schedule":
        return paymentSchedule;
      case "House Rules":
        return houseRules;
      default:
        return null;
    }
  };

  return (
    <div className="min-h-screen bg-background">
      <DashboardHeader />
      <TenantSidebar />

      {/* Main Content */}
      <main className="ml-64 min-h-screen pt-20">
        <div className="p-8">
          {/* Header */}
          <div className="mb-8 flex items-center justify-between">
            <div>
              <h1 className="text-3xl font-bold text-foreground">My Lease</h1>
              <p className="mt-1 text-muted-foreground">
                View your lease details and documents
              </p>
            </div>
            <div className="flex items-center gap-2 border-3 border-foreground bg-secondary px-4 py-2 font-bold">
              <CheckCircle className="h-5 w-5" />
              Active Lease
            </div>
          </div>

          <div className="grid gap-6 lg:grid-cols-3">
            {/* Property Details */}
            <div className="lg:col-span-2 space-y-6">
              <Card className="border-3 border-foreground p-6 shadow-[4px_4px_0px_0px_rgba(26,26,26,1)]">
                <h3 className="mb-4 text-lg font-bold">Property Details</h3>
                <div className="mb-4 border-3 border-foreground bg-muted p-8">
                  <div className="flex items-center justify-center">
                    <Building2 className="h-20 w-20 text-muted-foreground" />
                  </div>
                </div>
                <h4 className="text-xl font-bold">
                  {leaseDetails.property.title}
                </h4>
                <p className="mt-1 flex items-center gap-1 text-muted-foreground">
                  <MapPin className="h-4 w-4" />
                  {leaseDetails.property.address}
                </p>
                <div className="mt-4 flex gap-4">
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
              </Card>

              {/* Lease Terms */}
              <Card className="border-3 border-foreground p-6 shadow-[4px_4px_0px_0px_rgba(26,26,26,1)]">
                <h3 className="mb-4 text-lg font-bold">Lease Terms</h3>
                <div className="grid gap-4 md:grid-cols-2">
                  <div className="border-3 border-foreground bg-muted/50 p-4">
                    <div className="flex items-center gap-2 text-muted-foreground">
                      <Calendar className="h-4 w-4" />
                      <span className="text-sm">Start Date</span>
                    </div>
                    <p className="mt-1 font-bold">
                      {leaseDetails.lease.startDate}
                    </p>
                  </div>
                  <div className="border-3 border-foreground bg-muted/50 p-4">
                    <div className="flex items-center gap-2 text-muted-foreground">
                      <Calendar className="h-4 w-4" />
                      <span className="text-sm">End Date</span>
                    </div>
                    <p className="mt-1 font-bold">
                      {leaseDetails.lease.endDate}
                    </p>
                  </div>
                  <div className="border-3 border-foreground bg-muted/50 p-4">
                    <div className="flex items-center gap-2 text-muted-foreground">
                      <Clock className="h-4 w-4" />
                      <span className="text-sm">Duration</span>
                    </div>
                    <p className="mt-1 font-bold">
                      {leaseDetails.lease.duration}
                    </p>
                  </div>
                  <div className="border-3 border-foreground bg-primary/10 p-4">
                    <div className="flex items-center gap-2 text-muted-foreground">
                      <CreditCard className="h-4 w-4" />
                      <span className="text-sm">Monthly Payment</span>
                    </div>
                    <p className="mt-1 font-bold text-primary">
                      {formatCurrency(leaseDetails.lease.monthlyPayment)}
                    </p>
                  </div>
                </div>

                <div className="mt-6">
                  <div className="mb-2 flex justify-between text-sm">
                    <span className="text-muted-foreground">
                      Payment Progress
                    </span>
                    <span className="font-bold">
                      {leaseDetails.paymentProgress.paymentsCompleted}/
                      {leaseDetails.paymentProgress.totalPayments} payments
                    </span>
                  </div>
                  <div className="h-6 border-3 border-foreground bg-muted">
                    <div
                      className="h-full bg-secondary transition-all"
                      style={{ width: `${progressPercentage}%` }}
                    />
                  </div>
                  <div className="mt-2 flex justify-between text-sm text-muted-foreground">
                    <span>
                      {formatCurrency(leaseDetails.paymentProgress.totalPaid)}{" "}
                      paid
                    </span>
                    <span>
                      {formatCurrency(leaseDetails.paymentProgress.totalOwed)}{" "}
                      total
                    </span>
                  </div>
                </div>
              </Card>

              {/* Documents */}
              <Card className="border-3 border-foreground p-6 shadow-[4px_4px_0px_0px_rgba(26,26,26,1)]">
                <h3 className="mb-4 text-lg font-bold">Lease Documents</h3>
                <div className="space-y-3">
                  {leaseDetails.documents.map((doc) => (
                    <div
                      key={doc.id}
                      className="flex w-full items-center justify-between border-3 border-foreground bg-card p-4 text-left transition-all hover:bg-muted"
                    >
                      <button
                        type="button"
                        className="flex flex-1 items-center gap-4 text-left"
                        onClick={() =>
                          setSelectedDocument(getDocumentObject(doc.name))
                        }
                      >
                        <div className="flex h-10 w-10 items-center justify-center border-2 border-foreground bg-muted shrink-0">
                          <FileText className="h-5 w-5" />
                        </div>
                        <div className="flex-1">
                          <p className="font-bold">{doc.name}</p>
                          <p className="text-xs text-muted-foreground">
                            {doc.date} · {doc.size} · {doc.status}
                          </p>
                        </div>
                      </button>
                      <Button
                        className="border-2 border-foreground bg-primary px-4 py-2 font-bold shadow-[2px_2px_0px_0px_rgba(26,26,26,1)] transition-all hover:translate-x-px hover:translate-y-px hover:shadow-[1px_1px_0px_0px_rgba(26,26,26,1)]"
                        onClick={() =>
                          setSelectedDocument(getDocumentObject(doc.name))
                        }
                      >
                        <FileText className="mr-2 h-4 w-4" />
                        View
                      </Button>
                    </div>
                  ))}
                </div>
              </Card>

              {/* Document Viewer Modal */}
              {selectedDocument && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
                  <div className="max-h-[90vh] max-w-2xl w-full overflow-y-auto border-3 border-foreground bg-card shadow-[8px_8px_0px_0px_rgba(26,26,26,1)]">
                    {/* Modal Header */}
                    <div className="sticky top-0 border-b-3 border-foreground bg-card px-6 py-4 flex items-center justify-between">
                      <h2 className="text-xl font-bold">
                        {selectedDocument.title}
                      </h2>
                      <button
                        onClick={() => setSelectedDocument(null)}
                        className="flex h-8 w-8 items-center justify-center border-2 border-foreground bg-muted hover:bg-primary transition-all"
                      >
                        <X className="h-5 w-5" />
                      </button>
                    </div>

                    {/* Modal Content */}
                    <div className="p-6 space-y-6">
                      {/* Document Info */}
                      <div className="flex flex-wrap gap-4 text-sm font-bold border-b-2 border-dashed border-foreground pb-4">
                        <div>
                          <p className="text-xs text-muted-foreground">Date</p>
                          <p>{selectedDocument.date}</p>
                        </div>
                        <div>
                          <p className="text-xs text-muted-foreground">Size</p>
                          <p>{selectedDocument.size}</p>
                        </div>
                        <div>
                          <p className="text-xs text-muted-foreground">
                            Status
                          </p>
                          <span className="capitalize inline-flex items-center gap-1 border-2 border-foreground px-2 py-1 bg-primary">
                            {selectedDocument.status}
                          </span>
                        </div>
                      </div>

                      {/* Document Sections */}
                      <div className="space-y-6">
                        {selectedDocument.content.sections.map(
                          (section) => (
                            <div
                              key={section.title}
                              className="border-l-4 border-primary pl-4"
                            >
                              <h3 className="font-bold text-lg mb-2">
                                {section.title}
                              </h3>
                              {"content" in section && section.content && (
                                <p className="text-sm text-muted-foreground leading-relaxed mb-3">
                                  {section.content}
                                </p>
                              )}
                              {"items" in section && section.items && (
                                <ul className="space-y-2">
                                  {section.items.map((item) => (
                                    <li
                                      key={`${section.title}:${item}`}
                                      className="flex gap-3 text-sm text-muted-foreground"
                                    >
                                      <span className="font-bold text-primary">
                                        •
                                      </span>
                                      <span>{item}</span>
                                    </li>
                                  ))}
                                </ul>
                              )}
                            </div>
                          ),
                        )}
                      </div>

                      {/* Modal Footer */}
                      <div className="border-t-3 border-foreground pt-4 flex gap-3">
                        <Button className="flex-1 border-2 border-foreground bg-primary py-3 font-bold shadow-[3px_3px_0px_0px_rgba(26,26,26,1)] transition-all hover:translate-x-px hover:translate-y-px hover:shadow-[2px_2px_0px_0px_rgba(26,26,26,1)]">
                          <Download className="mr-2 h-4 w-4" />
                          Download PDF
                        </Button>
                        <Button
                          onClick={() => setSelectedDocument(null)}
                          className="flex-1 border-2 border-foreground bg-transparent font-bold hover:bg-muted"
                        >
                          Close
                        </Button>
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* Contact Cards */}
            <div className="space-y-6">
              {/* Landlord */}
              <Card className="border-3 border-foreground p-6 shadow-[4px_4px_0px_0px_rgba(26,26,26,1)]">
                <h3 className="mb-4 text-lg font-bold">Landlord</h3>
                <div className="mb-4 flex items-center gap-4">
                  <div className="flex h-16 w-16 items-center justify-center border-3 border-foreground bg-primary text-xl font-bold">
                    <User className="h-8 w-8" />
                  </div>
                  <div>
                    <p className="font-bold">{leaseDetails.landlord.name}</p>
                    <p className="text-sm text-muted-foreground">
                      {leaseDetails.landlord.company}
                    </p>
                  </div>
                </div>
                <div className="space-y-2 border-t-2 border-foreground pt-4">
                  <div className="flex items-center gap-2 text-sm">
                    <Phone className="h-4 w-4 text-muted-foreground" />
                    <span>{leaseDetails.landlord.phone}</span>
                  </div>
                  <div className="flex items-center gap-2 text-sm">
                    <Mail className="h-4 w-4 text-muted-foreground" />
                    <span>{leaseDetails.landlord.email}</span>
                  </div>
                </div>
              </Card>

              {/* Need Help */}
              <Card className="border-3 border-foreground bg-accent/30 p-6 shadow-[4px_4px_0px_0px_rgba(26,26,26,1)]">
                <h3 className="mb-2 font-bold">Need Help?</h3>
                <p className="mb-4 text-sm text-muted-foreground">
                  Having issues with your lease or property? Contact our support
                  team.
                </p>
                <Button
                  variant="outline"
                  className="w-full border-3 border-foreground bg-background font-bold"
                >
                  Contact Support
                </Button>
              </Card>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
