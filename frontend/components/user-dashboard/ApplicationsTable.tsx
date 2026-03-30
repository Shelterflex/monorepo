import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { UserRentalApplication } from "@/lib/mockData/userDashboard";

function formatDate(iso: string) {
  const d = new Date(iso);
  return new Intl.DateTimeFormat("en-NG", {
    year: "numeric",
    month: "short",
    day: "2-digit",
  }).format(d);
}

function statusPresentation(status: UserRentalApplication["status"]) {
  switch (status) {
    case "submitted":
      return { label: "Submitted", variant: "secondary" as const };
    case "under_review":
      return { label: "Under review", variant: "default" as const };
    case "approved":
      return { label: "Approved", variant: "secondary" as const };
    case "rejected":
      return { label: "Rejected", variant: "destructive" as const };
  }
}

export function ApplicationsTable({
  applications,
}: {
  applications: UserRentalApplication[];
}) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Application</TableHead>
          <TableHead>Property</TableHead>
          <TableHead>Status</TableHead>
          <TableHead>Submitted</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {applications.map((app) => {
          const status = statusPresentation(app.status);
          return (
            <TableRow key={app.id}>
              <TableCell className="font-mono font-bold">{app.id}</TableCell>
              <TableCell>
                <div className="font-bold text-foreground">{app.property.title}</div>
                <div className="text-xs text-muted-foreground">
                  {app.property.location}
                </div>
              </TableCell>
              <TableCell>
                <Badge variant={status.variant}>{status.label}</Badge>
              </TableCell>
              <TableCell className="text-muted-foreground">
                {formatDate(app.submittedAt)}
              </TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}
