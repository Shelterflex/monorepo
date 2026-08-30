import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatDate } from "@/lib/i18n-utils";
import type { UserRentalApplication } from "@/lib/types/dashboard";

function statusPresentation(status: UserRentalApplication["status"]) {
  switch (status) {
    case "submitted":
      return { label: "Submitted", variant: "secondary" as const };
    case "under_review":
    case "pending":
      return { label: "Under review", variant: "default" as const };
    case "approved":
      return { label: "Approved", variant: "secondary" as const };
    case "rejected":
      return { label: "Rejected", variant: "destructive" as const };
    case "cancelled":
      return { label: "Cancelled", variant: "outline" as const };
  }
}

export function ApplicationsTable({
  applications,
}: {
  applications: UserRentalApplication[];
}) {
  if (applications.length === 0) {
    return (
      <div className="border-3 border-foreground border-dashed p-12 text-center bg-muted/30">
        <p className="font-mono text-lg font-bold text-muted-foreground">
          No applications yet
        </p>
        <p className="text-sm text-muted-foreground mt-2">
          Your rental applications will appear here.
        </p>
      </div>
    );
  }

  return (
    <Table aria-label="Rental applications">
      <TableHeader>
        <TableRow>
          <TableHead scope="col">Application</TableHead>
          <TableHead scope="col">Property</TableHead>
          <TableHead scope="col">Status</TableHead>
          <TableHead scope="col">Submitted</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {applications.map((app) => {
          const status = statusPresentation(app.status);
          return (
            <TableRow key={app.id}>
              <TableCell className="font-mono font-bold">{app.id}</TableCell>
              <TableCell>
                <div className="font-bold text-foreground">
                  {app.property.title}
                </div>
                <div className="text-xs text-muted-foreground">
                  {app.property.location}
                </div>
                {app.status === "rejected" && app.rejectionReason && (
                  <p className="text-xs text-destructive mt-1">
                    {app.rejectionReason}
                  </p>
                )}
              </TableCell>
              <TableCell>
                <Badge variant={status.variant}>
                  <span aria-hidden="true">{status.label}</span>
                  <span className="sr-only">Status: {status.label}</span>
                </Badge>
              </TableCell>
              <TableCell className="text-muted-foreground">
                {formatDate(app.submittedAt, "en", {
                  year: "numeric",
                  month: "short",
                  day: "2-digit",
                })}
              </TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}
