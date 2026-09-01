"use client";

import { type LandlordApplicationRecord } from "@/lib/landlordPropertiesApi";
import {
  Drawer,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
  DrawerFooter,
} from "@/components/ui/drawer";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ApplicationStatusBadge } from "./ApplicationStatusBadge";
import { formatDate } from "@/lib/date";
import {
  FileText,
  CheckCircle,
  Clock,
  XCircle,
  ExternalLink,
  Mail,
  Phone,
  Calendar,
  Briefcase,
  DollarSign,
  Star,
} from "lucide-react";

interface ApplicantDetailDrawerProps {
  applicant: LandlordApplicationRecord | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onApprove: (applicantId: string) => void;
  onReject: (applicantId: string) => void;
}

export function ApplicantDetailDrawer({
  applicant,
  open,
  onOpenChange,
  onApprove,
  onReject,
}: ApplicantDetailDrawerProps) {
  if (!applicant) return null;

  const displayDate = applicant.applicationDate ?? applicant.appliedAt;

  const getDocumentStatusIcon = (status: string) => {
    switch (status) {
      case "verified":
        return <CheckCircle className="h-4 w-4 text-green-600" />;
      case "pending":
        return <Clock className="h-4 w-4 text-yellow-600" />;
      case "rejected":
        return <XCircle className="h-4 w-4 text-red-600" />;
      default:
        return null;
    }
  };

  const getIncomeVerificationStatus = () => {
    switch (applicant.incomeVerificationStatus) {
      case "verified":
        return (
          <span className="flex items-center gap-2 text-green-600">
            <CheckCircle className="h-4 w-4" />
            Verified
          </span>
        );
      case "pending":
        return (
          <span className="flex items-center gap-2 text-yellow-600">
            <Clock className="h-4 w-4" />
            Pending Review
          </span>
        );
      case "rejected":
        return (
          <span className="flex items-center gap-2 text-red-600">
            <XCircle className="h-4 w-4" />
            Rejected
          </span>
        );
      default:
        return null;
    }
  };

  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent className="h-[85vh] border-3 border-foreground">
        <div className="mx-auto mt-4 h-2 w-25 shrink-0 rounded-full bg-muted" />
        <div className="flex h-full flex-col overflow-hidden">
          <DrawerHeader className="border-b-3 border-foreground p-6">
            <div className="flex items-start justify-between">
              <div className="flex-1">
                <DrawerTitle className="text-2xl font-bold">
                  {applicant.name ?? `Applicant ${applicant.tenantId.slice(0, 8)}`}
                </DrawerTitle>
                <div className="mt-2 flex flex-wrap gap-4 text-sm text-muted-foreground">
                  {applicant.email && (
                    <span className="flex items-center gap-1">
                      <Mail className="h-4 w-4" />
                      {applicant.email}
                    </span>
                  )}
                  {applicant.phone && (
                    <span className="flex items-center gap-1">
                      <Phone className="h-4 w-4" />
                      {applicant.phone}
                    </span>
                  )}
                </div>
              </div>
              <ApplicationStatusBadge status={applicant.status} />
            </div>
          </DrawerHeader>

          <div className="flex-1 overflow-y-auto p-6">
            <div className="space-y-6">
              <Card className="border-3 border-foreground p-4 shadow-[4px_4px_0px_0px_rgba(26,26,26,1)]">
                <h3 className="mb-3 text-lg font-bold">Application Details</h3>
                <div className="grid gap-3 text-sm">
                  <div className="flex items-center gap-2">
                    <Calendar className="h-4 w-4 text-muted-foreground" />
                    <span className="text-muted-foreground">Applied:</span>
                    <span className="font-medium">
                      {formatDate(displayDate)}
                    </span>
                  </div>
                  {applicant.paymentPlan && (
                    <div className="flex items-center gap-2">
                      <span className="text-muted-foreground">Payment plan:</span>
                      <span className="font-medium">{applicant.paymentPlan}</span>
                    </div>
                  )}
                  {applicant.employmentStatus && (
                    <div className="flex items-center gap-2">
                      <Briefcase className="h-4 w-4 text-muted-foreground" />
                      <span className="text-muted-foreground">Employment:</span>
                      <span className="font-medium">{applicant.employmentStatus}</span>
                    </div>
                  )}
                  {applicant.incomeBand && (
                    <div className="flex items-center gap-2">
                      <DollarSign className="h-4 w-4 text-muted-foreground" />
                      <span className="text-muted-foreground">Income Band:</span>
                      <span className="font-medium">{applicant.incomeBand}</span>
                    </div>
                  )}
                  {applicant.ratingCardScore != null && (
                    <div className="flex items-center gap-2">
                      <Star className="h-4 w-4 text-muted-foreground" />
                      <span className="text-muted-foreground">Rating Card Score:</span>
                      <span className="font-bold text-primary">
                        {applicant.ratingCardScore}/100
                      </span>
                    </div>
                  )}
                  {applicant.coverNote && (
                    <div>
                      <span className="text-muted-foreground">Cover note:</span>
                      <p className="mt-1 font-medium">{applicant.coverNote}</p>
                    </div>
                  )}
                </div>
              </Card>

              {applicant.incomeVerificationStatus && (
                <Card className="border-3 border-foreground p-4 shadow-[4px_4px_0px_0px_rgba(26,26,26,1)]">
                  <h3 className="mb-3 text-lg font-bold">Income Verification</h3>
                  <div className="text-lg font-medium">
                    {getIncomeVerificationStatus()}
                  </div>
                </Card>
              )}

              {applicant.ratingCardLink && (
                <Card className="border-3 border-foreground p-4 shadow-[4px_4px_0px_0px_rgba(26,26,26,1)]">
                  <h3 className="mb-3 text-lg font-bold">Tenant Rating Card</h3>
                  <Button
                    variant="outline"
                    className="border-3 border-foreground"
                    asChild
                  >
                    <a
                      href={applicant.ratingCardLink}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-2"
                    >
                      <ExternalLink className="h-4 w-4" />
                      View Full Rating Card
                    </a>
                  </Button>
                </Card>
              )}

              {applicant.documents && applicant.documents.length > 0 && (
                <Card className="border-3 border-foreground p-4 shadow-[4px_4px_0px_0px_rgba(26,26,26,1)]">
                  <h3 className="mb-3 text-lg font-bold">Uploaded Documents</h3>
                  <div className="space-y-2">
                    {applicant.documents.map((doc) => (
                      <div
                        key={doc.id}
                        className="flex items-center justify-between rounded-md border-2 border-foreground bg-muted p-3"
                      >
                        <div className="flex items-center gap-3">
                          <FileText className="h-5 w-5 text-muted-foreground" />
                          <div>
                            <p className="font-medium">{doc.name}</p>
                            <p className="text-xs text-muted-foreground">{doc.type}</p>
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          {getDocumentStatusIcon(doc.status)}
                          <Button
                            variant="outline"
                            size="sm"
                            className="border-2 border-foreground text-xs"
                            asChild
                          >
                            <a
                              href={doc.url}
                              target="_blank"
                              rel="noopener noreferrer"
                            >
                              View
                            </a>
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>
                </Card>
              )}
            </div>
          </div>

          <DrawerFooter className="border-t-3 border-foreground p-6">
            {applicant.status === "pending" && (
              <div className="flex gap-3">
                <Button
                  onClick={() => onReject(applicant.id)}
                  className="flex-1 border-3 border-foreground bg-destructive px-6 py-3 font-bold text-destructive-foreground shadow-[4px_4px_0px_0px_rgba(26,26,26,1)] transition-all hover:translate-x-0.5 hover:translate-y-0.5 hover:shadow-[2px_2px_0px_0px_rgba(26,26,26,1)]"
                >
                  Reject Application
                </Button>
                <Button
                  onClick={() => onApprove(applicant.id)}
                  className="flex-1 border-3 border-foreground bg-secondary px-6 py-3 font-bold text-secondary-foreground shadow-[4px_4px_0px_0px_rgba(26,26,26,1)] transition-all hover:translate-x-0.5 hover:translate-y-0.5 hover:shadow-[2px_2px_0px_0px_rgba(26,26,26,1)]"
                >
                  Approve Application
                </Button>
              </div>
            )}
            {applicant.status !== "pending" && (
              <p className="text-center text-sm text-muted-foreground">
                This application has been {applicant.status}.
              </p>
            )}
          </DrawerFooter>
        </div>
      </DrawerContent>
    </Drawer>
  );
}
