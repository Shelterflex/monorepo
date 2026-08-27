"use client";

import Link from "next/link";
import { MapPin, Clock, DollarSign, FileText, CheckCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { MoneyValue } from "@/components/ui/data-state";
import type { InspectionJob } from "@/lib/propertyInspectionApi";
import { formatDate } from "@/lib/date";

interface JobCardProps {
  job: InspectionJob;
  onClaim?: (jobId: string) => void;
  isClaiming?: boolean;
}

export function JobCard({ job, onClaim, isClaiming }: JobCardProps) {
  const isAvailable = job.status === "available";
  const isClaimed = job.status === "claimed" || job.status === "in_progress";
  const isCompleted = job.status === "completed";

  const getInspectionTypeBadge = () => {
    if (job.inspectionType === "new_listing") {
      return (
        <Badge className="bg-secondary border-2 border-foreground">
          New Listing
        </Badge>
      );
    }
    return (
      <Badge className="bg-accent border-2 border-foreground">
        Re-Inspection
      </Badge>
    );
  };

  const getStatusBadge = () => {
    if (isCompleted) {
      return (
        <Badge className="bg-muted border-2 border-foreground">
          Completed
        </Badge>
      );
    }
    if (isClaimed) {
      return (
        <Badge className="bg-primary border-2 border-foreground">
          In Progress
        </Badge>
      );
    }
    return (
      <Badge className="bg-green-500 border-2 border-foreground">
        Available
      </Badge>
    );
  };

  return (
    <Card className="border-3 border-foreground p-6 shadow-[4px_4px_0px_0px_rgba(26,26,26,1)] transition-all hover:translate-x-0.5 hover:translate-y-0.5 hover:shadow-[2px_2px_0px_0px_rgba(26,26,26,1)]">
      <div className="flex flex-col gap-4">
        {/* Header */}
        <div className="flex items-start justify-between">
          <div className="flex gap-2">
            {getInspectionTypeBadge()}
            {getStatusBadge()}
          </div>
          <p className="text-sm font-medium text-muted-foreground">
            {job.id}
          </p>
        </div>

        {/* Property Info */}
        <div>
          <h3 className="text-lg font-bold text-foreground">{job.propertyTitle || 'Property Inspection'}</h3>
          <p className="mt-1 flex items-center gap-1 text-sm text-muted-foreground">
            <MapPin className="h-4 w-4" />
            {job.address || 'Location not specified'}
          </p>
        </div>

        {/* Details */}
        <div className="flex gap-6 text-sm">
          <div className="flex items-center gap-1 font-medium text-foreground">
            <DollarSign className="h-4 w-4 text-primary" />
            <MoneyValue
              status="ready"
              amount={job.offeredFee}
              format={(fee) => `₦${fee.toLocaleString()}`}
              skeletonClassName="h-4 w-20"
              unavailableLabel="Fee unavailable"
            />
          </div>
          <div className="flex items-center gap-1 text-muted-foreground">
            <Clock className="h-4 w-4" />
            Due: {formatDate(job.deadline, { fallback: "TBD" })}
          </div>
        </div>

        {/* Actions */}
        <div className="flex items-center justify-between">
          {isAvailable ? (
            <Button
              onClick={() => onClaim?.(job.id)}
              disabled={isClaiming}
              className="border-3 border-foreground bg-primary shadow-[2px_2px_0px_0px_rgba(26,26,26,1)] transition-all hover:translate-x-0.5 hover:translate-y-0.5 hover:shadow-[1px_1px_0px_0px_rgba(26,26,26,1)] disabled:opacity-50"
            >
              {isClaiming ? "Claiming..." : "Claim Job"}
            </Button>
          ) : isClaimed ? (
            <Link href={`/dashboard/inspector/${job.id}`}>
              <Button className="border-3 border-foreground bg-secondary shadow-[2px_2px_0px_0px_rgba(26,26,26,1)] transition-all hover:translate-x-0.5 hover:translate-y-0.5 hover:shadow-[1px_1px_0px_0px_rgba(26,26,26,1)]">
                <FileText className="mr-2 h-4 w-4" />
                View Job
              </Button>
            </Link>
          ) : (
            <Button
              disabled
              className="border-3 border-foreground bg-muted shadow-[2px_2px_0px_0px_rgba(26,26,26,1)]"
            >
              <CheckCircle className="mr-2 h-4 w-4" />
              Completed
            </Button>
          )}
        </div>
      </div>
    </Card>
  );
}
