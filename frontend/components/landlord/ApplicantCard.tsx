import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ApplicationStatusBadge } from "./ApplicationStatusBadge";
import { type LandlordApplicationRecord } from "@/lib/landlordPropertiesApi";
import { Calendar, Briefcase, DollarSign, Star, Eye } from "lucide-react";
import { formatDate } from "@/lib/date";

interface ApplicantCardProps {
  applicant: LandlordApplicationRecord;
  onViewDetails: (applicant: LandlordApplicationRecord) => void;
}

export function ApplicantCard({ applicant, onViewDetails }: ApplicantCardProps) {
  const displayDate = applicant.applicationDate ?? applicant.appliedAt;

  return (
    <Card className="border-3 border-foreground p-6 shadow-[4px_4px_0px_0px_rgba(26,26,26,1)]">
      <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
        <div className="flex-1 space-y-3">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h3 className="text-xl font-bold text-foreground">
                {applicant.name ?? `Applicant ${applicant.tenantId.slice(0, 8)}`}
              </h3>
              {applicant.email && (
                <p className="text-sm text-muted-foreground">{applicant.email}</p>
              )}
              {applicant.phone && (
                <p className="text-sm text-muted-foreground">{applicant.phone}</p>
              )}
            </div>
            <ApplicationStatusBadge status={applicant.status} />
          </div>

          <div className="flex flex-wrap gap-4 text-sm">
            <span className="flex items-center gap-1 text-muted-foreground">
              <Calendar className="h-4 w-4" />
              Applied: {formatDate(displayDate)}
            </span>
            {applicant.employmentStatus && (
              <span className="flex items-center gap-1 text-muted-foreground">
                <Briefcase className="h-4 w-4" />
                {applicant.employmentStatus}
              </span>
            )}
            {applicant.incomeBand && (
              <span className="flex items-center gap-1 text-muted-foreground">
                <DollarSign className="h-4 w-4" />
                {applicant.incomeBand}
              </span>
            )}
          </div>

          {applicant.ratingCardScore != null && (
            <div className="flex items-center gap-2">
              <Star className="h-4 w-4 fill-primary text-primary" />
              <span className="font-bold text-foreground">Rating Card Score:</span>
              <span className="text-lg font-bold text-primary">
                {applicant.ratingCardScore}/100
              </span>
            </div>
          )}
        </div>

        <Button
          onClick={() => onViewDetails(applicant)}
          className="border-3 border-foreground bg-primary px-4 py-2 font-bold shadow-[4px_4px_0px_0px_rgba(26,26,26,1)] transition-all hover:translate-x-0.5 hover:translate-y-0.5 hover:shadow-[2px_2px_0px_0px_rgba(26,26,26,1)]"
        >
          <Eye className="mr-2 h-4 w-4" />
          View Details
        </Button>
      </div>
    </Card>
  );
}
